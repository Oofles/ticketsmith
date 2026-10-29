#!/usr/bin/env node
/**
 * tickets.mjs — the mechanical half of /tickets.
 *
 * Design rule: this script does everything MECHANICAL — parsing, id
 * allocation, dependency resolution, file moves, validation, the mechanical
 * half of a capability audit. The model does everything JUDGEMENTAL — what a
 * ticket means, whether the work is actually done, what to write in
 * ## Resolution. Anything a script can decide deterministically should not
 * cost tokens.
 *
 * Installed verbatim by TicketSmith into every project, so nothing here may
 * know what the project is. The one project-specific thing an audit needs —
 * which commands prove the code is healthy — is DECLARED in
 * docs/capabilities/AUDIT.md, never written into this file. See auditChecks.
 *
 * The format this enforces is docs/TICKET_FORMAT.md; the procedures that
 * drive it are .claude/skills/tickets/reference.md.
 *
 * No dependencies. Node's stdlib only (Node 18 or newer), so it runs in any
 * project, whatever its language, before or without a package manager.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { join, dirname, relative, basename } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";

// The project root is four levels up: scripts/ → tickets/ → skills/ → .claude/ → root.
// fileURLToPath, not URL.pathname: a project path with a space in it would
// otherwise arrive as `%20` and every read would miss.
const ROOT = process.env.TICKETS_ROOT ?? fileURLToPath(new URL("../../../../", import.meta.url)).replace(/[\\/]$/, "");
const DIRS = { open: "tickets/open", closed: "tickets/closed" };
const INDEX = "tickets/index.json";
const CAP_DIR = "docs/capabilities";
const AUDIT_DOC = `${CAP_DIR}/AUDIT.md`;

// The key order from docs/TICKET_FORMAT.md. Rewritten files use exactly this
// order so diffs stay readable.
const FIELD_ORDER = [
  "id", "slug", "title", "type", "priority", "status", "size",
  "capability", "depends_on", "blocked_by", "source",
  "created", "started", "deferred", "closed",
];
const ENUMS = {
  type: ["feature", "bug", "design", "chore", "refactor", "docs"],
  priority: ["high", "med", "low"],
  status: ["open", "blocked", "deferred", "closed"],
  size: ["s", "m", "l"],
  source: ["agent", "operator"],
};
const PRIO_RANK = { high: 0, med: 1, low: 2 };
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Title → slug, for `create` when no --slug is given.
 *
 * The trim runs AFTER the truncation, and the order is the entire point.
 * Trimming first and slicing second lets the 60-character cut land on a word
 * boundary and reintroduce the exact hyphen the trim just removed — SLUG_RE
 * then rejects it and `create` dies, so any title long enough to truncate on a
 * boundary could not be created without passing --slug by hand.
 *
 * A title with no alphanumerics yields "", which SLUG_RE rejects. That is
 * deliberate: better a loud refusal than a ticket with an empty slug.
 */
const slugify = (title) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60).replace(/^-+|-+$/g, "");

// ─────────────────────────────────────────────────────────── frontmatter ────
// Deliberately NOT a YAML library: the frontmatter is a fixed, flat schema, and
// a real YAML parser would happily accept nested structures the format does not
// allow, then silently reformat them on write. This parser round-trips or fails.

function parse(raw, path) {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
  if (!m) return { fm: null, body: raw, order: [], error: "no frontmatter block" };
  const fm = {};
  const order = [];
  for (const line of m[1].split("\n")) {
    if (!line.trim()) continue;
    const kv = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (!kv) return { fm: null, body: m[2], order, error: `unparseable frontmatter line: ${line}` };
    const [, k, rawV] = kv;
    order.push(k);
    const v = rawV.trim();
    if (/^\[.*\]$/.test(v)) fm[k] = v.slice(1, -1).trim() ? v.slice(1, -1).split(",").map((x) => Number(x.trim())) : [];
    else if (/^-?\d+$/.test(v)) fm[k] = Number(v);
    else fm[k] = v.replace(/^["'](.*)["']$/, "$1");
  }
  return { fm, body: m[2], order, error: null, path };
}

function serialize(fm, body) {
  const keys = [...FIELD_ORDER.filter((k) => k in fm), ...Object.keys(fm).filter((k) => !FIELD_ORDER.includes(k))];
  const lines = keys.map((k) => {
    const v = fm[k];
    if (Array.isArray(v)) return `${k}: [${v.join(", ")}]`;
    return `${k}: ${v}`;
  });
  return `---\n${lines.join("\n")}\n---\n${body}`;
}

/**
 * A criterion prefixed `(operator)` — bare or bolded, any case — is one only a
 * human can check. The failure it exists to stop: a criterion marked as
 * human-only in prose, ticked anyway by the agent that did the work, and a
 * feature shipped that nobody ever saw run. The marker exists so the two kinds
 * of tick stop being the same character.
 */
const OPERATOR_MARK = /^\*{0,2}\((?:operator)\)\*{0,2}[:\s]\s*/i;

/**
 * A ticked operator criterion must carry its evidence inline: a dated result,
 * next to the claim it supports. The dash may be em, en or hyphen and the
 * wording of the result is free — only the shape is checked, because the point
 * is to force an explicit dated statement, not to parse one.
 */
const SIGN_OFF = /[—–-]\s*verified\s+(\d{4}-\d{2}-\d{2})\s*:\s*\S/i;

/**
 * Checkboxes under "## Acceptance criteria" only, stopping at the next "##".
 *
 * Continuation lines (indented, not themselves a checkbox) fold into the
 * criterion above them. Without that, a sign-off would go unseen on exactly
 * the criteria long enough to wrap — the rule would fail open where it is
 * needed most.
 */
function acceptance(body) {
  const lines = body.split("\n");
  let inSec = false;
  const items = [];
  for (const l of lines) {
    if (/^##\s/.test(l)) { inSec = /^##\s+Acceptance criteria\s*$/i.test(l); continue; }
    if (!inSec) continue;
    const m = /^\s*-\s+\[( |x|X)\]\s*(.*)$/.exec(l);
    if (m) { items.push({ checked: m[1] !== " ", text: m[2].trim() }); continue; }
    if (items.length && /^\s+\S/.test(l)) items[items.length - 1].text += " " + l.trim();
  }

  const criteria = items.map(({ checked, text }) => {
    const operator = OPERATOR_MARK.test(text);
    return { checked, text, operator, signed: operator && SIGN_OFF.test(text) };
  });

  return {
    criteria,
    total: criteria.length,
    checked: criteria.filter((c) => c.checked).length,
    unchecked: criteria.filter((c) => !c.checked).map((c) => c.text),
    // Operator criteria still awaiting a human — the ones that must block a close.
    pendingOperator: criteria.filter((c) => c.operator && !c.checked).map((c) => c.text),
    // Ticked, but with no dated result: the pre-ticked failure, now machine-visible.
    unsignedOperator: criteria.filter((c) => c.operator && c.checked && !c.signed).map((c) => c.text),
  };
}

const hasSection = (body, name) => new RegExp(`^##\\s+${name}\\s*$`, "im").test(body);

/**
 * The `## Deferred` section: why the wait, and the cheap test that says it is over.
 *
 * `deferred` is for work that is specified, correct, and unworkable because
 * something OUTSIDE the project has not happened yet. It is not `blocked` —
 * `blocked_by` holds ticket ids, and there is no ticket for "the upstream
 * library ships its fix". It is not `open`, which claims the work is available
 * and makes every future session re-derive that it is not.
 *
 * Both halves are mandatory and `validate` errors without them. A deferral with no
 * reason is indistinguishable from a ticket nobody got to; a deferral with no
 * re-check is a wait with no end condition, which is how a ticket goes quiet for a
 * year. The re-check is a fenced shell block rather than a frontmatter field
 * because the frontmatter parser is deliberately flat and one-line, and a real
 * re-check often is not.
 *
 * The block is RUN by `recheck` and REPORTED. Nothing un-defers on its own: leaving
 * the state is `resume`, typed by someone who read the result. A ticket that
 * silently un-defers is a ticket nobody looks at.
 */
function deferral(body) {
  let inSec = false, found = false;
  const sec = [];
  for (const l of body.split("\n")) {
    if (/^##\s/.test(l)) { inSec = /^##\s+Deferred\s*$/i.test(l); if (inSec) found = true; continue; }
    if (inSec) sec.push(l);
  }
  const reason = (sec.map((l) => /^\*\*Reason:\*\*\s*(.*)$/.exec(l.trim())).find(Boolean)?.[1] ?? "").trim();
  const open = sec.findIndex((l) => /^```[a-z]*\s*$/.test(l.trim()));
  let recheck = "";
  if (open !== -1) {
    const rest = sec.slice(open + 1);
    const end = rest.findIndex((l) => l.trim() === "```");
    // An unterminated fence yields "", which validate reports. Guessing where the
    // block ends would silently hand the shell the rest of the ticket.
    if (end !== -1) recheck = rest.slice(0, end).join("\n").trim();
  }
  return { found, reason, recheck };
}

/** The section `defer` writes. The doctrine is in the file, not only in the script. */
const deferredSection = (reason, recheck, id) => [
  "",
  "## Deferred",
  "",
  `**Reason:** ${reason}`,
  "",
  "**Re-check** — the cheap test that says the wait is over. `tickets.mjs recheck " + pad(id) + "`",
  "runs it and reports the result; nothing un-defers on its own. When it exits 0, read the",
  "output and `tickets.mjs resume " + pad(id) + "`.",
  "",
  "```sh",
  recheck,
  "```",
  "",
].join("\n");

/** Insert a block immediately after the named section, or at the end if absent. */
function insertAfterSection(body, after, block) {
  const lines = body.split("\n");
  const i = lines.findIndex((l) => new RegExp(`^##\\s+${after}\\s*$`, "i").test(l));
  if (i === -1) return body.replace(/\s*$/, "\n") + block;
  let j = i + 1;
  while (j < lines.length && !/^##\s/.test(lines[j])) j++;
  while (j > i + 1 && !lines[j - 1].trim()) j--;   // keep the blank line before the next heading
  return [...lines.slice(0, j), ...block.split("\n"), ...lines.slice(j)].join("\n");
}

/**
 * `resume` renames the heading rather than deleting the section: the record of what
 * was waited on, and why, is worth more than a tidy file. Renaming also means a
 * second deferral opens a FRESH `## Deferred` — without it, `deferral()` would read
 * the stale re-check from the first one and `recheck` would run the wrong test.
 */
function closeDeferredSection(body, stamp, note) {
  const lines = body.split("\n");
  const i = lines.findIndex((l) => /^##\s+Deferred\s*$/i.test(l));
  if (i === -1) return body;
  let j = i + 1;
  while (j < lines.length && !/^##\s/.test(lines[j])) j++;
  let k = j;
  while (k > i + 1 && !lines[k - 1].trim()) k--;
  lines[i] = `## Deferred — resumed ${stamp}`;
  return [...lines.slice(0, k), "", note, "", ...lines.slice(j)].join("\n");
}

/**
 * Which `## sections` a ticket body must carry, and under what condition.
 *
 * One table rather than a rule per condition. The four base sections are
 * normative for every ticket (docs/TICKET_FORMAT.md), and a validator that only
 * checked frontmatter would call a file with no body at all clean. A table is
 * also how `create` already thinks, and a generator writing sections the
 * validator does not require is exactly the drift that lets the two halves of a
 * spec disagree unnoticed.
 *
 * Rule names stay distinct rather than collapsing to one: 'this bug has no
 * repro steps' and 'this ticket has no body' want different reactions.
 */
const SECTION_RULES = [
  { rule: "missing-section", applies: () => true,
    sections: ["Description", "Acceptance criteria", "Notes", "Operator validation"] },
  { rule: "bug-section", applies: (fm) => fm.type === "bug",
    sections: ["Steps to reproduce", "Expected vs actual"] },
  { rule: "design-section", applies: (fm) => fm.type === "design",
    sections: ["Options considered", "Open questions"] },
  { rule: "closed-section", applies: (fm, folder) => folder === "closed",
    sections: ["Resolution"] },
];

/** Every required section a ticket is missing, as [{rule, section}]. */
function missingSections(fm, body, folder) {
  return SECTION_RULES
    .filter((r) => r.applies(fm, folder))
    .flatMap((r) => r.sections.filter((s) => !hasSection(body, s)).map((s) => ({ rule: r.rule, section: s })));
}

/**
 * Every required section a ticket carries more than once, as [{section, count}].
 *
 * "Present" is the weaker half of the rule; "present exactly once" is the
 * property the rest of the script assumes. acceptance() folds checkboxes from
 * every '## Acceptance criteria' block into one list, so a leftover `create`
 * stub's '- [ ] TODO' sitting above the real criteria becomes a real unchecked
 * criterion — one that blocks the close — and would validate clean without this.
 *
 * The match is the exact heading line, so '## Deferred — resumed …' is a
 * different section. Lines inside ``` fences are skipped: a ticket that quotes
 * a heading in an example is not carrying it twice.
 *
 * One repeat is legitimate: the close procedure APPENDS '## Operator validation'
 * with the result after '## Resolution' (reference.md), so a closed ticket
 * carries the planning note and the result. Each half may appear once; the
 * total is what gets reported.
 */
function duplicateSections(fm, body, folder) {
  const before = new Map();
  const after = new Map(); // headings after '## Resolution', closed/ only
  let fenced = false;
  let resolved = false;
  for (const l of body.split("\n")) {
    if (/^\s*```/.test(l)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const m = /^##\s+(.+?)\s*$/.exec(l);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const bucket = resolved && key === "operator validation" && folder === "closed" ? after : before;
    bucket.set(key, (bucket.get(key) ?? 0) + 1);
    if (key === "resolution") resolved = true;
  }
  return [...new Set(SECTION_RULES.filter((r) => r.applies(fm, folder)).flatMap((r) => r.sections))]
    .map((section) => {
      const k = section.toLowerCase();
      const b = before.get(k) ?? 0, a = after.get(k) ?? 0;
      return { section, count: b + a, dup: b > 1 || a > 1 };
    })
    .filter((d) => d.dup)
    .map(({ section, count }) => ({ section, count }));
}

// ──────────────────────────────────────────────────────────────── loading ────

function load() {
  const tickets = [];
  for (const [folder, dir] of Object.entries(DIRS)) {
    const abs = join(ROOT, dir);
    if (!existsSync(abs)) continue;
    for (const f of readdirSync(abs).filter((f) => f.endsWith(".md")).sort()) {
      const path = `${dir}/${f}`;
      const raw = readFileSync(join(ROOT, path), "utf8");
      const p = parse(raw, path);
      tickets.push({ ...p, folder, file: f, raw, path });
    }
  }
  return tickets;
}

const byId = (ts) => new Map(ts.filter((t) => t.fm && typeof t.fm.id === "number").map((t) => [t.fm.id, t]));

/**
 * The capabilities that exist: `docs/capabilities/NN-name.md`, by name.
 *
 * Only numbered docs count. The gate orders capabilities by their number, and
 * the same folder holds the process docs (WORKFLOW.md, TEMPLATE.md, AUDIT.md,
 * WAVES.md) — none of which is a capability a ticket can belong to.
 */
function capabilityDocs() {
  const dir = join(ROOT, CAP_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /^\d\d-.*\.md$/.test(f)).map((f) => f.slice(0, -3)).sort();
}

// ─────────────────────────────────────────────────── graph: ready + cycles ────

/**
 * ready(T) ⟺ status ∈ {open, blocked} ∧ blocked_by = [] ∧ ∀d ∈ depends_on: closed
 * A non-empty blocked_by is NEVER ready, regardless of depends_on.
 */
function isReady(t, index) {
  if (!t.fm) return false;
  if (!["open", "blocked"].includes(t.fm.status)) return false;
  if ((t.fm.blocked_by ?? []).length > 0) return false;
  return (t.fm.depends_on ?? []).every((d) => index.get(d)?.fm?.status === "closed");
}

/** Every cycle over depends_on ∪ blocked_by, each returned in cycle order. */
function findCycles(index) {
  const edges = new Map();
  for (const [id, t] of index) edges.set(id, [...(t.fm.depends_on ?? []), ...(t.fm.blocked_by ?? [])].filter((d) => index.has(d)));
  const WHITE = 0, GREY = 1, BLACK = 2;
  const color = new Map([...index.keys()].map((k) => [k, WHITE]));
  const cycles = [];
  const seen = new Set();
  const stack = [];
  function dfs(u) {
    color.set(u, GREY); stack.push(u);
    for (const v of edges.get(u) ?? []) {
      if (color.get(v) === GREY) {
        const cyc = stack.slice(stack.indexOf(v));
        const key = [...cyc].sort((a, b) => a - b).join(",");
        if (!seen.has(key)) { seen.add(key); cycles.push([...cyc, v]); }
      } else if (color.get(v) === WHITE) dfs(v);
    }
    color.set(u, BLACK); stack.pop();
  }
  for (const id of [...index.keys()].sort((a, b) => a - b)) if (color.get(id) === WHITE) dfs(id);
  return cycles;
}

function readySet(tickets) {
  const index = byId(tickets);
  return tickets
    .filter((t) => isReady(t, index))
    .sort((a, b) => (PRIO_RANK[a.fm.priority] ?? 9) - (PRIO_RANK[b.fm.priority] ?? 9) || a.fm.id - b.fm.id);
}

// ──────────────────────────────────────────────────────────────── validate ────

function validate(tickets) {
  const errors = [], warnings = [];
  const index = byId(tickets);
  const seenIds = new Map();
  const caps = new Set(capabilityDocs());

  for (const t of tickets) {
    const E = (rule, msg) => errors.push({ path: t.path, rule, msg });
    const W = (rule, msg) => warnings.push({ path: t.path, rule, msg });

    if (!t.fm) { E("frontmatter", t.error ?? "missing frontmatter"); continue; }
    const { fm, body, folder } = t;

    const required = ["id", "slug", "title", "type", "priority", "status", "size", "capability", "depends_on", "blocked_by", "source", "created"];
    for (const k of required) if (!(k in fm)) E("required-field", `missing required field '${k}'`);

    for (const [k, allowed] of Object.entries(ENUMS)) {
      if (k in fm && !allowed.includes(fm[k])) E("enum", `${k}='${fm[k]}' is not one of ${allowed.join("|")}`);
    }

    const expect = `${String(fm.id).padStart(4, "0")}-${fm.slug}.md`;
    if (t.file !== expect) E("filename", `filename '${t.file}' does not match id+slug ('${expect}')`);
    if (typeof fm.slug === "string" && !SLUG_RE.test(fm.slug)) E("slug", `slug '${fm.slug}' is not kebab-case`);
    if (seenIds.has(fm.id)) E("duplicate-id", `id ${fm.id} also used by ${seenIds.get(fm.id)}`);
    else seenIds.set(fm.id, t.path);

    const folderStatus = { open: ["open", "blocked", "deferred"], closed: ["closed"] }[folder];
    if (fm.status && !folderStatus.includes(fm.status)) E("status-folder", `status '${fm.status}' disagrees with folder '${folder}/'`);

    const blocked = (fm.blocked_by ?? []).length > 0;
    if (blocked && fm.status !== "blocked") E("blocked-status", `blocked_by is non-empty but status is '${fm.status}'`);
    if (!blocked && fm.status === "blocked") E("blocked-status", `status is 'blocked' but blocked_by is empty`);

    // A deferral must say what it is waiting on and how anyone would know it is
    // over. Neither is optional, because a deferred ticket is one nobody will look
    // at again until something makes them.
    if (fm.status === "deferred") {
      const d = deferral(body);
      if (!("deferred" in fm)) E("deferred-stamp", "status is 'deferred' but there is no 'deferred:' timestamp");
      if (!d.found) E("deferred-section", "status is 'deferred' but there is no '## Deferred' section");
      else {
        if (!d.reason) E("deferred-reason", "'## Deferred' has no '**Reason:**' line — what is this waiting on?");
        if (!d.recheck) E("deferred-recheck", "'## Deferred' has no fenced re-check block — a wait with no end condition");
      }
    } else if ("deferred" in fm) {
      E("deferred-stamp", `'deferred:' is present on a ticket whose status is '${fm.status}'`);
    }

    for (const field of ["depends_on", "blocked_by"]) {
      for (const d of fm[field] ?? []) {
        if (!index.has(d)) E("dangling-ref", `${field} references ticket ${d}, which does not exist`);
        if (d === fm.id) E("self-edge", `${field} references itself`);
      }
    }

    // Folder-independent on purpose: a ticked operator criterion with no dated
    // result is wrong the moment it is written, not merely once the ticket
    // closes. Catching it in open/ is the difference between a refusal and a
    // post-mortem.
    for (const c of acceptance(body).unsignedOperator) {
      E("operator-unsigned", `operator criterion is ticked with no '— verified <date>: <result>': "${c}"`);
    }

    for (const { rule, section } of missingSections(fm, body, folder)) {
      E(rule, `missing '## ${section}'`);
    }
    for (const { section, count } of duplicateSections(fm, body, folder)) {
      E("duplicate-section", `'## ${section}' appears ${count} times`);
    }

    if (folder === "closed") {
      if (!("closed" in fm)) E("closed-stamp", "closed ticket has no 'closed:' timestamp");
      const { unchecked } = acceptance(body);
      if (unchecked.length) E("closed-unchecked", `closed with ${unchecked.length} unchecked acceptance criteria`);
    } else if ("closed" in fm) {
      E("closed-stamp", `'closed:' is present on a ticket in ${folder}/`);
    }

    // AN ERROR, NOT A WARNING. A capability with no doc cannot be audited —
    // `audit` refuses the name outright — and `auditBlockers` builds its blocker
    // list from ticket FRONTMATTER rather than from the docs directory. So one
    // mistyped `capability:` invents a phantom capability that can sort below the
    // real ones, can never record a verdict, and gates every ticket above it for
    // ever. Reported at warning volume, that reads as noise while the backlog
    // silently stops moving.
    if (fm.capability && fm.capability !== "null" && !caps.has(fm.capability)) {
      const shape = /^\d\d-/.test(String(fm.capability)) ? "" :
        " Capability names are NN-name — numbered, because the audit gate orders capabilities by that number.";
      E("unknown-capability",
        `capability '${fm.capability}' has no ${CAP_DIR}/${fm.capability}.md.${shape} ` +
        `Fix the name, or create the doc — until one or the other, this capability can never ` +
        `pass an audit and gates every ticket above it (${AUDIT_DOC}).`);
    }

    // warnings
    // Scoped to work that might still be DONE. The warning's job is "this
    // feature has no home in the roadmap, decide where it goes" — which is not a
    // question anyone will answer about a ticket already closed. Without the
    // scope, every closed stray leaves a permanent warning, and a warning list
    // that only grows is one people stop reading.
    if (folder !== "closed" && fm.type === "feature" && (fm.capability === "null" || fm.capability == null)) {
      W("no-capability", "feature ticket has no capability");
    }
    if (fm.size === "l" && isReady(t, index)) W("size-l-ready", "size:l ticket is in the ready set — split it");
    for (const k of t.order) if (!FIELD_ORDER.includes(k)) W("unknown-key", `unknown frontmatter key '${k}' (preserved)`);
  }

  for (const cyc of findCycles(index)) {
    errors.push({ path: "(graph)", rule: "cycle", msg: `dependency cycle: ${cyc.map((i) => String(i).padStart(4, "0")).join(" → ")}` });
  }
  return { errors, warnings };
}

// ─────────────────────────────────────────────────────────────────── index ────

function buildIndex(tickets) {
  const index = byId(tickets);
  return tickets
    .filter((t) => t.fm)
    .map((t) => {
      const { checked, total } = acceptance(t.body);
      const entry = {};
      for (const k of FIELD_ORDER) if (k in t.fm) entry[k] = t.fm[k];
      for (const k of Object.keys(t.fm)) if (!(k in entry)) entry[k] = t.fm[k];
      return { ...entry, path: t.path, ready: isReady(t, index), acceptance: { checked, total } };
    })
    .sort((a, b) => (a.id ?? 1e9) - (b.id ?? 1e9) || String(a.path).localeCompare(String(b.path)));
}

function writeIndex(tickets = load()) {
  const data = buildIndex(tickets);
  mkdirSync(join(ROOT, dirname(INDEX)), { recursive: true });
  writeFileSync(join(ROOT, INDEX), JSON.stringify(data, null, 2) + "\n");
  return data;
}

// ─────────────────────────────────────────────────────────────────── audit ────

/**
 * The mechanical half of docs/capabilities/AUDIT.md.
 *
 * Every check returns one of four verdicts, and the last two are the point:
 *
 *   pass   ran, and was green
 *   fail   ran, and was red
 *   na     could NOT run — with a reason naming what would make it applicable
 *   error  the check exists and could not complete — a timeout, a malformed
 *          declaration, a shell that would not start
 *
 * Collapsing "could not check" into "checked" would make the audit read green
 * while checking almost nothing, and a checklist that is mostly dishonest ticks
 * is worse than no checklist. An `na` with no reason is therefore a bug, not a
 * shortcut — the same rule as a ticked (operator) criterion with no sign-off.
 *
 * `error` is not `na`: `na` means "nothing to check yet", and a broken check
 * reading as a skipped one is the vacuous pass this whole command exists to
 * prevent. `--record` refuses on it exactly as on a fail.
 *
 * The bare command is advisory and writes nothing. `--record` writes the result.
 */
const PASS = (id, section, detail) => ({ id, section, status: "pass", detail });
const FAIL = (id, section, detail) => ({ id, section, status: "fail", detail });
const NA = (id, section, reason) => ({ id, section, status: "na", detail: reason });
const ERR = (id, section, detail) => ({ id, section, status: "error", detail });

/** The two groups the table prints. Named, not numbered: AUDIT.md's numbering is the project's. */
const SEC_DECLARED = "declared";
const SEC_TICKETS = "tickets";
const SECTION_TITLES = {
  [SEC_DECLARED]: `project checks — the audit-checks block in ${AUDIT_DOC}`,
  [SEC_TICKETS]: "ticket hygiene",
};

const CHECK_TIMEOUT = 300_000;

/**
 * Run a shell command from the project root, and report only how it ended —
 * audits are not test runners, and the last line of output is what says why.
 *
 * `shell: true` is /bin/sh on POSIX (cmd.exe on Windows): the lowest common
 * shell, because these commands are written once per project and must run on
 * every machine that project is built on. maxBuffer is raised because a test
 * suite's output overflowing Node's 1 MB default would kill the child and
 * report a passing suite as broken.
 */
function runShell(command, { timeout = CHECK_TIMEOUT } = {}) {
  const r = spawnSync(command, { cwd: ROOT, shell: true, encoding: "utf8", timeout, maxBuffer: 64 * 1024 * 1024 });
  const out = ((r.stdout ?? "") + (r.stderr ?? "")).trim().split("\n").filter(Boolean);
  const last = out.length ? out[out.length - 1].slice(0, 160) : "";
  if (r.error && r.error.code === "ETIMEDOUT") return { outcome: "timeout", detail: `timed out after ${timeout / 1000}s` };
  if (r.error) return { outcome: "error", detail: r.error.message };
  if (r.status === 0) return { outcome: "pass", detail: last };
  const how = r.status === null ? `killed by ${r.signal}` : `exit ${r.status}`;
  return { outcome: "fail", detail: last ? `${how}: ${last}` : how };
}

/** Ids the script's own checks use. A declared check may not shadow one. */
const BUILTIN_CHECKS = ["audit-checks", "validate", "blocked-by-closed", "capability-tickets-closed"];

/**
 * The project's own mechanical checks, read from the ONE fenced block in
 * docs/capabilities/AUDIT.md whose info string is `audit-checks`:
 *
 *   ```audit-checks
 *   # one check per line: <check-id>: <shell command>
 *   typecheck: npx tsc --noEmit
 *   tests: npm test --silent
 *   ```
 *
 * Declared, not hard-coded, because this script is installed verbatim and the
 * project is the only thing that knows which commands prove its code is
 * healthy. Declared in AUDIT.md, not in a config file, because AUDIT.md is the
 * document a person reads to learn what an audit checks — a check that lives
 * anywhere else is one the reader of the audit cannot see.
 *
 * Nothing is guessed. An unterminated block, a malformed line, a duplicate id
 * or a second block is a `problem`, which the audit reports as an `error` row:
 * a declaration that silently dropped a check would be a quieter version of the
 * vacuous pass this command exists to prevent.
 */
function parseAuditChecks(text) {
  const lines = text.split("\n");
  const checks = [], problems = [];
  let blocks = 0;
  for (let i = 0; i < lines.length; i++) {
    const open = /^(`{3,}|~{3,})\s*audit-checks\s*$/.exec(lines[i].trim());
    if (!open) continue;
    blocks++;
    if (blocks > 1) {
      problems.push({ line: i + 1, msg: `a second audit-checks block at line ${i + 1} — there is exactly one; merge them` });
    }
    const fence = open[1];
    let j = i + 1;
    const closeRe = new RegExp(`^${fence[0] === "`" ? "`" : "~"}{${fence.length},}\\s*$`);
    while (j < lines.length && !closeRe.test(lines[j].trim())) j++;
    if (j === lines.length) {
      problems.push({ line: i + 1, msg: `the audit-checks block opened at line ${i + 1} is never closed — nothing in it was run` });
      break;
    }
    if (blocks === 1) {
      for (let k = i + 1; k < j; k++) {
        const l = lines[k].trim();
        if (!l || l.startsWith("#")) continue;
        const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*:\s*(\S.*)$/.exec(l);
        if (!m) {
          problems.push({ line: k + 1, msg: `line ${k + 1} is not '<check-id>: <shell command>': ${l.slice(0, 80)}` });
          continue;
        }
        const [, id, command] = m;
        if (BUILTIN_CHECKS.includes(id)) {
          problems.push({ line: k + 1, msg: `line ${k + 1}: '${id}' is a built-in check id — name it something else` });
        } else if (checks.some((c) => c.id === id)) {
          problems.push({ line: k + 1, msg: `line ${k + 1}: check id '${id}' is declared twice` });
        } else {
          checks.push({ id, command: command.trim() });
        }
      }
    }
    i = j;
  }
  return { found: blocks > 0, checks, problems };
}

function declaredChecks() {
  const path = join(ROOT, AUDIT_DOC);
  const how = `add one '<check-id>: <shell command>' per line to a fenced \`\`\`audit-checks block in ${AUDIT_DOC} ` +
              `(typecheck, lint, the test suite — whatever proves this project's code is healthy). Until then no project check runs`;
  if (!existsSync(path)) return [NA("audit-checks", SEC_DECLARED, `${AUDIT_DOC} does not exist — ${how}`)];
  const { found, checks, problems } = parseAuditChecks(readFileSync(path, "utf8"));
  const rows = problems.map((p) => ERR("audit-checks", SEC_DECLARED, p.msg));
  if (!checks.length && !problems.length) {
    return [NA("audit-checks", SEC_DECLARED, found
      ? `the audit-checks block in ${AUDIT_DOC} declares no checks yet — ${how}`
      : `${AUDIT_DOC} has no audit-checks block yet — ${how}`)];
  }
  for (const { id, command } of checks) {
    const r = runShell(command);
    if (r.outcome === "pass") rows.push(PASS(id, SEC_DECLARED, command));
    else if (r.outcome === "fail") rows.push(FAIL(id, SEC_DECLARED, r.detail));
    else rows.push(ERR(id, SEC_DECLARED, `${r.detail} — \`${command}\``));
  }
  return rows;
}

function auditChecks(capability, tickets, filedByAudit = []) {
  const checks = [];

  // ── declared: the project's own, from AUDIT.md ─────────────────────────────
  checks.push(...declaredChecks());

  // ── tickets: the generic hygiene every project shares ──────────────────────
  const { errors } = validate(tickets);
  checks.push(errors.length
    ? FAIL("validate", SEC_TICKETS, `${errors.length} validation error(s): ${errors.slice(0, 3).map((e) => e.rule).join(", ")}`)
    : PASS("validate", SEC_TICKETS, "0 errors across open/ and closed/"));

  const byIdx = byId(tickets);
  const staleBlocks = tickets.filter((t) => t.fm)
    .flatMap((t) => (t.fm.blocked_by ?? [])
      .filter((d) => byIdx.get(d)?.fm?.status === "closed")
      .map((d) => `${pad(t.fm.id)} blocked_by ${pad(d)} (closed)`));
  checks.push(staleBlocks.length
    ? FAIL("blocked-by-closed", SEC_TICKETS, staleBlocks.join("; "))
    : PASS("blocked-by-closed", SEC_TICKETS, "no blocked_by points at a closed ticket"));

  // A `deferred` ticket does not hold a capability open: it is correct,
  // specified, and waiting on something the project does not control. It IS named
  // in both the row and the recorded audit, so a capability that passed with three
  // deferrals never reads as one that passed clean.
  //
  // Nor does a ticket THIS audit filed as a code-was-wrong divergence. The audit
  // tells the auditor to file it; failing the audit for having done so is how
  // audit findings stop being filed. Identified by the `--record` call naming it
  // in `--divergence "code-was-wrong|<id>|…"` — the audit's own record, not a
  // timestamp or a capability-wide flag, so an ordinary open ticket still fails,
  // and naming one costs a slot of the drift budget in plain sight.
  const mine = tickets.filter((t) => t.fm?.capability === capability);
  const deferredInCap = mine.filter((t) => t.fm.status === "deferred");
  const filedSet = new Set(filedByAudit);
  const stillOpen = openInCapability(capability, tickets);
  const filedInCap = stillOpen.filter((t) => filedSet.has(t.fm.id));
  const openInCap = stillOpen.filter((t) => !filedSet.has(t.fm.id));
  const defNote = (deferredInCap.length
    ? `; ${deferredInCap.length} deferred (${deferredInCap.map((t) => pad(t.fm.id)).join(", ")})`
    : "") + (filedInCap.length
    ? `; ${filedInCap.length} filed by this audit (${filedInCap.map((t) => pad(t.fm.id)).join(", ")})`
    : "");
  const hint = !filedByAudit.length && stillOpen.length
    ? ` — one filed as this audit's own code-was-wrong finding is exempted by naming it in --record --divergence`
    : "";
  checks.push(openInCap.length
    ? FAIL("capability-tickets-closed", SEC_TICKETS,
        `${openInCap.length} still open: ${openInCap.map((t) => pad(t.fm.id)).join(", ")}${defNote}${hint}`)
    : PASS("capability-tickets-closed", SEC_TICKETS,
        `${mine.length - deferredInCap.length - filedInCap.length} closed${defNote}`));

  return checks;
}

// ──────────────────────────────────────────────────────── the audit record ────

/**
 * An audit result is recorded in `docs/capabilities/NN-name.md` as ONE line:
 *
 *   <!-- audit-record {"capability":"01-…","verdict":"pass",…} -->
 *
 * A single-line HTML comment carrying JSON, not a parsed prose section. The gate
 * in `next` has to answer "did capability N pass its audit?" without a human,
 * and parsing prose for that answer is how the record starts lying — a heading
 * someone reworded silently becomes a capability that never passed, or worse,
 * one that did. The comment renders invisibly, cannot collide with prose, and
 * sits underneath the human-readable write-up rather than replacing it.
 *
 * Records are append-only. A re-audit adds a line; the last one wins. An audit
 * history you can read backwards is worth more than a current-value field.
 */
const RECORD_RE = /<!--\s*audit-record\s+(\{.*?\})\s*-->/g;

function auditRecords(capability) {
  const doc = join(ROOT, CAP_DIR, `${capability}.md`);
  if (!existsSync(doc)) return [];
  const out = [];
  for (const m of readFileSync(doc, "utf8").matchAll(RECORD_RE)) {
    try { out.push(JSON.parse(m[1])); } catch { /* a malformed record is not a passing one */ }
  }
  return out;
}

/** The audit standing for a capability right now, or null if it has never been audited. */
function latestAuditRecord(capability) {
  const rs = auditRecords(capability);
  return rs.length ? rs[rs.length - 1] : null;
}

/**
 * Has the capability got a REFLECT section with something actually in it?
 *
 * A capability doc can ship with its reflection heading already present and
 * holding a template line like `_Filled in at the REFLECT step, after USE._`.
 * Checking that the heading exists would then pass every capability from the
 * day its doc was created — a green light that means nothing. So: find every
 * heading matching /reflect/i, at any depth (a reflection may live inside a
 * larger audit write-up), strip italic placeholder lines and HTML comments,
 * and require substance — 200 characters — in what is left.
 */
function reflectSection(capability) {
  const doc = join(ROOT, CAP_DIR, `${capability}.md`);
  if (!existsSync(doc)) return { found: false, filled: false, chars: 0 };
  const lines = readFileSync(doc, "utf8").split("\n");
  let depth = 0, found = false;
  const body = [];
  for (const l of lines) {
    const h = /^(#{2,6})\s+(.*)$/.exec(l);
    if (h) {
      if (/reflect/i.test(h[2])) { found = true; depth = h[1].length; continue; }
      if (depth && h[1].length <= depth) depth = 0;
      continue;
    }
    if (depth) body.push(l);
  }
  const substantive = body
    .filter((l) => l.trim())
    .filter((l) => !/^_.*_$/.test(l.trim()))          // `_Filled in at the REFLECT step_`
    .filter((l) => !/^<!--.*-->$/.test(l.trim()));
  const chars = substantive.join(" ").length;
  return { found, filled: chars >= 200, chars };
}

const DIVERGENCE_RESOLUTIONS = ["code-was-wrong", "design-was-wrong"];

/**
 * `--divergence "code-was-wrong|0042|create could not derive a valid slug"`
 *
 * The resolution and the reference are both mandatory, because the audit's
 * governing rule is that a divergence resolves one way or the other and
 * "neither" is not an outcome. A divergence with no ticket and no recorded
 * decision is the "we'll remember" that the rule exists to forbid.
 */
function parseDivergence(raw) {
  const parts = String(raw).split("|").map((x) => x.trim());
  const [resolution, ref, ...rest] = parts;
  const description = rest.join(" | ");
  if (!DIVERGENCE_RESOLUTIONS.includes(resolution)) {
    die(`divergence '${raw}'\n` +
        `  must start with one of: ${DIVERGENCE_RESOLUTIONS.join(", ")}\n` +
        `  format: --divergence "<resolution>|<ref>|<description>"\n\n` +
        `  'code-was-wrong' means a ticket was filed; 'design-was-wrong' means the design doc\n` +
        `  was amended and the decision recorded in docs/DECISIONS.md. ${AUDIT_DOC} allows no\n` +
        `  third option — "we'll remember" is the drift, not a resolution of it.`);
  }
  if (!ref) die(`divergence '${raw}' has no reference.\n` +
                `  code-was-wrong needs the ticket id it was filed as; design-was-wrong needs the\n` +
                `  docs/DECISIONS.md entry that records the amendment. An unreferenced divergence\n` +
                `  is unresolved.`);
  if (!description) die(`divergence '${raw}' has no description. Say what actually diverged.`);
  return { resolution, ref, description };
}

/**
 * Docs this capability's tickets cite, with their `§` sections — the reading
 * list for the design-conformance half of the audit.
 *
 * The capability's own doc leads the list whether or not a ticket names it: it
 * IS the design the implementation is audited against. Everything else is any
 * `*.md` a ticket body mentions that resolves to a real file in the project —
 * a path as written (`docs/api.md`), or a bare name found exactly once
 * (`api.md`). Ticket files are never on the list: `0042-some-slug.md` is the
 * work, not the design it was built from, and an unresolvable or ambiguous name
 * is dropped rather than guessed.
 *
 * Line-wise rather than one regex over the body, because a citation reads
 * "`api.md` §3, §4.1–§4.8" and the backticks sit between the two halves.
 */
const CITE_TOKEN = /(?<file>[\w./-]*\.md)\b|(?<sec>§\s*\d+(?:\.\d+)*)/g;
/**
 * Words that may sit directly before a § without changing what it belongs to:
 * `§3 and §4.7`, `the §9.6 table`, `at §2.2`. Any other word there is the §'s own
 * referent — `roadmap §4.3`, `RFC §2.1`, `contract §5` — and the § is dropped.
 */
const CITE_CONNECTORS = new Set(["and", "or", "to", "through", "plus", "also", "vs", "the", "a", "at", "in", "see", "with"]);

/** Every .md under the root by basename, skipping dot-dirs, dependencies and tickets/. Built once, lazily. */
let mdIndex = null;
function markdownByName() {
  if (mdIndex) return mdIndex;
  mdIndex = new Map();
  const walk = (rel) => {
    let entries;
    try { entries = readdirSync(join(ROOT, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (p !== "tickets") walk(p); }
      else if (e.name.endsWith(".md")) {
        if (!mdIndex.has(e.name)) mdIndex.set(e.name, []);
        mdIndex.get(e.name).push(p);
      }
    }
  };
  walk("");
  return mdIndex;
}

/** A cited `.md` token → its repo-relative path, or null when it is a ticket, missing, or ambiguous. */
function resolveDoc(token) {
  const clean = token.replace(/^\.\//, "");
  if (clean.split("/").includes("tickets") || /^\d{4}-/.test(basename(clean))) return null;
  if (clean.includes("/")) {
    const rel = relative(ROOT, join(ROOT, clean)).split("\\").join("/");
    return !rel.startsWith("..") && existsSync(join(ROOT, rel)) ? rel : null;
  }
  const hits = markdownByName().get(clean) ?? [];
  return hits.length === 1 ? hits[0] : null;
}

function citedSections(capability, tickets) {
  const own = `${CAP_DIR}/${capability}.md`;
  const cites = new Map([[own, new Set()]]);
  for (const t of tickets.filter((x) => x.fm?.capability === capability)) {
    for (const line of t.raw.split("\n")) {
      // One scan, not a cross product of docs × sections. A § belongs to the
      // nearest preceding doc, unless the word directly before it names some
      // other referent — then it is dropped, never misattributed. A § with no
      // doc before it on the line is dropped too; an unresolvable .md ends the run.
      let doc = null, token = null;
      for (const m of line.matchAll(CITE_TOKEN)) {
        const { file, sec } = m.groups;
        if (file) {
          token = file;
          doc = resolveDoc(file);
          if (doc && !cites.has(doc)) cites.set(doc, new Set());
          continue;
        }
        if (!doc) continue;
        const before = line.slice(0, m.index).replace(/[\s`*_"'“”]+$/, "");
        const word = before.match(/[\w'’.-]+$/)?.[0];
        if (word && !token.endsWith(word) && !CITE_CONNECTORS.has(word.toLowerCase())) continue;
        cites.get(doc).add(sec.replace(/\s+/g, ""));
      }
    }
  }
  const sortSecs = (secs) => [...secs].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return [
    { doc: own, sections: sortSecs(cites.get(own)) },
    ...[...cites.entries()].filter(([d]) => d !== own)
      .map(([doc, secs]) => ({ doc, sections: sortSecs(secs) }))
      .sort((a, b) => a.doc.localeCompare(b.doc)),
  ];
}

function recordDivergences(capability, flags) {
  const asserted = "no-divergences" in flags;
  const raw = flags.divergence ? [].concat(flags.divergence) : [];
  if (!asserted && !raw.length) {
    die(`${capability}: no divergence assertion.\n\n` +
        `  The audit asks for every place the implementation differs from the design\n` +
        `  (${AUDIT_DOC}). Pass each as\n` +
        `  --divergence "<code-was-wrong|design-was-wrong>|<ref>|<description>",\n` +
        `  or assert there were none with --no-divergences.\n\n` +
        `  An empty list must be asserted, never assumed by omission — omission is what a\n` +
        `  skipped design review also looks like, and the two must not be indistinguishable.`);
  }
  if (asserted && raw.length) die(`--no-divergences was passed alongside ${raw.length} --divergence flag(s). Pick one.`);
  return raw.map(parseDivergence);
}

const DRIFT_BUDGET = 3;

function cmdAudit(capability, flags) {
  const tickets = load();
  const caps = capabilityDocs();
  if (!capability) die(`audit requires a capability.\n${caps.map((c) => `    ${c}`).join("\n")}`);
  // A bare number resolves against the docs, not the tickets: a capability can be
  // audited (or force-recorded) before any ticket names it, and `waves 3` already
  // taught the operator that the number alone is enough.
  if (/^\d{1,2}$/.test(capability)) {
    const hits = caps.filter((c) => capNumber(c) === Number(capability));
    if (hits.length > 1) die(`capability ${capability} is ambiguous: ${hits.join(", ")}. Name it in full.`);
    if (hits.length === 1) capability = hits[0];
  }
  if (!caps.includes(capability)) {
    die(`no capability '${capability}'. These exist:\n${caps.map((c) => `    ${c}`).join("\n")}`);
  }

  // --sections: the reading list for design conformance. Mechanical (which docs
  // did this capability's tickets cite) in service of the judgemental half.
  if (flags.sections) {
    const cited = citedSections(capability, tickets);
    if (flags.json) return console.log(JSON.stringify({ capability, cited }, null, 2));
    console.log(`\n  Re-read each for design conformance — the capability's own design doc first:\n`);
    for (const { doc, sections } of cited) {
      console.log(`    ${doc}${sections.length ? "  " + sections.join(", ") : "  (no § given)"}`);
    }
    console.log(`\n  For each: list every place the implementation differs. An empty list is a`);
    console.log(`  finding to assert with --no-divergences, never an omission.\n`);
    return;
  }

  // --record parses its divergences FIRST: a code-was-wrong divergence names the
  // ticket the audit filed, and that ticket is exempt from capability-tickets-closed.
  // The plain table has no divergences and so exempts nothing.
  const divergences = flags.record ? recordDivergences(capability, flags) : [];
  const filedByAudit = divergences.filter((d) => d.resolution === "code-was-wrong")
    .map((d) => Number(d.ref.replace(/^#/, ""))).filter(Number.isInteger);
  const checks = auditChecks(capability, tickets, filedByAudit);
  const failed = checks.filter((c) => c.status === "fail");
  const na = checks.filter((c) => c.status === "na");
  const errored = checks.filter((c) => c.status === "error");

  if (!flags.record) {
    if (flags.json) {
      console.log(JSON.stringify({ capability, checks, passed: !failed.length && !errored.length }, null, 2));
    } else {
      printAuditTable(capability, checks, failed, na, errored);
    }
    if (failed.length || errored.length) process.exit(1);
    return;
  }

  // ── --record: the full audit, mechanical + the judgemental half's outcome ──
  const force = flags.force;
  if (force === true) die(`--force needs a reason: --force "why this is being overridden".\n` +
                          `  The override is recorded in the capability doc. Skipping is visible, not silent.`);

  const problems = [];
  if (failed.length) problems.push(`${failed.length} mechanical check(s) failed: ${failed.map((c) => c.id).join(", ")}`);
  if (errored.length) problems.push(`${errored.length} check(s) could not run: ${errored.map((c) => c.id).join(", ")} — a check that did not run is not a pass`);
  if (divergences.length > DRIFT_BUDGET) {
    problems.push(`${divergences.length} divergences, over the budget of three — the design is stale, not the code.\n` +
                  `    Stop shipping tickets and run a DESIGN session on the affected doc (${AUDIT_DOC}).`);
  }
  const reflect = reflectSection(capability);
  if (!reflect.filled) {
    problems.push(reflect.found
      ? `the REFLECT section is still a placeholder (${reflect.chars} substantive chars, 200 needed) — ${AUDIT_DOC}`
      : `there is no REFLECT section (a heading containing "Reflect") in ${CAP_DIR}/${capability}.md — ${AUDIT_DOC}`);
  }

  if (problems.length && !force) {
    printAuditTable(capability, checks, failed, na, errored);
    die(`${capability} does not pass its audit:\n` +
        problems.map((p) => `  - ${p}`).join("\n") +
        `\n\n  Nothing was recorded. Fix these, or override with --force "<reason>" — which\n` +
        `  records the override and its reason in the capability doc rather than hiding it.`);
  }

  const record = {
    capability,
    audited: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    verdict: problems.length ? "forced" : "pass",
    mechanical: { pass: checks.length - failed.length - na.length - errored.length, fail: failed.length, na: na.length },
    divergences: divergences.length,
  };
  // Only when present, so clean records stay minimal.
  if (errored.length) record.mechanical.error = errored.length;
  const deferredInCap = tickets.filter((t) => t.fm?.capability === capability && t.fm.status === "deferred");
  if (deferredInCap.length) record.deferred = deferredInCap.map((t) => pad(t.fm.id));
  const filedInCap = openInCapability(capability, tickets).filter((t) => filedByAudit.includes(t.fm.id));
  if (filedInCap.length) record.filed = filedInCap.map((t) => pad(t.fm.id));
  if (problems.length) record.forced = String(force);

  const lines = [
    ``,
    `## Audit — ${record.audited.slice(0, 10)} (\`tickets.mjs audit --record\`)`,
    ``,
    `**Verdict: ${record.verdict.toUpperCase()}.** Mechanical half: ${record.mechanical.pass} passed, ` +
      `${record.mechanical.fail} failed, ${record.mechanical.na} n/a` +
      (errored.length ? `, ${errored.length} could not run` : "") + `. See \`${AUDIT_DOC}\`.`,
    ``,
  ];
  if (problems.length) {
    lines.push(`> **Overridden with \`--force\`.** Reason: ${force}`, ``,
               ...problems.map((p) => `> - ${p.split("\n")[0]}`), ``);
  }
  if (deferredInCap.length) {
    lines.push(`**Deferred, and therefore excluded from \`capability-tickets-closed\`:** ` +
               deferredInCap.map((t) => `\`${pad(t.fm.id)}\` ${t.fm.title}`).join("; ") +
               `. This capability passed with work outstanding — waiting on something outside the ` +
               `project, not forgotten. \`tickets.mjs recheck\` reports whether any wait is over.`, ``);
  }
  if (filedInCap.length) {
    lines.push(`**Filed by this audit, and therefore excluded from \`capability-tickets-closed\`:** ` +
               filedInCap.map((t) => `\`${pad(t.fm.id)}\` ${t.fm.title}`).join("; ") +
               `. This capability passed with work outstanding — its own code-was-wrong findings, ` +
               `filed as the audit directs and listed under Divergences below, not forgotten.`, ``);
  }
  lines.push(divergences.length
    ? `**Divergences (${divergences.length} of a budget of ${DRIFT_BUDGET}):**`
    : `**Divergences: none.** Asserted explicitly at audit time, not left blank.`);
  lines.push(``);
  for (const [i, d] of divergences.entries()) {
    lines.push(`${i + 1}. **${d.resolution}** — \`${d.ref}\` — ${d.description}`);
  }
  if (divergences.length) lines.push(``);
  for (const c of checks) lines.push(`- \`${c.id}\` — **${c.status}** — ${c.detail}`);
  lines.push(``, `<!-- audit-record ${JSON.stringify(record)} -->`, ``);

  const doc = join(ROOT, CAP_DIR, `${capability}.md`);
  writeFileSync(doc, readFileSync(doc, "utf8").replace(/\s*$/, "\n") + lines.join("\n"));

  printAuditTable(capability, checks, failed, na, errored);
  console.log(`  recorded → ${CAP_DIR}/${capability}.md  (verdict: ${record.verdict})`);
  if (problems.length) console.log(`  the override and its reason are in the doc.`);
}

function printAuditTable(capability, checks, failed, na, errored = []) {
  console.log(`\n  audit ${capability} — the mechanical half of ${AUDIT_DOC}\n`);
  let section = null;
  for (const c of checks) {
    if (c.section !== section) { section = c.section; console.log(`  ${SECTION_TITLES[section] ?? section}`); }
    const mark = { pass: "  ok  ", fail: " FAIL ", na: "  n/a ", error: " ERR  " }[c.status];
    console.log(`   ${mark} ${c.id.padEnd(26)} ${c.detail}`);
  }
  console.log(`\n  ${checks.length - failed.length - na.length - errored.length} passed, ${failed.length} failed, ` +
              `${na.length} n/a (nothing to check yet), ${errored.length} could not run`);
  if (errored.length) console.log(`  ERR is not n/a: the check exists and could not complete. Fix it and re-run.`);
  console.log(`\n  Mechanical only — a green table is not a passed audit. Design conformance and`);
  console.log(`  operator validation are judgement (${AUDIT_DOC}): run`);
  console.log(`  'audit ${capability} --sections' for the reading list, then --record, which`);
  console.log(`  also requires an explicit divergence assertion and a written REFLECT section.\n`);
}

// ────────────────────────────────────────────────────────────────────  git ────

const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();

/**
 * Move a ticket file to `dest` with new `content`, and fail BEFORE writing anything.
 *
 * Writing the new frontmatter in place and then `git mv`-ing is the wrong order:
 * `git mv` refuses an untracked file — any ticket created and closed in one
 * commit — and that leaves a file in its OLD folder claiming its NEW status. So
 * the checks run first, the move happens next, and the write lands last, at the
 * destination. A tracked file moves with `git mv`, so history follows it. An
 * untracked one has no history to follow, so a plain rename is the whole move.
 */
function moveTicketFile(src, dest, content) {
  if (existsSync(join(ROOT, dest))) die(`${dest} already exists. Nothing was written.`);
  mkdirSync(join(ROOT, dirname(dest)), { recursive: true });
  const tracked = spawnSync("git", ["ls-files", "--error-unmatch", "--", src], { cwd: ROOT, stdio: "ignore" }).status === 0;
  if (tracked) git("mv", src, dest);
  else renameSync(join(ROOT, src), join(ROOT, dest));
  writeFileSync(join(ROOT, dest), content);
}

/**
 * Refuse to transition a ticket on top of unrelated uncommitted work. The
 * command git-mv's a file and expects to be followed by its own commit; run
 * over other changes, that commit mixes a ticket transition with whatever else
 * was in flight, and the history stops saying what happened when.
 *
 * `except` is the path of the file this command is itself transitioning.
 * Ticking a ticket's final acceptance criteria is *part of closing it*, so a
 * dirty entry for that exact file is not unrelated work in flight. Without
 * this exemption the honest workflow needs two commits or a routine
 * --allow-dirty, and a rule reached for routinely stops being one.
 */
function requireCleanTree(cmd, allowDirty, except = null) {
  if (allowDirty) return;
  // `--untracked-files=all`: by default git collapses a wholly untracked folder to one
  // `?? tickets/` line, which hides the ticket being closed inside it from `except`.
  const dirty = git("status", "--porcelain", "--untracked-files=all").split("\n").filter(Boolean)
    .filter((l) => !l.includes(INDEX))
    .filter((l) => !(except && l.includes(except)));
  if (dirty.length) {
    die(`'${cmd}' refuses to run with a dirty working tree.\n` +
        `  ${dirty.length} uncommitted path(s). This command git-mv's a file and expects to be\n` +
        `  followed by its own commit; running it over unrelated changes produces a commit that\n` +
        `  mixes a ticket transition with whatever else was in flight.\n` +
        `  Commit or stash first, or pass --allow-dirty if you have considered it.`);
  }
}

// ──────────────────────────────────────────────────────────────── commands ────

const die = (msg) => { console.error(`\n  ${msg}\n`); process.exit(1); };
const pad = (n) => String(n).padStart(4, "0");
const now = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");
const today = () => new Date().toISOString().slice(0, 10);

function cmdIndex(flags) {
  const data = writeIndex();
  if (flags.json) console.log(JSON.stringify(data, null, 2));
  else console.log(`${INDEX}: ${data.length} tickets, ${data.filter((d) => d.ready).length} ready`);
}

function cmdList(flags) {
  let ts = load().filter((t) => t.fm);
  const index = byId(ts);
  const f = flags;
  if (f.status) ts = ts.filter((t) => t.fm.status === f.status);
  if (f.type) ts = ts.filter((t) => t.fm.type === f.type);
  if (f.priority) ts = ts.filter((t) => t.fm.priority === f.priority);
  if (f.capability) ts = ts.filter((t) => t.fm.capability === f.capability);
  if (f.size) ts = ts.filter((t) => t.fm.size === f.size);
  if (f.ready) ts = ts.filter((t) => isReady(t, index));
  ts.sort((a, b) => (PRIO_RANK[a.fm.priority] ?? 9) - (PRIO_RANK[b.fm.priority] ?? 9) || (a.fm.id ?? 1e9) - (b.fm.id ?? 1e9));
  if (f.json) return console.log(JSON.stringify(ts.map((t) => ({ ...t.fm, path: t.path, ready: isReady(t, index) })), null, 2));
  if (!ts.length) return console.log("no tickets match");
  const w = (s, n) => String(s ?? "").slice(0, n).padEnd(n);
  console.log(`  ${w("ID", 5)}${w("TYPE", 9)}${w("PRI", 5)}${w("SZ", 3)}${w("STATUS", 9)}${w("CAPABILITY", 30)}TITLE`);
  for (const t of ts) {
    console.log(`  ${w(t.fm.id ? pad(t.fm.id) : "—", 5)}${w(t.fm.type, 9)}${w(t.fm.priority, 5)}${w(t.fm.size, 3)}${w(t.fm.status, 9)}${w(t.fm.capability, 30)}${t.fm.title}`);
  }
  console.log(`\n  ${ts.length} ticket(s)`);
}

function cmdShow(id, flags) {
  const ts = load(); const index = byId(ts);
  const t = index.get(Number(id)) ?? die(`no ticket ${id}`);
  if (flags.json) {
    const rel = (f) => (t.fm[f] ?? []).map((d) => ({ id: d, title: index.get(d)?.fm?.title ?? null, status: index.get(d)?.fm?.status ?? "MISSING" }));
    return console.log(JSON.stringify({ ...t.fm, path: t.path, ready: isReady(t, index), depends_on_detail: rel("depends_on"), blocked_by_detail: rel("blocked_by") }, null, 2));
  }
  console.log(t.raw);
  for (const field of ["depends_on", "blocked_by"]) {
    const ids = t.fm[field] ?? [];
    if (!ids.length) continue;
    console.log(`\n  ${field}:`);
    for (const d of ids) {
      const o = index.get(d);
      console.log(`    ${pad(d)}  ${o ? `[${o.fm.status}]`.padEnd(10) + o.fm.title : "*** MISSING ***"}`);
    }
  }
  console.log(`\n  ready: ${isReady(t, index)}`);
  const { pendingOperator } = acceptance(t.body);
  if (pendingOperator.length && t.folder !== "closed") {
    console.log(`  awaiting operator: ${pendingOperator.length} criteri${pendingOperator.length === 1 ? "on" : "a"} — this ticket cannot close until a human runs them`);
  }
}

function cmdValidate(flags) {
  const { errors, warnings } = validate(load());
  if (flags.json) {
    console.log(JSON.stringify({ errors, warnings, ok: errors.length === 0 }, null, 2));
    process.exit(errors.length ? 1 : 0);
  }
  for (const e of errors) console.error(`  ERROR  ${e.path}  [${e.rule}]  ${e.msg}`);
  for (const w of warnings) console.warn(`  warn   ${w.path}  [${w.rule}]  ${w.msg}`);
  console.log(`\n  ${errors.length} error(s), ${warnings.length} warning(s)`);
  process.exit(errors.length ? 1 : 0);
}

/**
 * THE id allocator. Singular, deliberately: every caller goes through here,
 * because a second allocator is how two tickets end up with the same id.
 *
 * Max-plus-one, never count-plus-one and never gap-filling: ids are permanent
 * and never renumbered, so a closed 0042 must not be reissued to a ticket
 * filed next week.
 */
function nextId(tickets = load()) {
  const ids = tickets.map((t) => t.fm?.id).filter((n) => typeof n === "number");
  return ids.length ? Math.max(...ids) + 1 : 1;
}

function cmdAllocate() {
  console.log(pad(nextId()));
}

/**
 * The capability gate — the audit's teeth.
 *
 * A ticket in capability C is gated while any capability numbered below C — that
 * actually has tickets — has not recorded a passing audit. The blocker reported
 * is the LOWEST-numbered one: capabilities are built in order and audited in
 * order, so the earliest gap is the one that can actually be closed next.
 * Reporting the nearest gap instead sends you to audit 02 while 01 is still
 * outstanding, and you arrive back here one capability later.
 *
 * Expressed as "every lower capability", not "the immediately previous one", so
 * that skipping a capability cannot launder the gap. It also means work *inside*
 * the capability you are in is never gated, because a capability is never below
 * itself. You are blocked from advancing, never from finishing.
 *
 * It applies from the first capability. There is no grace period: a capability
 * with no audit is exactly as unfinished as any other. A project adopting the
 * kit midway, with capabilities that predate the audit, closes that gap visibly
 * — by auditing them, or by recording a forced verdict that says why not —
 * rather than by pretending they were gated all along.
 *
 * A `forced` verdict lifts the gate exactly as `pass` does. --force is meant to
 * make skipping *visible*, not impossible; a force that still blocked would just
 * be a refusal with extra steps, and the record says which it was.
 */
const capNumber = (cap) => (typeof cap === "string" && /^\d\d-/.test(cap) ? Number(cap.slice(0, 2)) : null);

function auditBlockers(capability, tickets) {
  const n = capNumber(capability);
  if (n === null) return [];
  const lower = [...new Set(tickets.map((t) => t.fm?.capability).filter((c) => {
    const m = capNumber(c);
    return m !== null && m < n;
  }))].sort();
  return lower.filter((c) => !["pass", "forced"].includes(latestAuditRecord(c)?.verdict));
}

/**
 * The tickets that stop a capability's audit passing `capability-tickets-closed`:
 * everything in it that is neither closed nor deferred. ONE definition, used by that
 * check and by `next`'s gate messages, so `next` can never recommend an audit the
 * audit's own check is certain to fail.
 */
function openInCapability(capability, tickets) {
  return tickets
    .filter((t) => t.fm?.capability === capability && !["closed", "deferred"].includes(t.fm.status))
    .sort((a, b) => a.fm.id - b.fm.id);
}

/**
 * When the blocking capability still has open tickets, its audit CANNOT pass, so
 * recommending it is recommending a guaranteed failure — and a capability's
 * PLANNED tickets run out long before the tickets building it generates do. The
 * tool is the one thing that can see the whole backlog at that moment; it must
 * say "close these", not "audit".
 */
const openList = (open) => open.map((t) => pad(t.fm.id)).join(", ");

function cmdNext(flags) {
  const ts = load();
  const ready = readySet(ts);
  // isReady already excludes `deferred`, so a deferred ticket is never offered as
  // workable. It is still counted aloud: a backlog that hides its deferrals is one
  // where "nothing is ready" and "everything is waiting on upstream" look alike.
  const deferred = ts.filter((t) => t.fm?.status === "deferred").sort((a, b) => a.fm.id - b.fm.id);
  const defTail = deferred.length
    ? `\n\n  ${deferred.length} ticket(s) are deferred, waiting on something outside the project:\n` +
      deferred.map((t) => `    ${pad(t.fm.id)}  ${t.fm.title}`).join("\n") +
      `\n  'tickets.mjs recheck' runs their re-checks and reports; it never un-defers.`
    : "";
  if (!ready.length) {
    const open = ts.filter((t) => t.fm && ["open", "blocked"].includes(t.fm.status));
    if (!open.length) die(`nothing open. Every ticket is closed or deferred.${defTail}`);
    die(`nothing is ready. ${open.length} ticket(s) are open, but all are blocked or waiting on\n` +
        `  unclosed dependencies. Run 'tickets.mjs list --status blocked' to see why.${defTail}`);
  }

  const gate = new Map(ready.map((t) => [t.fm.id, auditBlockers(t.fm.capability, ts)]));
  const open_ = ready.filter((t) => !gate.get(t.fm.id).length);

  if (flags.all) {
    // The gate refuses to hand over work; it does not hide the backlog.
    if (flags.json) {
      return console.log(JSON.stringify({
        ready: ready.map((t) => ({ ...t.fm, path: t.path, gatedOn: gate.get(t.fm.id)[0] ?? null })),
        deferred: deferred.map((t) => ({ ...t.fm, path: t.path })),
      }, null, 2));
    }
    for (const t of ready) {
      const blockers = gate.get(t.fm.id);
      const mark = blockers.length ? `[GATED on ${blockers[0]}] ` : "";
      console.log(`  ${pad(t.fm.id)}  ${t.fm.priority.padEnd(5)}${t.fm.size === "l" ? "[SIZE:L — SPLIT] " : ""}${mark}${t.fm.title}`);
    }
    for (const t of deferred) {
      console.log(`  ${pad(t.fm.id)}  ${t.fm.priority.padEnd(5)}[DEFERRED] ${t.fm.title}`);
    }
    console.log(`\n  ${ready.length} ready` +
      `${ready.length - open_.length ? `, ${ready.length - open_.length} gated on an unaudited capability` : ""}` +
      `${deferred.length ? `, ${deferred.length} deferred on something outside the project` : ""}`);
    return;
  }

  if (!open_.length) {
    const blocker = gate.get(ready[0].fm.id)[0];
    const stillOpen = openInCapability(blocker, ts);
    if (stillOpen.length) {
      // None of these can be ready — a ready one would have been offered — so every
      // one is blocked or waiting on a dependency. That is the thing to look at.
      die(`every ready ticket is gated on capability '${blocker}', whose audit has not passed (${AUDIT_DOC}).\n\n` +
          `  Its audit cannot pass yet — ${stillOpen.length} ticket(s) in it are still open, and none is ready:\n` +
          `    ${openList(stillOpen)}\n\n` +
          `  They are blocked or waiting on dependencies. 'tickets.mjs show <id>' says why for each.\n` +
          `  Close them first; the audit of '${blocker}' comes after that, not before.\n\n` +
          `  'tickets.mjs next --all' still lists the whole backlog, gated entries marked.`);
    }
    die(`every ready ticket is gated on capability '${blocker}', whose audit has not passed (${AUDIT_DOC}).\n\n` +
        `  A capability is not done when its tickets are closed. It is done when its audit passes,\n` +
        `  and the audit is worth most exactly when there is pressure to skip it.\n\n` +
        `    tickets.mjs audit ${blocker}              the mechanical half\n` +
        `    tickets.mjs audit ${blocker} --sections   the design-conformance reading list\n` +
        `    tickets.mjs audit ${blocker} --record …   record the result\n\n` +
        `  'tickets.mjs next --all' still lists the whole backlog, gated entries marked.`);
  }

  const t = open_[0];
  if (t.fm.size === "l") {
    die(`next ready ticket is ${pad(t.fm.id)} "${t.fm.title}" — but it is size: l.\n` +
        `  'l' is a smell recorded honestly, not a valid plan. Split it into two tickets\n` +
        `  before starting, or pick another with 'tickets.mjs next --all'.`);
  }
  if (flags.json) return console.log(JSON.stringify({ ...t.fm, path: t.path, gated: ready.length - open_.length, deferred: deferred.length }, null, 2));
  console.log(`  ${pad(t.fm.id)}  ${t.fm.title}\n  ${t.path}`);
  const gated = ready.length - open_.length;
  if (gated) {
    const blocker = gate.get(ready.find((r) => gate.get(r.fm.id).length).fm.id)[0];
    const stillOpen = openInCapability(blocker, ts);
    if (stillOpen.length) {
      console.log(`\n  ${gated} higher-priority ticket(s) are gated on capability '${blocker}'.`);
      console.log(`  Its audit cannot pass yet — ${stillOpen.length} ticket(s) in it are still open:`);
      console.log(`    ${openList(stillOpen)}`);
      console.log(`  Close those first; 'tickets.mjs next --all' lists them with the rest of the backlog.`);
    } else {
      console.log(`\n  ${gated} higher-priority ticket(s) are gated on capability '${blocker}' —`);
      console.log(`  its audit has not passed. 'tickets.mjs audit ${blocker}' to start it.`);
    }
  }
  if (deferred.length) {
    console.log(`\n  ${deferred.length} ticket(s) deferred, waiting on something outside the project` +
                ` (${deferred.map((d) => pad(d.fm.id)).join(", ")}).`);
    console.log(`  'tickets.mjs recheck' reports whether any wait is over. It never un-defers.`);
  }
}

// ──────────────────────────────────────────────────────────────── waves ────

/**
 * A capability's open tickets, scheduled by depends_on into waves that can be
 * built in parallel, one agent and one worktree per ticket (docs/capabilities/WAVES.md).
 * Wave 1 is ready now; wave k is ready once waves 1..k-1 have merged. A wave holds
 * at most `max`, because merging is the cost that grows with width: tickets in one
 * capability touch the same files.
 *
 * Waves fill greedily: each takes the highest-priority tickets whose deps are all in
 * earlier waves, so an early unblock never queues behind a layer. Cutting whole
 * topological layers into chunks would make a ticket unblocked by wave 1 wait for
 * every chunk of its predecessor's layer.
 *
 * `held` lists what cannot be scheduled and why: blocked_by, a dependency outside
 * the capability that is not closed, size l, or a dependency on a held ticket.
 */
const WAVE_MAX = 4;

function planWaves(capability, tickets, { max = WAVE_MAX } = {}) {
  const index = byId(tickets);
  const members = openInCapability(capability, tickets);
  const width = Math.max(1, max);
  const inCap = new Set(members.map((t) => t.fm.id));
  const held = new Map();
  for (const t of members) {
    const blockers = t.fm.blocked_by ?? [];
    const outside = (t.fm.depends_on ?? []).filter((d) => !inCap.has(d) && index.get(d)?.fm?.status !== "closed");
    if (blockers.length) held.set(t.fm.id, `blocked by ${blockers.map(pad).join(", ")}`);
    else if (outside.length) held.set(t.fm.id, `waits on ${outside.map((d) => `${pad(d)} (${index.get(d)?.fm?.capability ?? "unknown"})`).join(", ")}, outside this capability`);
    else if (t.fm.size === "l") held.set(t.fm.id, "size l — split it first");
  }
  const waves = [];
  const placed = new Set();
  const inCapDeps = (t) => (t.fm.depends_on ?? []).filter((d) => inCap.has(d));
  let rest = members.filter((t) => !held.has(t.fm.id));
  while (rest.length) {
    const ready = rest.filter((t) => inCapDeps(t).every((d) => placed.has(d)));
    const stuck = rest.filter((t) => !ready.includes(t));
    // A dependency on a held ticket holds this one too; anything else left is a cycle.
    for (const t of stuck) {
      const h = inCapDeps(t).find((d) => held.has(d));
      if (h !== undefined) held.set(t.fm.id, `waits on ${pad(h)}, which is held`);
    }
    if (!ready.length) {
      for (const t of stuck) if (!held.has(t.fm.id)) held.set(t.fm.id, "in a depends_on cycle — run validate");
      break;
    }
    ready.sort((a, b) => (PRIO_RANK[a.fm.priority] ?? 9) - (PRIO_RANK[b.fm.priority] ?? 9) || a.fm.id - b.fm.id);
    const wave = ready.slice(0, width);
    waves.push(wave);
    for (const t of wave) placed.add(t.fm.id);
    rest = rest.filter((t) => !placed.has(t.fm.id) && !held.has(t.fm.id));
  }
  return {
    capability,
    width,
    gatedOn: auditBlockers(capability, tickets),
    waves,
    held: members.filter((t) => held.has(t.fm.id)).map((t) => ({ ticket: t, reason: held.get(t.fm.id) })),
  };
}

/**
 * A bare capability number (`13`, `08`, `8`) names the one capability whose slug starts
 * with it, so `waves 13` works without typing the slug. Anything else passes through
 * unchanged, and the caller's own existence check reports it.
 */
function resolveCapability(arg, ts) {
  if (typeof arg !== "string" || !/^\d{1,2}$/.test(arg)) return arg;
  const n = Number(arg);
  const caps = [...new Set(ts.map((t) => t.fm?.capability).filter((c) => capNumber(c) === n))].sort();
  if (caps.length === 1) return caps[0];
  if (!caps.length) die(`no ticket has a capability numbered ${arg}.`);
  die(`capability ${arg} is ambiguous: ${caps.join(", ")}. Name it in full.`);
}

function cmdWaves(capability, flags) {
  const ts = load();
  if (!capability) {
    // Default: the capability `next` would hand out work from.
    const first = readySet(ts).find((t) => !auditBlockers(t.fm.capability, ts).length);
    if (!first) die("nothing is ready and ungated, so there is no capability to plan. Run 'tickets.mjs next'.");
    capability = first.fm.capability;
  }
  capability = resolveCapability(capability, ts);
  if (!ts.some((t) => t.fm?.capability === capability)) die(`no ticket has capability '${capability}'.`);
  const max = flags.max === undefined ? WAVE_MAX : Number(flags.max);
  if (!Number.isInteger(max) || max < 1) die(`--max must be a positive integer, got '${flags.max}'.`);
  const plan = planWaves(capability, ts, { max });
  const row = (t) => ({ id: t.fm.id, title: t.fm.title, priority: t.fm.priority, size: t.fm.size, path: t.path, depends_on: t.fm.depends_on ?? [] });
  if (flags.json) {
    return console.log(JSON.stringify({
      capability, width: plan.width, gatedOn: plan.gatedOn,
      waves: plan.waves.map((w) => w.map(row)),
      held: plan.held.map((h) => ({ ...row(h.ticket), reason: h.reason })),
    }, null, 2));
  }
  const open = plan.waves.flat().length + plan.held.length;
  console.log(`  ${capability} — ${open} open, ${plan.waves.length} wave(s), at most ${plan.width} per wave`);
  if (plan.gatedOn.length) {
    console.log(`\n  GATED: capability '${plan.gatedOn[0]}' has not passed its audit (${AUDIT_DOC}). No wave here is workable yet.`);
  }
  plan.waves.forEach((w, i) => {
    console.log(`\n  wave ${i + 1}  ${i === 0 ? "(ready now)" : `(after wave ${i} merges)`}`);
    for (const t of w) console.log(`    ${pad(t.fm.id)}  ${t.fm.priority.padEnd(5)}${t.fm.size}  ${t.fm.title}`);
  });
  if (plan.held.length) {
    console.log(`\n  held`);
    for (const h of plan.held) console.log(`    ${pad(h.ticket.fm.id)}  ${h.reason}`);
  }
  if (!open) console.log(`\n  Nothing open. 'tickets.mjs audit ${capability}' is next.`);
}

function rewrite(t, fm, body = t.body) {
  writeFileSync(join(ROOT, t.path), serialize(fm, body));
}

/**
 * Refuse a frontmatter value outside ENUMS, BEFORE anything is written.
 *
 * Reads the same ENUMS `validate` reads — a second list here would be a value
 * the writer accepts and the validator rejects, with a longer fuse. Table-driven
 * over every enum field, so a field added to ENUMS is checked by every writer
 * without anyone remembering to add an `if`.
 */
function checkEnums(fm, name) {
  for (const [k, allowed] of Object.entries(ENUMS)) {
    if (k in fm && !allowed.includes(fm[k])) {
      die(`${name(k)} must be one of: ${allowed.join(", ")} (got '${fm[k]}'). Nothing was written.`);
    }
  }
}

function cmdCreate(flags) {
  if (!flags.title || !flags.type || !flags.priority) die("create requires --title, --type and --priority");
  const id = nextId();
  const slug = flags.slug ?? slugify(flags.title);
  if (!SLUG_RE.test(slug)) die(`derived slug '${slug}' is not kebab-case; pass --slug`);
  const fm = {
    id, slug, title: flags.title, type: flags.type, priority: flags.priority,
    status: "open", size: flags.size ?? "m", capability: flags.capability ?? "null",
    depends_on: flags.depends ? String(flags.depends).split(",").map(Number) : [], blocked_by: [],
    source: flags.source ?? "agent", created: now(),
  };
  checkEnums(fm, (k) => `--${k}`);
  // Type-specific sections are REQUIRED by validate. Emitting them here rather
  // than leaving them to be remembered is the difference between `create`
  // producing a valid ticket and producing one that fails validation seconds later.
  const extra = fm.type === "bug"
    ? "\n## Steps to reproduce\n\n1. TODO\n\n## Expected vs actual\n\n**Expected:** TODO\n\n**Actual:** TODO\n"
    : fm.type === "design"
    ? "\n## Options considered\n\nTODO\n\n## Open questions\n\n- TODO\n"
    : "";
  const body = `\n## Description\n\n${flags.body ?? "TODO"}\n\n## Acceptance criteria\n\n- [ ] TODO\n${extra}\n## Notes\n\nTODO\n\n## Operator validation\n\nTODO\n`;
  const path = `${DIRS.open}/${pad(id)}-${slug}.md`;
  mkdirSync(join(ROOT, DIRS.open), { recursive: true });
  writeFileSync(join(ROOT, path), serialize(fm, body));
  writeIndex();
  if (flags.json) console.log(JSON.stringify({ id, path }, null, 2));
  else console.log(path);
}

function cmdStart(id) {
  const ts = load(); const t = byId(ts).get(Number(id)) ?? die(`no ticket ${id}`);
  if (t.fm.started) return console.log(`${pad(t.fm.id)} already started at ${t.fm.started}`);
  rewrite(t, { ...t.fm, started: now() });
  writeIndex();
  console.log(`started ${pad(t.fm.id)}`);
}

function cmdBlock(id, flags) {
  if (!flags.on) die("block requires --on <id>");
  const ts = load(); const index = byId(ts);
  const t = index.get(Number(id)) ?? die(`no ticket ${id}`);
  const on = Number(flags.on);
  if (!index.has(on)) die(`cannot block on ${pad(on)}: no such ticket. Nothing changed.`);
  if (on === t.fm.id) die(`a ticket cannot block itself. Nothing changed.`);
  const trial = new Map(index);
  trial.set(t.fm.id, { ...t, fm: { ...t.fm, blocked_by: [...new Set([...(t.fm.blocked_by ?? []), on])] } });
  const cyc = findCycles(trial);
  if (cyc.length) die(`that edge would create a cycle: ${cyc[0].map(pad).join(" → ")}\n  Nothing changed.`);
  const fm = { ...t.fm, blocked_by: [...new Set([...(t.fm.blocked_by ?? []), on])], status: "blocked" };
  let body = t.body;
  if (flags.reason) {
    const note = `\n**Blocked ${today()} on ${pad(on)}:** ${flags.reason}\n`;
    body = body.includes("## Notes") ? body.replace(/(^##\s+Notes\s*$)/im, `$1\n${note}`) : body + `\n## Notes\n${note}`;
  }
  rewrite(t, fm, body); writeIndex();
  console.log(`${pad(t.fm.id)} blocked on ${pad(on)}`);
}

function cmdUnblock(id, flags) {
  if (!flags.on) die("unblock requires --on <id>");
  const ts = load(); const t = byId(ts).get(Number(id)) ?? die(`no ticket ${id}`);
  const on = Number(flags.on);
  const remaining = (t.fm.blocked_by ?? []).filter((d) => d !== on);
  const fm = { ...t.fm, blocked_by: remaining, status: remaining.length ? "blocked" : "open" };
  rewrite(t, fm); writeIndex();
  console.log(`${pad(t.fm.id)} unblocked from ${pad(on)} — status now ${fm.status}`);
}

/**
 * `defer` and `resume` — entering and leaving the `deferred` status.
 *
 * Deliberately NOT a `git mv`: `deferred` lives in `open/` exactly as `blocked`
 * does. The folder is the coarse state — live / done — and a deferred ticket is
 * still live work, just not available. Both commands maintain `index.json`, so
 * no frontmatter is ever hand-edited into this state.
 */
function cmdDefer(id, flags) {
  const ts = load();
  const t = byId(ts).get(Number(id)) ?? die(`no ticket ${id}`);
  const reason = typeof flags.reason === "string" ? flags.reason.trim() : "";
  const file = typeof flags["recheck-file"] === "string" ? flags["recheck-file"] : null;
  const recheck = file
    ? readFileSync(existsSync(file) ? file : join(ROOT, file), "utf8").trim()
    : (typeof flags.recheck === "string" ? flags.recheck.trim() : "");

  if (!reason) {
    die(`defer requires --reason "…".\n` +
        `  Say what is being waited on, and name the third party. A deferral with no reason is\n` +
        `  indistinguishable from a ticket nobody got around to — which is the thing this\n` +
        `  status exists to stop looking the same.`);
  }
  if (!recheck) {
    die(`defer requires --recheck "<shell>" (or --recheck-file <path>).\n` +
        `  The cheap test that says the wait is over — the two-minute version, not the ticket.\n` +
        `  It is run by 'tickets.mjs recheck' and REPORTED; nothing un-defers on its own.\n` +
        `  A deferral with no re-check is a wait with no end condition.`);
  }
  if (t.folder !== "open") {
    die(`${pad(t.fm.id)} is in ${t.folder}/. Only a live ticket can be deferred — a closed one is done.`);
  }
  if (t.fm.status === "deferred") die(`${pad(t.fm.id)} is already deferred. 'resume ${pad(t.fm.id)}' first if the wait is over.`);
  if ((t.fm.blocked_by ?? []).length) {
    die(`${pad(t.fm.id)} has blocked_by ${(t.fm.blocked_by).map(pad).join(", ")}. That is 'blocked', not 'deferred'.\n` +
        `  'blocked' means another ticket in this backlog has to land first, and closing it clears\n` +
        `  the block automatically. 'deferred' means nothing in this backlog can clear it. Unblock\n` +
        `  first if the dependency was really an external wait.`);
  }

  const fm = { ...t.fm, status: "deferred", deferred: now() };
  rewrite(t, fm, insertAfterSection(t.body, "Description", deferredSection(reason, recheck, t.fm.id)));
  writeIndex();
  console.log(`deferred ${pad(t.fm.id)} — out of the ready set, and out of its capability's close gate.`);
  console.log(`  'tickets.mjs recheck ${pad(t.fm.id)}' runs the re-check; 'resume ${pad(t.fm.id)}' brings it back.`);
}

function cmdResume(id, flags) {
  const ts = load();
  const t = byId(ts).get(Number(id)) ?? die(`no ticket ${id}`);
  if (t.fm.status !== "deferred") die(`${pad(t.fm.id)} is not deferred (status: ${t.fm.status}). Nothing changed.`);
  const fm = { ...t.fm, status: "open" };
  delete fm.deferred;
  const stamp = today();
  const note = `**Resumed ${stamp}:** ${typeof flags.reason === "string" ? flags.reason : "the wait is over — re-check read by hand."}`;
  rewrite(t, fm, closeDeferredSection(t.body, stamp, note));
  writeIndex();
  console.log(`resumed ${pad(t.fm.id)} — status now open, back in the ready set and back in`);
  console.log(`  '${t.fm.capability}'s close gate. The old '## Deferred' section is kept, renamed.`);
}

/**
 * `recheck` — runs the re-check condition and REPORTS. It changes nothing, ever.
 *
 * Leaving the state is not automatic. A ticket that silently un-defers is a
 * ticket nobody looks at, and the whole value of the status is that somebody
 * reads the result and decides. So this exits 0 whatever the outcome — it is a
 * report, not a gate, and a failing re-check is the expected case.
 */
function cmdRecheck(id, flags) {
  const ts = load();
  const targets = id
    ? [byId(ts).get(Number(id)) ?? die(`no ticket ${id}`)]
    : ts.filter((t) => t.fm?.status === "deferred").sort((a, b) => a.fm.id - b.fm.id);
  if (id && targets[0].fm.status !== "deferred") {
    die(`${pad(targets[0].fm.id)} is not deferred (status: ${targets[0].fm.status}) — there is no re-check to run.`);
  }
  if (!targets.length) {
    if (flags.json) return console.log("[]");
    return console.log(`\n  no deferred tickets — nothing is waiting on anything outside the project.\n`);
  }

  const results = [];
  for (const t of targets) {
    const { recheck } = deferral(t.body);
    if (!recheck) {
      results.push({ id: t.fm.id, title: t.fm.title, passes: false, detail: "no fenced re-check block (validate reports this)" });
      continue;
    }
    const r = runShell(recheck, { timeout: 600_000 });
    results.push({ id: t.fm.id, title: t.fm.title, passes: r.outcome === "pass", detail: r.detail || "exit 0" });
  }
  if (flags.json) return console.log(JSON.stringify(results, null, 2));

  console.log(`\n  re-checks — reported, never acted on\n`);
  for (const r of results) console.log(`   ${r.passes ? "PASSES" : " waits"}  ${pad(r.id)}  ${r.detail}`);
  const passing = results.filter((r) => r.passes);
  console.log(passing.length
    ? `\n  ${passing.length} wait(s) may be over. Nothing was changed — read the output, then:\n` +
      passing.map((r) => `    tickets.mjs resume ${pad(r.id)}`).join("\n") + "\n"
    : `\n  every wait is still on. Nothing to do.\n`);
}

function cmdClose(id, flags) {
  const ts = load(); const index = byId(ts);
  const t = index.get(Number(id)) ?? die(`no ticket ${id}`);
  requireCleanTree("close", flags["allow-dirty"], t.path);
  if (t.folder === "closed") die(`${pad(t.fm.id)} is already closed.`);

  const { unchecked, pendingOperator, unsignedOperator } = acceptance(t.body);
  if (unchecked.length) {
    // Two different refusals, because the right answer differs. "Do the work or
    // amend it" is advice an agent can act on alone — which for an operator
    // criterion means ticking it, the exact failure the marker exists to stop.
    const tail = pendingOperator.length
      ? `\n\n  ${pendingOperator.length} of these can only be checked by a human:\n` +
        pendingOperator.map((u) => `    - [ ] ${u}`).join("\n") +
        `\n\n  Do NOT tick these. Leave the ticket open, commit the work, and close it in a\n` +
        `  later session once the operator has actually run them — recording the result as\n` +
        `  '— verified YYYY-MM-DD: <what happened>' on the criterion itself. A ticket that\n` +
        `  closes a session late is the rule working; one pre-ticked to close today ships\n` +
        `  something nobody saw run.`
      : `\n\n  There is no --force. Either do the work, or edit the criterion and say why in\n` +
        `  ## Resolution. A criterion quietly ticked is a criterion that never existed.`;
    die(`${pad(t.fm.id)} has ${unchecked.length} unchecked acceptance criteria:\n` +
        unchecked.map((u) => `    - [ ] ${u}`).join("\n") + tail);
  }
  if (unsignedOperator.length) {
    die(`${pad(t.fm.id)} has ${unsignedOperator.length} operator criteria ticked with no sign-off:\n` +
        unsignedOperator.map((u) => `    - [x] ${u}`).join("\n") +
        `\n\n  An operator criterion is ticked by recording what the operator saw, not by\n` +
        `  marking it done. Append the result to the criterion:\n` +
        `    - [x] (operator) … — verified ${today()}: <what happened>\n\n` +
        `  If the operator has not run it yet, the ticket is not closeable yet. That is the\n` +
        `  rule working, not an obstacle to route around.`);
  }
  const missing = ["Resolution", "Operator validation"].filter((s) => !hasSection(t.body, s));
  if (missing.length) die(`${pad(t.fm.id)} cannot close: missing ${missing.map((m) => `'## ${m}'`).join(" and ")}.`);

  const fm = { ...t.fm, status: "closed", closed: now() };
  const dest = `${DIRS.closed}/${t.file}`;
  moveTicketFile(t.path, dest, serialize(fm, t.body));
  const after = load();
  writeIndex(after);

  console.log(`closed ${pad(t.fm.id)} → ${dest}`);
  const afterIdx = byId(after);
  const referrers = after.filter((o) => o.fm && [...(o.fm.depends_on ?? []), ...(o.fm.blocked_by ?? [])].includes(t.fm.id));
  if (referrers.length) {
    console.log(`\n  ${referrers.length} ticket(s) referenced ${pad(t.fm.id)}:`);
    for (const r of referrers) {
      console.log(`    ${pad(r.fm.id)}  ${isReady(r, afterIdx) ? "NOW READY" : "still waiting"}  ${r.fm.title}`);
    }
  }
}

// ──────────────────────────────────────────────────────────────────── main ────

const USAGE = `tickets.mjs <command>

  index                       rebuild tickets/index.json
  list [filters]              --status --type --priority --capability --size --ready
  show <id>                   raw markdown + dependency status
  validate                    exit 1 on errors, 0 on warnings only
  next [--all]                highest-priority ready, ungated ticket; refuses size:l
  waves [<capability>] [--max N]  open tickets layered into parallel waves (default 4 wide);
                                  <capability> may be its number, e.g. 3
  allocate                    next free id
  create --title --type --priority [--size --capability --slug --depends --source --body]
  start <id>
  block <id> --on <id> [--reason "..."]
  unblock <id> --on <id>
  defer <id> --reason "..." --recheck "<shell>" | --recheck-file <path>
  resume <id> [--reason "..."]
  recheck [<id>]              run deferred tickets' re-checks and REPORT; never un-defers
  close <id> [--allow-dirty]
  audit <capability>          mechanical checks (${AUDIT_DOC}); exit 1 on any failure
  audit <capability> --sections   docs this capability's tickets cite — the reading list
  audit <capability> --record (--divergence "<res>|<ref>|<desc>"... | --no-divergences) [--force "<reason>"]

  --json works on index, list, show, validate, next, waves, create, audit, recheck.`;

// Only dispatch when run directly. Without this, `import`ing the module for
// tests executes the CLI, hits the default case, prints help and exits — which
// makes the module untestable and the failure baffling.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

// Flags that never take a value, so `close --allow-dirty 12` still reads 12 as the id
// and `waves --max 3` never reads 3 as a capability.
const BOOLEAN_FLAGS = new Set(["json", "all", "ready", "allow-dirty", "record", "sections", "no-divergences"]);

const argv = process.argv.slice(2);
const cmd = argv[0];
const positional = [];
const flags = {};
for (let i = 1; i < argv.length; i++) {
  if (!argv[i].startsWith("--")) { positional.push(argv[i]); continue; }
  const k = argv[i].slice(2);
  const v = !BOOLEAN_FLAGS.has(k) && argv[i + 1] !== undefined && !argv[i + 1].startsWith("--") ? argv[++i] : true;
  // Repeats accumulate rather than overwrite: `--divergence a --divergence b`
  // is a list. Every other flag is passed once, so this changes nothing for them.
  flags[k] = k in flags ? [].concat(flags[k], v) : v;
}

if (isMain) try {
  switch (cmd) {
    case "index": cmdIndex(flags); break;
    case "list": cmdList(flags); break;
    case "show": cmdShow(positional[0], flags); break;
    case "validate": cmdValidate(flags); break;
    case "allocate": cmdAllocate(); break;
    case "next": cmdNext(flags); break;
    case "waves": cmdWaves(positional[0], flags); break;
    case "create": cmdCreate(flags); break;
    case "start": cmdStart(positional[0]); break;
    case "block": cmdBlock(positional[0], flags); break;
    case "unblock": cmdUnblock(positional[0], flags); break;
    case "defer": cmdDefer(positional[0], flags); break;
    case "resume": cmdResume(positional[0], flags); break;
    case "recheck": cmdRecheck(positional[0], flags); break;
    case "close": cmdClose(positional[0], flags); break;
    case "audit": cmdAudit(positional[0], flags); break;
    default:
      console.log(USAGE);
      process.exit(cmd ? 1 : 0);
  }
} catch (err) {
  die(err.message);
}

export {
  planWaves, deferral, insertAfterSection, closeDeferredSection, auditChecks, auditBlockers,
  latestAuditRecord, reflectSection, parseAuditChecks, citedSections, parse, serialize, acceptance,
  isReady, findCycles, readySet, validate, buildIndex, missingSections, duplicateSections,
  SECTION_RULES, slugify, FIELD_ORDER, ENUMS,
};
