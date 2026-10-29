/**
 * Tests for templates/.claude/skills/tickets/scripts/tickets.mjs.
 *
 * These stay in the kit repo; only the script is installed. node:test is built
 * into Node, so this needs no package.json and no install:
 *
 *   node --test tests/
 *
 * Most tests drive the CLI against a throwaway git repo, because the script's
 * contract is its command line and the files it leaves on disk.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../templates/.claude/skills/tickets/scripts/tickets.mjs", import.meta.url));

// The in-process functions read ROOT at import time. Point it at an empty
// directory so nothing under test can read the kit's own templates/ as a project.
const EMPTY_ROOT = mkdtempSync(join(tmpdir(), "tickets-root-"));
process.env.TICKETS_ROOT = EMPTY_ROOT;
const {
  planWaves, parse, serialize, acceptance, isReady, findCycles, missingSections, duplicateSections,
  slugify, deferral, parseAuditChecks, ENUMS,
} = await import(SCRIPT);

// ───────────────────────────────────────────────────────────────── helpers ────

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "tickets-test-"));
  for (const d of ["tickets/open", "tickets/closed", "docs/capabilities"]) {
    mkdirSync(join(dir, d), { recursive: true });
  }
  // The doc for FM()'s default capability. A capability with no doc is a
  // validate ERROR — it can never pass an audit and gates every ticket above
  // it — so a fixture repo without this one is not a valid repo.
  writeFileSync(join(dir, "docs/capabilities/00-x.md"), "# 00-x\n");
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "t"], { cwd: dir });
  return dir;
}

const FM = (o) => ({
  id: 1, slug: "a-ticket", title: "A ticket", type: "feature", priority: "high",
  status: "open", size: "m", capability: "00-x", depends_on: [], blocked_by: [],
  source: "operator", created: "2026-08-30T00:00:00Z", ...o,
});

const BODY = `
## Description

x

## Acceptance criteria

- [ ] one

## Notes

x

## Operator validation

x
`;

const BODY_OK = "\n## Description\n\nx\n\n## Acceptance criteria\n\n- [ ] a\n\n## Notes\n\nx\n\n## Operator validation\n\nx\n";
const BODY_CLOSED = "\n## Description\n\nx\n\n## Acceptance criteria\n\n- [x] a\n\n## Notes\n\nx\n\n## Operator validation\n\nx\n\n## Resolution\n\nx\n";
const REFLECT = "\n## Reflection\n\n" + "The design got the validator's flat rule list right, which is why conformance could be checked line by line rather than argued about. ".repeat(3) + "\n";

function ticket(dir, folder, fm, body = BODY) {
  const name = `${String(fm.id).padStart(4, "0")}-${fm.slug}.md`;
  writeFileSync(join(dir, "tickets", folder, name), serialize(fm, body));
  return join("tickets", folder, name);
}

const run = (dir, ...args) => runIn(dir, dir, ...args);
const runIn = (cwd, dir, ...args) => {
  // spawnSync, not execFileSync: validate writes warnings to stderr, and a
  // helper that only captures stderr on failure silently hides them on success.
  const r = spawnSync("node", [SCRIPT, ...args], {
    cwd, env: { ...process.env, TICKETS_ROOT: dir }, encoding: "utf8",
  });
  return { code: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
};
const commitAll = (dir, msg = "x") => {
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-q", "--no-verify", "-m", msg], { cwd: dir });
};
const validateIn = (dir) => JSON.parse(run(dir, "validate", "--json").out);
const records = (d, cap) => [...readFileSync(join(d, "docs/capabilities", `${cap}.md`), "utf8")
  .matchAll(/<!--\s*audit-record\s+(\{.*?\})\s*-->/g)].map((m) => JSON.parse(m[1]));
const cleanup = (...dirs) => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); };

// ─────────────────────────────────────────────────────────────── parsing ────

describe("parse / serialize", () => {
  test("a title containing a colon and a # round-trips byte-identically", () => {
    const fm = FM({ title: "Fix: the #42 thing: really" });
    const raw = serialize(fm, BODY);
    const p = parse(raw);
    assert.equal(p.fm.title, "Fix: the #42 thing: really");
    assert.equal(serialize(p.fm, p.body), raw);
  });

  test("an unknown frontmatter key is preserved on rewrite", () => {
    const raw = serialize({ ...FM(), experimental_field: "keep me" }, BODY);
    const p = parse(raw);
    assert.equal(p.fm.experimental_field, "keep me");
    assert.match(serialize(p.fm, p.body), /experimental_field: keep me/);
  });

  test("rewritten frontmatter follows FIELD_ORDER and the body is byte-identical", () => {
    // deliberately scrambled input order
    const scrambled = `---\ncreated: 2026-08-30T00:00:00Z\ntitle: T\nid: 1\ntype: feature\nslug: s\npriority: high\nstatus: open\nsize: m\ncapability: 00-x\ndepends_on: []\nblocked_by: []\nsource: operator\n---\n${BODY}`;
    const p = parse(scrambled);
    const out = serialize(p.fm, p.body);
    const keys = out.split("\n---\n")[0].replace(/^---\n/, "").split("\n").map((l) => l.split(":")[0]);
    assert.deepEqual(keys.slice(0, 6), ["id", "slug", "title", "type", "priority", "status"]);
    assert.equal(out.split(/\n---\n/)[1], BODY);
  });

  test("empty and populated arrays round-trip", () => {
    assert.deepEqual(parse(serialize(FM({ depends_on: [] }), BODY)).fm.depends_on, []);
    assert.deepEqual(parse(serialize(FM({ depends_on: [3, 11] }), BODY)).fm.depends_on, [3, 11]);
  });

  test("a nested or otherwise non-flat line is refused, not reformatted", () => {
    const p = parse("---\nid: 1\n  nested: x\n---\nbody\n");
    assert.equal(p.fm, null);
    assert.match(p.error, /unparseable frontmatter line/);
  });
});

describe("acceptance counting", () => {
  test("counts only checkboxes under ## Acceptance criteria, stopping at the next ##", () => {
    const body = `
## Acceptance criteria

- [x] done
- [ ] not done

## Notes

- [ ] this looks like a checkbox but is in Notes
- [x] so is this

## Operator validation

- [ ] and this
`;
    const a = acceptance(body);
    assert.equal(a.total, 2, "must not count checkbox-looking lines outside the section");
    assert.equal(a.checked, 1);
    assert.deepEqual(a.unchecked, ["not done"]);
  });
});

// ────────────────────────────────────────────────────────────── validation ────

describe("validate flags exactly the right rule", () => {
  const cases = [
    ["filename", (d) => { writeFileSync(join(d, "tickets/open/0009-wrong-name.md"), serialize(FM({ id: 9, slug: "right-name" }), BODY)); }],
    ["duplicate-id", (d) => { ticket(d, "open", FM({ id: 1, slug: "a" })); ticket(d, "open", FM({ id: 1, slug: "b" })); }],
    ["enum", (d) => ticket(d, "open", FM({ priority: "urgent" }))],
    ["status-folder", (d) => ticket(d, "open", FM({ status: "closed" }))],
    ["blocked-status", (d) => { ticket(d, "open", FM({ id: 1, blocked_by: [2], status: "open" })); ticket(d, "open", FM({ id: 2, slug: "b" })); }],
    ["dangling-ref", (d) => ticket(d, "open", FM({ depends_on: [999] }))],
    ["self-edge", (d) => ticket(d, "open", FM({ id: 1, depends_on: [1] }))],
    ["cycle", (d) => { ticket(d, "open", FM({ id: 1, depends_on: [2] })); ticket(d, "open", FM({ id: 2, slug: "b", depends_on: [1] })); }],
    ["closed-section", (d) => ticket(d, "closed", FM({ status: "closed", closed: "2026-08-30T00:00:00Z" }), "\n## Acceptance criteria\n\n- [x] a\n")],
    ["closed-unchecked", (d) => ticket(d, "closed", FM({ status: "closed", closed: "2026-08-30T00:00:00Z" }), "\n## Acceptance criteria\n\n- [ ] a\n\n## Resolution\n\nx\n\n## Operator validation\n\nx\n")],
    ["closed-stamp", (d) => ticket(d, "open", FM({ closed: "2026-08-30T00:00:00Z" }))],
    // Deliberately in open/: an operator criterion ticked with no dated result is
    // wrong where it is written, not only where it lands.
    ["operator-unsigned", (d) => ticket(d, "open", FM(), "\n## Acceptance criteria\n\n- [x] (operator) ran it on the phone\n")],
    ["bug-section", (d) => ticket(d, "open", FM({ type: "bug" }))],
    ["design-section", (d) => ticket(d, "open", FM({ type: "design" }))],
    ["missing-section", (d) => ticket(d, "open", FM(), "\n## Description\n\nx\n")],
    ["required-field", (d) => { const { size, ...rest } = FM(); writeFileSync(join(d, "tickets/open/0001-a-ticket.md"), serialize(rest, BODY)); }],
    ["frontmatter", (d) => writeFileSync(join(d, "tickets/open/0001-a-ticket.md"), "no frontmatter here\n")],
    ["unknown-capability", (d) => ticket(d, "open", FM({ capability: "07-nope" }))],
  ];
  for (const [rule, setup] of cases) {
    test(`flags '${rule}'`, () => {
      const d = repo(); setup(d);
      const { errors } = validateIn(d);
      assert.ok(errors.some((e) => e.rule === rule), `expected rule '${rule}', got: ${errors.map((e) => e.rule).join(",") || "none"}`);
      cleanup(d);
    });
  }

  test("an unknown key is a WARNING, and validate still exits 0", () => {
    const d = repo();
    writeFileSync(join(d, "tickets/open/0001-a-ticket.md"), serialize({ ...FM(), weird: "x" }, BODY));
    const r = run(d, "validate");
    assert.equal(r.code, 0, "warnings alone must not fail");
    assert.match(r.out, /unknown-key/);
    cleanup(d);
  });

  test("a feature with no capability warns while open, and stops warning once closed", () => {
    // The warning asks "where does this feature belong?" — a question nobody will
    // answer about closed work. Left unscoped, the warning list only grows.
    const d = repo();
    ticket(d, "open", FM({ capability: "null" }));
    let r = run(d, "validate");
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /no-capability/);
    rmSync(join(d, "tickets/open/0001-a-ticket.md"));
    ticket(d, "closed", FM({ capability: "null", status: "closed", closed: "2026-08-30T00:00:00Z" }), BODY_CLOSED);
    r = run(d, "validate");
    assert.doesNotMatch(r.out, /no-capability/, r.out);
    cleanup(d);
  });

  test("a size:l ticket in the ready set is a warning", () => {
    const d = repo();
    ticket(d, "open", FM({ size: "l" }));
    const r = run(d, "validate");
    assert.equal(r.code, 0);
    assert.match(r.out, /size-l-ready/);
    cleanup(d);
  });

  test("the removed values are gone: status inbox and source ui are enum errors", () => {
    const d = repo();
    ticket(d, "open", FM({ source: "ui" }));
    ticket(d, "open", FM({ id: 2, slug: "b", status: "inbox" }));
    const { errors } = validateIn(d);
    assert.ok(errors.some((e) => e.rule === "enum" && /source='ui'/.test(e.msg)));
    assert.ok(errors.some((e) => e.rule === "enum" && /status='inbox'/.test(e.msg)));
    cleanup(d);
  });
});

// ──────────────────────────────────────────── capability docs must exist ────

describe("a capability with no doc is an error, because it gates every ticket above it", () => {
  const cap = (d, name) => writeFileSync(join(d, "docs/capabilities", `${name}.md`), `# ${name}\n`);

  test("a mistyped capability fails validate rather than warning, and says what it costs", () => {
    // The gate builds its blocker list from ticket FRONTMATTER, not from
    // docs/capabilities/, so a typo invents a capability that sorts below the
    // real ones and can never record a verdict.
    const d = repo();
    cap(d, "00-preflight");
    ticket(d, "open", FM({ capability: "00-foundations" }));
    const r = run(d, "validate");
    assert.notEqual(r.code, 0, `an unauditable capability must fail validate:\n${r.out}`);
    assert.match(r.out, /unknown-capability/);
    assert.match(r.out, /00-foundations/);
    assert.match(r.out, /gates every ticket above it/);
    cleanup(d);
  });

  test("an unnumbered capability is unknown even when its doc exists — the gate orders by number", () => {
    const d = repo();
    cap(d, "foundations");
    ticket(d, "open", FM({ capability: "foundations" }));
    const r = run(d, "validate");
    assert.notEqual(r.code, 0);
    assert.match(r.out, /unknown-capability.*NN-name/);
    cleanup(d);
  });

  test("the process docs in docs/capabilities/ are not capabilities", () => {
    const d = repo();
    for (const f of ["WORKFLOW", "TEMPLATE", "AUDIT", "WAVES"]) cap(d, f);
    ticket(d, "open", FM({ capability: "AUDIT" }));
    assert.match(run(d, "validate").out, /unknown-capability/);
    const a = run(d, "audit", "AUDIT");
    assert.notEqual(a.code, 0);
    assert.match(a.out, /no capability 'AUDIT'/);
    cleanup(d);
  });

  test("the phantom capability really does gate — and correcting the name lifts it", () => {
    const d = repo();
    cap(d, "00-preflight"); cap(d, "02-deploy");
    writeFileSync(join(d, "docs/capabilities/00-preflight.md"),
      `# 00\n\n<!-- audit-record {"capability":"00-preflight","verdict":"pass"} -->\n`);
    ticket(d, "open", FM({ id: 1, slug: "phantom", capability: "00-foundations", priority: "low" }));
    ticket(d, "open", FM({ id: 2, slug: "real-work", capability: "02-deploy", priority: "high" }));

    let out = run(d, "next").out;
    assert.match(out, /gated on capability '00-foundations'/, `expected the phantom to gate:\n${out}`);

    const p = join(d, "tickets/open/0001-phantom.md");
    writeFileSync(p, readFileSync(p, "utf8").replace("00-foundations", "00-preflight"));
    out = run(d, "next").out;
    assert.doesNotMatch(out, /00-foundations/, out);
    assert.match(out, /0002/, `the gated ticket must now be offered:\n${out}`);
    assert.equal(run(d, "validate").code, 0, "and validate must be clean again");
    cleanup(d);
  });

  test("capability: null is still allowed — it means 'no home yet', not a typo", () => {
    const d = repo();
    ticket(d, "open", FM({ type: "chore", capability: "null" }));
    const r = run(d, "validate");
    assert.equal(r.code, 0, `an explicit null capability is not an unknown one:\n${r.out}`);
    assert.doesNotMatch(r.out, /unknown-capability/);
    cleanup(d);
  });
});

// ──────────────────────────────────────────────────── ready set + cycles ────

describe("ready set", () => {
  const idx = (arr) => new Map(arr.map((fm) => [fm.id, { fm }]));

  test("blocked_by non-empty is never ready, even with all depends_on closed", () => {
    const m = idx([FM({ id: 1, status: "closed" }), FM({ id: 2, depends_on: [1], blocked_by: [1], status: "blocked" })]);
    assert.equal(isReady(m.get(2), m), false);
  });

  test("depends_on an OPEN ticket is not ready; it becomes ready when that closes", () => {
    let m = idx([FM({ id: 7, status: "open" }), FM({ id: 9, depends_on: [7] })]);
    assert.equal(isReady(m.get(9), m), false);
    m = idx([FM({ id: 7, status: "closed" }), FM({ id: 9, depends_on: [7] })]);
    assert.equal(isReady(m.get(9), m), true, "no manual edit should be needed");
  });

  test("a closed or deferred ticket is never in the ready set", () => {
    const m = idx([FM({ id: 1, status: "closed" }), FM({ id: 2, status: "deferred" })]);
    assert.equal(isReady(m.get(1), m), false);
    assert.equal(isReady(m.get(2), m), false);
  });

  test("next orders by priority, then lowest id, and refuses a size:l pick", () => {
    const d = repo();
    ticket(d, "open", FM({ id: 1, slug: "a", priority: "low" }), BODY_OK);
    ticket(d, "open", FM({ id: 3, slug: "c", priority: "high" }), BODY_OK);
    ticket(d, "open", FM({ id: 2, slug: "b", priority: "high" }), BODY_OK);
    assert.equal(JSON.parse(run(d, "next", "--json").out).id, 2);

    const e = repo();
    ticket(e, "open", FM({ id: 1, slug: "big", size: "l" }), BODY_OK);
    const r = run(e, "next");
    assert.notEqual(r.code, 0);
    assert.match(r.out, /size: l/);
    assert.match(run(e, "next", "--all").out, /\[SIZE:L — SPLIT\]/);
    cleanup(d, e);
  });

  test("next --all --json lists the ready set with each ticket's gate", () => {
    const d = repo();
    writeFileSync(join(d, "docs/capabilities/01-b.md"), "# 01-b\n");
    ticket(d, "open", FM({ id: 1, slug: "a" }), BODY_OK);
    ticket(d, "open", FM({ id: 2, slug: "b", capability: "01-b" }), BODY_OK);
    const j = JSON.parse(run(d, "next", "--all", "--json").out);
    assert.deepEqual(j.ready.map((t) => [t.id, t.gatedOn]), [[1, null], [2, "00-x"]]);
    assert.deepEqual(j.deferred, []);
    cleanup(d);
  });
});

describe("cycle detection", () => {
  const g = (spec) => new Map(Object.entries(spec).map(([id, deps]) => [Number(id), { fm: FM({ id: Number(id), depends_on: deps, blocked_by: [] }) }]));

  test("a linear chain has no cycle", () => assert.equal(findCycles(g({ 1: [], 2: [1], 3: [2] })).length, 0));
  test("a diamond has no cycle", () => assert.equal(findCycles(g({ 1: [], 2: [1], 3: [1], 4: [2, 3] })).length, 0));
  test("a 3-node cycle is found and names every participant", () => {
    const c = findCycles(g({ 1: [3], 2: [1], 3: [2] }));
    assert.equal(c.length, 1);
    assert.deepEqual([...new Set(c[0])].sort(), [1, 2, 3]);
  });
  test("a self-edge is a cycle", () => {
    const c = findCycles(g({ 1: [1] }));
    assert.equal(c.length, 1);
    assert.deepEqual([...new Set(c[0])], [1]);
  });
  test("a cycle through blocked_by only is found", () => {
    const m = new Map([
      [1, { fm: FM({ id: 1, depends_on: [], blocked_by: [2] }) }],
      [2, { fm: FM({ id: 2, depends_on: [], blocked_by: [1] }) }],
    ]);
    assert.equal(findCycles(m).length, 1);
  });
  test("a mixed depends_on / blocked_by cycle is found", () => {
    const m = new Map([
      [1, { fm: FM({ id: 1, depends_on: [2], blocked_by: [] }) }],
      [2, { fm: FM({ id: 2, depends_on: [], blocked_by: [1] }) }],
    ]);
    assert.equal(findCycles(m).length, 1);
  });
  test("a dangling id does not crash and is simply not an edge", () => {
    assert.equal(findCycles(g({ 1: [999] })).length, 0);
  });
});

// ──────────────────────────────────────────────────────────────── mutations ────

describe("allocate", () => {
  test("ids do not reset when the highest id is in closed/", () => {
    const d = repo();
    ticket(d, "open", FM({ id: 3, slug: "low" }));
    ticket(d, "closed", FM({ id: 41, slug: "high", status: "closed", closed: "2026-08-30T00:00:00Z" }), BODY_CLOSED);
    assert.equal(run(d, "allocate").out.trim(), "0042");
    // Max-plus-one, never gap-filling: create gets the same next id.
    assert.match(run(d, "create", "--title", "Next", "--type", "chore", "--priority", "low").out, /0042/);
    cleanup(d);
  });

  test("an empty backlog starts at 0001", () => {
    const d = repo();
    assert.equal(run(d, "allocate").out.trim(), "0001");
    cleanup(d);
  });
});

describe("create / start", () => {
  test("create makes a ticket that validates, with a colon in the title", () => {
    const d = repo();
    const r = run(d, "create", "--title", "Fix: the thing", "--type", "feature", "--priority", "high", "--slug", "fix-the-thing", "--capability", "00-x");
    assert.equal(r.code, 0);
    const path = r.out.trim();
    assert.match(path, /tickets\/open\/0001-fix-the-thing\.md/);
    const p = parse(readFileSync(join(d, path), "utf8"));
    assert.equal(p.fm.title, "Fix: the thing");
    assert.equal(p.fm.status, "open");
    assert.equal(p.fm.source, "agent", "agent is the default source");
    assert.deepEqual(p.fm.blocked_by, []);
    assert.ok(!("closed" in p.fm) && !("started" in p.fm));
    assert.equal(run(d, "validate").code, 0);
    cleanup(d);
  });

  test("create writes exactly the skeleton: four base sections, TODO placeholders, nothing else", () => {
    const d = repo();
    const r = run(d, "create", "--title", "Something", "--type", "chore", "--priority", "low", "--slug", "something", "--body", "The real description.", "--depends", "", "--capability", "00-x");
    assert.equal(r.code, 0, r.out);
    const p = parse(readFileSync(join(d, r.out.trim()), "utf8"));
    assert.equal(p.body,
      "\n## Description\n\nThe real description.\n\n## Acceptance criteria\n\n- [ ] TODO\n\n## Notes\n\nTODO\n\n## Operator validation\n\nTODO\n");
    cleanup(d);
  });

  test("create creates tickets/open/ when it does not exist yet", () => {
    const d = repo();
    rmSync(join(d, "tickets"), { recursive: true });
    const r = run(d, "create", "--title", "First", "--type", "chore", "--priority", "low");
    assert.equal(r.code, 0, r.out);
    assert.ok(existsSync(join(d, "tickets/open/0001-first.md")));
    assert.ok(existsSync(join(d, "tickets/index.json")));
    cleanup(d);
  });

  test("--depends takes a comma list", () => {
    const d = repo();
    ticket(d, "open", FM({ id: 1, slug: "a" }));
    ticket(d, "open", FM({ id: 2, slug: "b" }));
    const r = run(d, "create", "--title", "Third", "--type", "chore", "--priority", "low", "--depends", "1,2", "--json");
    const { path } = JSON.parse(r.out);
    assert.deepEqual(parse(readFileSync(join(d, path), "utf8")).fm.depends_on, [1, 2]);
    cleanup(d);
  });

  test("start is idempotent-safe — it reports rather than overwrites", () => {
    const d = repo(); ticket(d, "open", FM());
    run(d, "start", "1");
    const first = parse(readFileSync(join(d, "tickets/open/0001-a-ticket.md"), "utf8")).fm.started;
    assert.match(first, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    const second = run(d, "start", "1");
    assert.match(second.out, /already started/);
    assert.equal(parse(readFileSync(join(d, "tickets/open/0001-a-ticket.md"), "utf8")).fm.started, first);
    cleanup(d);
  });
});

describe("create emits the sections its type requires", () => {
  test("a bug gets Steps to reproduce and Expected vs actual, and validates", () => {
    const d = repo();
    assert.equal(run(d, "create", "--title", "A bug", "--type", "bug", "--priority", "high", "--slug", "a-bug").code, 0);
    const body = readFileSync(join(d, "tickets/open/0001-a-bug.md"), "utf8");
    assert.match(body, /^## Steps to reproduce$/m);
    assert.match(body, /^## Expected vs actual$/m);
    assert.equal(run(d, "validate").code, 0, "create must not produce a ticket that fails validation");
    cleanup(d);
  });

  test("a design ticket gets Options considered and Open questions", () => {
    const d = repo();
    run(d, "create", "--title", "A design", "--type", "design", "--priority", "med", "--slug", "a-design");
    const body = readFileSync(join(d, "tickets/open/0001-a-design.md"), "utf8");
    assert.match(body, /^## Options considered$/m);
    assert.match(body, /^## Open questions$/m);
    assert.equal(run(d, "validate").code, 0);
    cleanup(d);
  });

  test("everything `create` emits, `validate` accepts — for every type", () => {
    // The generator writing sections the validator does not require is the drift
    // this guards against. Asserting them against each other keeps them married.
    for (const type of ENUMS.type) {
      const d = repo();
      const r = run(d, "create", "--title", `A ${type}`, "--type", type, "--priority", "med", "--capability", "00-x");
      assert.equal(r.code, 0, r.out);
      const v = run(d, "validate");
      assert.equal(v.code, 0, `create --type ${type} produced a ticket validate rejects:\n${v.out}`);
      cleanup(d);
    }
  });
});

describe("create derives a valid slug from a title long enough to truncate", () => {
  const LONG = "validate: enforce required body sections on every ticket, not just closed ones";

  test("the title yields a slug cut at 60 characters with no trailing hyphen", () => {
    assert.equal(slugify(LONG), "validate-enforce-required-body-sections-on-every-ticket-not");
  });

  test("no truncation point can produce a trailing hyphen", () => {
    // The bug was an ordering one, so a single example proves little. Every
    // prefix of a hyphen-rich title is a candidate cut point; none may end in
    // a hyphen, and each must satisfy the same regex `create` checks against.
    const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
    for (let i = 1; i <= LONG.length; i++) {
      const out = slugify(LONG.slice(0, i));
      if (out === "") continue;
      assert.ok(!out.endsWith("-"), `slugify(title[0..${i}]) ended in a hyphen: '${out}'`);
      assert.ok(SLUG_RE.test(out), `slugify(title[0..${i}]) is not kebab-case: '${out}'`);
      assert.ok(out.length <= 60, `slugify(title[0..${i}]) is ${out.length} chars`);
    }
  });

  test("a title with no alphanumerics yields an empty slug, not a hyphen", () => {
    assert.equal(slugify("!!! ???"), "");
  });

  test("create succeeds on a long title with no --slug, and the result validates", () => {
    const d = repo();
    const r = run(d, "create", "--title", LONG, "--type", "chore", "--priority", "med", "--size", "s", "--capability", "00-x");
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /0001-validate-enforce-required-body-sections-on-every-ticket-not\.md/);
    assert.equal(run(d, "validate").code, 0, "a ticket create makes must validate");
    cleanup(d);
  });

  test("create still refuses a punctuation-only title rather than writing an empty slug", () => {
    const d = repo();
    const r = run(d, "create", "--title", "!!! ???", "--type", "chore", "--priority", "med");
    assert.notEqual(r.code, 0);
    assert.match(r.out, /not kebab-case/);
    assert.equal(readdirSync(join(d, "tickets/open")).length, 0, "no file may be written");
    cleanup(d);
  });

  test("the usage text lists every flag create actually accepts", () => {
    // A usage line that omits a working flag is how the next person concludes
    // it does not exist.
    const d = repo();
    const usage = run(d).out;
    const createLine = usage.split("\n").find((l) => l.trim().startsWith("create "));
    for (const flag of ["--size", "--capability", "--slug", "--depends", "--source", "--body"]) {
      assert.ok(createLine.includes(flag), `usage omits ${flag}: ${createLine}`);
    }
    cleanup(d);
  });

  test("bare invocation prints usage and exits 0; an unknown command exits 1", () => {
    const d = repo();
    assert.equal(run(d).code, 0);
    const r = run(d, "triage-move");
    assert.equal(r.code, 1);
    assert.match(r.out, /tickets\.mjs <command>/);
    cleanup(d);
  });
});

describe("writers refuse an out-of-enum value before writing anything", () => {
  // create takes every ENUMS field as a flag except status, which it always sets to open.
  // Iterating the SAME imported constant means a field added to ENUMS is tested here too.
  const FLAGS = Object.entries(ENUMS).filter(([k]) => k !== "status");
  const base = { title: "x", type: "bug", priority: "med", size: "s", source: "agent" };
  const createArgs = (o) => Object.entries({ ...base, ...o }).flatMap(([k, v]) => [`--${k}`, v]);
  const snapshot = (d) => JSON.stringify({
    open: readdirSync(join(d, "tickets/open")),
    index: existsSync(join(d, "tickets/index.json")) ? readFileSync(join(d, "tickets/index.json"), "utf8") : null,
  });

  test("--priority medium exits non-zero and changes nothing", () => {
    const d = repo();
    run(d, "index");
    const before = snapshot(d);
    const r = run(d, "create", "--title", "x", "--type", "bug", "--priority", "medium");
    assert.notEqual(r.code, 0);
    assert.match(r.out, /--priority must be one of: high, med, low/);
    assert.equal(snapshot(d), before, "tickets/open/ and index.json must be byte-identical");
    cleanup(d);
  });

  for (const [flag, ok] of FLAGS) {
    test(`create --${flag}: rejects a bad value, accepts '${ok[0]}'`, () => {
      const d = repo();
      const bad = run(d, "create", ...createArgs({ [flag]: "nope" }));
      assert.notEqual(bad.code, 0);
      assert.match(bad.out, new RegExp(`--${flag} must be one of: ${ok.join(", ")}`));
      assert.deepEqual(readdirSync(join(d, "tickets/open")), []);
      const good = run(d, "create", ...createArgs({ [flag]: ok[0] }));
      assert.equal(good.code, 0, good.out);
      assert.equal(parse(readFileSync(join(d, good.out.trim()), "utf8")).fm[flag], ok[0]);
      cleanup(d);
    });
  }

  test("a value validate rejects is a value create refuses — one list, not two", () => {
    for (const [flag] of FLAGS) {
      const d = repo();
      assert.notEqual(run(d, "create", ...createArgs({ [flag]: "nope" })).code, 0, flag);
      ticket(d, "open", FM({ [flag]: "nope" }));
      assert.match(run(d, "validate").out, new RegExp(`\\[enum\\]\\s+${flag}='nope'`), flag);
      cleanup(d);
    }
  });
});

describe("block / unblock", () => {
  test("block sets status and records the reason verbatim", () => {
    const d = repo(); ticket(d, "open", FM({ id: 1 })); ticket(d, "open", FM({ id: 2, slug: "b" }));
    run(d, "block", "1", "--on", "2", "--reason", "needs the schema from 0002");
    const p = parse(readFileSync(join(d, "tickets/open/0001-a-ticket.md"), "utf8"));
    assert.deepEqual(p.fm.blocked_by, [2]);
    assert.equal(p.fm.status, "blocked");
    assert.match(p.body, /needs the schema from 0002/);
    assert.equal(run(d, "validate").code, 0);
    cleanup(d);
  });

  test("block on a nonexistent id changes nothing", () => {
    const d = repo(); ticket(d, "open", FM({ id: 1 }));
    const before = readFileSync(join(d, "tickets/open/0001-a-ticket.md"), "utf8");
    const r = run(d, "block", "1", "--on", "999");
    assert.notEqual(r.code, 0);
    assert.equal(readFileSync(join(d, "tickets/open/0001-a-ticket.md"), "utf8"), before);
    cleanup(d);
  });

  test("block refuses an edge that would create a cycle, and names it", () => {
    const d = repo();
    ticket(d, "open", FM({ id: 1, depends_on: [2] }));
    ticket(d, "open", FM({ id: 2, slug: "b" }));
    const before = readFileSync(join(d, "tickets/open/0002-b.md"), "utf8");
    const r = run(d, "block", "2", "--on", "1");
    assert.notEqual(r.code, 0);
    assert.match(r.out, /cycle/);
    assert.equal(readFileSync(join(d, "tickets/open/0002-b.md"), "utf8"), before, "must change nothing");
    cleanup(d);
  });

  test("unblock returns status to open only when the last edge goes", () => {
    const d = repo();
    ticket(d, "open", FM({ id: 1, blocked_by: [2, 3], status: "blocked" }));
    ticket(d, "open", FM({ id: 2, slug: "b" })); ticket(d, "open", FM({ id: 3, slug: "c" }));
    run(d, "unblock", "1", "--on", "2");
    assert.equal(parse(readFileSync(join(d, "tickets/open/0001-a-ticket.md"), "utf8")).fm.status, "blocked");
    run(d, "unblock", "1", "--on", "3");
    assert.equal(parse(readFileSync(join(d, "tickets/open/0001-a-ticket.md"), "utf8")).fm.status, "open");
    cleanup(d);
  });
});

// ─────────────────────────────────────────────────────────────────── close ────

describe("close refuses (a refusal that is not tested is one that gets bypassed)", () => {
  const closable = "\n## Acceptance criteria\n\n- [x] a\n\n## Resolution\n\nx\n\n## Operator validation\n\nx\n";

  test("refuses an unchecked acceptance criterion and lists it verbatim", () => {
    const d = repo();
    ticket(d, "open", FM(), "\n## Acceptance criteria\n\n- [ ] the unfinished one\n\n## Resolution\n\nx\n\n## Operator validation\n\nx\n");
    commitAll(d);
    const r = run(d, "close", "1");
    assert.notEqual(r.code, 0);
    assert.match(r.out, /the unfinished one/);
    assert.ok(existsSync(join(d, "tickets/open/0001-a-ticket.md")), "must not move the file");
    cleanup(d);
  });

  test("refuses a missing ## Resolution, naming it", () => {
    const d = repo();
    ticket(d, "open", FM(), "\n## Acceptance criteria\n\n- [x] a\n\n## Operator validation\n\nx\n");
    commitAll(d);
    const r = run(d, "close", "1");
    assert.notEqual(r.code, 0);
    assert.match(r.out, /Resolution/);
    cleanup(d);
  });

  test("refuses a dirty tree, and --allow-dirty overrides", () => {
    const d = repo();
    ticket(d, "open", FM(), closable);
    commitAll(d);
    writeFileSync(join(d, "unrelated.txt"), "dirty");
    const r = run(d, "close", "1");
    assert.notEqual(r.code, 0);
    assert.match(r.out, /dirty working tree/);
    assert.equal(run(d, "close", "1", "--allow-dirty").code, 0);
    cleanup(d);
  });

  test("--allow-dirty before the id still reads the id — boolean flags take no value", () => {
    const d = repo();
    ticket(d, "open", FM(), closable);
    commitAll(d);
    writeFileSync(join(d, "unrelated.txt"), "dirty");
    const r = run(d, "close", "--allow-dirty", "1");
    assert.equal(r.code, 0, r.out);
    assert.ok(existsSync(join(d, "tickets/closed/0001-a-ticket.md")));
    cleanup(d);
  });

  test("close moves the file with git mv, stamps it, regenerates the index and announces newly-ready dependents", () => {
    const d = repo();
    ticket(d, "open", FM({ id: 1 }), closable);
    ticket(d, "open", FM({ id: 2, slug: "b", depends_on: [1] }));
    ticket(d, "open", FM({ id: 3, slug: "c", depends_on: [1, 2] }));
    commitAll(d);
    const r = run(d, "close", "1");
    assert.equal(r.code, 0, r.out);
    assert.ok(existsSync(join(d, "tickets/closed/0001-a-ticket.md")));
    assert.ok(!existsSync(join(d, "tickets/open/0001-a-ticket.md")));
    assert.match(r.out, /0002\s+NOW READY/);
    assert.match(r.out, /0003\s+still waiting/);
    const p = parse(readFileSync(join(d, "tickets/closed/0001-a-ticket.md"), "utf8"));
    assert.equal(p.fm.status, "closed");
    assert.match(p.fm.closed, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    const idx = JSON.parse(readFileSync(join(d, "tickets/index.json"), "utf8"));
    assert.equal(idx.find((t) => t.id === 1).status, "closed");
    assert.equal(idx.find((t) => t.id === 2).ready, true);
    cleanup(d);
  });

  test("there is no --force on close — passing it changes nothing", () => {
    // Behavioural, not a grep of the source: the refusal message itself contains
    // the string "--force", so a textual test passes for the wrong reason.
    const d = repo();
    ticket(d, "open", FM(), "\n## Acceptance criteria\n\n- [ ] undone\n\n## Resolution\n\nx\n\n## Operator validation\n\nx\n");
    commitAll(d);
    const r = run(d, "close", "1", "--force");
    assert.notEqual(r.code, 0, "--force must not close a ticket with unchecked criteria");
    assert.ok(existsSync(join(d, "tickets/open/0001-a-ticket.md")), "file must not move");
    cleanup(d);
  });

  test("a closed ticket cannot be closed again", () => {
    const d = repo();
    ticket(d, "closed", FM({ status: "closed", closed: "2026-08-30T00:00:00Z" }), BODY_CLOSED);
    commitAll(d);
    const r = run(d, "close", "1");
    assert.notEqual(r.code, 0);
    assert.match(r.out, /already closed/);
    cleanup(d);
  });
});

describe("the dirty-tree rule exempts the ticket being closed", () => {
  test("a dirty ticket-under-close does not trip the refusal, but another file does", () => {
    const d = repo();
    ticket(d, "open", FM(), "\n## Acceptance criteria\n\n- [ ] a\n\n## Resolution\n\nx\n\n## Operator validation\n\nx\n");
    commitAll(d);
    // tick the last criterion — this is part of closing, not unrelated work
    const p = join(d, "tickets/open/0001-a-ticket.md");
    writeFileSync(p, readFileSync(p, "utf8").replace("- [ ] a", "- [x] a"));
    assert.equal(run(d, "close", "1").code, 0, "its own file being dirty must not block the close");

    const d2 = repo();
    ticket(d2, "open", FM(), "\n## Acceptance criteria\n\n- [x] a\n\n## Resolution\n\nx\n\n## Operator validation\n\nx\n");
    commitAll(d2);
    writeFileSync(join(d2, "unrelated.txt"), "dirty");
    assert.notEqual(run(d2, "close", "1").code, 0, "unrelated dirt must still refuse");
    cleanup(d, d2);
  });

  test("a dirty tickets/index.json is not unrelated work", () => {
    const d = repo();
    ticket(d, "open", FM(), "\n## Acceptance criteria\n\n- [x] a\n\n## Resolution\n\nx\n\n## Operator validation\n\nx\n");
    commitAll(d);
    run(d, "index");
    assert.equal(run(d, "close", "1").code, 0);
    cleanup(d);
  });
});

describe("a move fails before it writes, and an untracked ticket still moves", () => {
  const closable = "\n## Acceptance criteria\n\n- [x] a\n\n## Resolution\n\nx\n\n## Operator validation\n\nx\n";

  test("close moves a ticket git has never seen, and the closed copy carries the new status", () => {
    const d = repo();
    try {
      commitAll(d);
      const src = ticket(d, "open", FM({ id: 7, slug: "fresh" }), closable);
      const r = run(d, "close", "7");
      assert.equal(r.code, 0, r.out);
      assert.ok(!existsSync(join(d, src)), "nothing is left behind in open/");
      const p = parse(readFileSync(join(d, "tickets/closed/0007-fresh.md"), "utf8"));
      assert.equal(p.fm.status, "closed");
      assert.ok(p.fm.closed);
    } finally { cleanup(d); }
  });

  test("a tracked ticket still moves with git mv, so history follows it", () => {
    const d = repo();
    try {
      ticket(d, "open", FM({ id: 8, slug: "old" }), closable);
      commitAll(d);
      assert.equal(run(d, "close", "8").code, 0);
      const st = execFileSync("git", ["status", "--porcelain"], { cwd: d, encoding: "utf8" });
      assert.match(st, /^R. tickets\/open\/0008-old\.md -> tickets\/closed\/0008-old\.md/m);
    } finally { cleanup(d); }
  });

  test("an occupied destination refuses and leaves the source byte-identical", () => {
    const d = repo();
    try {
      const src = ticket(d, "open", FM({ id: 9, slug: "dup" }), closable);
      writeFileSync(join(d, "tickets/closed/0009-dup.md"), "squatter\n");
      commitAll(d);
      const before = readFileSync(join(d, src), "utf8");
      const r = run(d, "close", "9", "--allow-dirty");
      assert.notEqual(r.code, 0);
      assert.match(r.out, /already exists/);
      assert.equal(readFileSync(join(d, src), "utf8"), before, "the open copy was not rewritten");
    } finally { cleanup(d); }
  });

  test("close creates tickets/closed/ when it does not exist yet", () => {
    const d = repo();
    try {
      rmSync(join(d, "tickets/closed"), { recursive: true });
      ticket(d, "open", FM({ id: 1, slug: "first" }), closable);
      commitAll(d);
      assert.equal(run(d, "close", "1").code, 0);
      assert.ok(existsSync(join(d, "tickets/closed/0001-first.md")));
    } finally { cleanup(d); }
  });
});

// ─────────────────────────────────────────────── operator-verifiable criteria ────

describe("operator-verifiable criteria block a close", () => {
  const AC = (...items) => `\n## Acceptance criteria\n\n${items.join("\n")}\n\n## Resolution\n\nx\n\n## Operator validation\n\nx\n`;

  test("recognises the marker bare, bolded, and in any case; ignores it mid-text", () => {
    const { criteria } = acceptance(AC(
      "- [ ] (operator) ran it on the phone",
      "- [ ] **(Operator)** bolded and capitalised",
      "- [ ] (OPERATOR): with a colon",
      "- [ ] a criterion mentioning the (operator) halfway through",
      "- [ ] an ordinary criterion",
    ));
    assert.deepEqual(criteria.map((c) => c.operator), [true, true, true, false, false]);
  });

  test("a sign-off needs a date AND a result — a bare 'verified' is not one", () => {
    const { criteria } = acceptance(AC(
      "- [x] (operator) checked \u2014 verified 2026-08-31: passed on the device",
      "- [x] (operator) checked - verified 2026-08-31: passed",
      "- [x] (operator) checked \u2013 verified 2026-08-31: passed",
      "- [x] (operator) checked \u2014 verified: passed",
      "- [x] (operator) checked \u2014 verified 2026-08-31:",
      "- [x] (operator) checked, honest",
    ));
    assert.deepEqual(criteria.map((c) => c.signed), [true, true, true, false, false, false]);
  });

  test("a criterion wrapped across lines is one criterion, and its sign-off counts", () => {
    // The rule must not fail open on exactly the criteria long enough to wrap.
    const body = AC(
      "- [x] (operator) typing /tickets shows the skill with its argument-hint",
      "      \u2014 verified 2026-08-31: registered, no session restart needed",
    );
    const { total, criteria, unsignedOperator } = acceptance(body);
    assert.equal(total, 1, "continuation lines must fold, not count as criteria");
    assert.equal(criteria[0].signed, true);
    assert.deepEqual(unsignedOperator, []);
  });

  test("an unchecked operator criterion is not itself an error — it is a wait", () => {
    const { unsignedOperator, pendingOperator } = acceptance(AC("- [ ] (operator) try it with the real build"));
    assert.deepEqual(unsignedOperator, []);
    assert.equal(pendingOperator.length, 1);
  });

  test("close refuses an unchecked operator criterion, and says to leave it open", () => {
    const d = repo();
    ticket(d, "open", FM(), AC("- [x] done", "- [ ] (operator) typing /tickets shows the skill"));
    commitAll(d);
    const r = run(d, "close", "1");
    assert.notEqual(r.code, 0);
    assert.match(r.out, /only be checked by a human/i);
    assert.match(r.out, /Do NOT tick these/);
    assert.match(r.out, /Leave the ticket open/i);
    assert.ok(existsSync(join(d, "tickets/open/0001-a-ticket.md")), "file must not move");
    cleanup(d);
  });

  test("show reports the operator criteria a ticket is waiting on", () => {
    const d = repo();
    ticket(d, "open", FM(), AC("- [ ] (operator) look at it"));
    assert.match(run(d, "show", "1").out, /awaiting operator: 1 criterion/);
    cleanup(d);
  });

  test("close refuses an operator criterion ticked with no sign-off", () => {
    const d = repo();
    ticket(d, "open", FM(), AC("- [x] (operator) typing /tickets shows the skill"));
    commitAll(d);
    const r = run(d, "close", "1");
    assert.notEqual(r.code, 0, "every box ticked, nothing verified");
    assert.match(r.out, /ticked with no sign-off/i);
    assert.ok(existsSync(join(d, "tickets/open/0001-a-ticket.md")), "file must not move");
    cleanup(d);
  });

  test("close accepts a signed operator criterion", () => {
    const d = repo();
    ticket(d, "open", FM(), AC("- [x] (operator) typing /tickets shows the skill \u2014 verified 2026-08-31: it did"));
    commitAll(d);
    const r = run(d, "close", "1");
    assert.equal(r.code, 0, r.out);
    assert.ok(existsSync(join(d, "tickets/closed/0001-a-ticket.md")));
    cleanup(d);
  });

  test("--allow-dirty does not launder an unsigned operator criterion", () => {
    // --allow-dirty exists for the tree, not for the criteria. Worth asserting:
    // the nearest available flag is the first thing anyone reaches for.
    const d = repo();
    ticket(d, "open", FM(), AC("- [x] (operator) checked it"));
    commitAll(d);
    assert.notEqual(run(d, "close", "1", "--allow-dirty").code, 0);
    assert.ok(existsSync(join(d, "tickets/open/0001-a-ticket.md")));
    cleanup(d);
  });

  test("an unmarked criterion is untouched by the rule", () => {
    // The rule is opt-in per criterion. If an unmarked one could trip it, every
    // ordinary ticket would need a sign-off it was never asked for.
    const d = repo();
    ticket(d, "open", FM(), AC("- [x] an ordinary criterion, ticked by the agent that did the work"));
    commitAll(d);
    assert.equal(run(d, "close", "1").code, 0);
    cleanup(d);
  });
});

// ──────────────────────────────────────────────────── required body sections ────

describe("validate enforces required body sections on every ticket", () => {
  const BASE = ["Description", "Acceptance criteria", "Notes", "Operator validation"];
  const sections = (...names) => "\n" + names.map((n) => `## ${n}\n\nx\n`).join("\n");

  test("each of the four base sections is required on its own", () => {
    // One at a time: a rule that only fires when all four are absent would pass
    // a single-section test and miss every realistic case.
    for (const omitted of BASE) {
      const d = repo();
      ticket(d, "open", FM(), sections(...BASE.filter((n) => n !== omitted)));
      const { errors } = validateIn(d);
      assert.ok(
        errors.some((e) => e.rule === "missing-section" && e.msg.includes(omitted)),
        `omitting '${omitted}' must be an error, got: ${errors.map((e) => e.msg).join(" | ") || "none"}`,
      );
      cleanup(d);
    }
  });

  test("a frontmatter-only ticket names all four missing sections, not just the first", () => {
    const d = repo();
    ticket(d, "open", FM(), "\n");
    const { errors } = validateIn(d);
    const missing = errors.filter((e) => e.rule === "missing-section").map((e) => e.msg);
    assert.equal(missing.length, 4, `expected all four, got: ${missing.join(" | ")}`);
    cleanup(d);
  });

  test("a design ticket needs Options considered and Open questions", () => {
    const d = repo();
    ticket(d, "open", FM({ type: "design" }), sections(...BASE));
    const { errors } = validateIn(d);
    const msgs = errors.filter((e) => e.rule === "design-section").map((e) => e.msg).join(" | ");
    assert.match(msgs, /Options considered/);
    assert.match(msgs, /Open questions/);
    cleanup(d);
  });

  test("missingSections applies the bug rule in every folder", () => {
    assert.ok(missingSections({ type: "bug" }, "", "open").some((m) => m.rule === "bug-section"));
    assert.ok(missingSections({ type: "bug" }, "", "closed").some((m) => m.rule === "closed-section"));
  });

  test("a closed ticket still needs ## Resolution, and it is still 'closed-section'", () => {
    const d = repo();
    ticket(d, "closed", FM({ status: "closed", closed: "2026-08-30T00:00:00Z" }),
      "\n## Description\n\nx\n\n## Acceptance criteria\n\n- [x] a\n\n## Notes\n\nx\n\n## Operator validation\n\nx\n");
    const { errors } = validateIn(d);
    assert.ok(errors.some((e) => e.rule === "closed-section" && e.msg.includes("Resolution")));
    cleanup(d);
  });
});

describe("a required section appears exactly once", () => {
  // The leftover-stub shape: the full `create` stub block, then the real content below it.
  const STUB = "\n## Description\n\nTODO\n\n## Acceptance criteria\n\n- [ ] TODO\n\n## Notes\n\n## Operator validation\n\nTODO\n";
  const REAL = "\n## Description\n\nreal\n\n## Acceptance criteria\n\n- [x] real\n\n## Notes\n\nx\n\n## Operator validation\n\nx\n";

  test("a stub block followed by real content is an error naming each section and its count", () => {
    const d = repo();
    ticket(d, "open", FM({}), STUB + REAL);
    const { errors } = validateIn(d);
    const dup = errors.filter((e) => e.rule === "duplicate-section").map((e) => e.msg);
    for (const s of ["Description", "Acceptance criteria", "Notes", "Operator validation"]) {
      assert.ok(dup.includes(`'## ${s}' appears 2 times`), `expected a duplicate-section for ${s}, got ${JSON.stringify(dup)}`);
    }
    // The phantom is exactly what the rule exists to catch: acceptance() still
    // folds both blocks together, so without the error it would be counted.
    assert.equal(acceptance(STUB + REAL).unchecked.length, 1);
    cleanup(d);
  });

  test("it applies in closed/ too, and to type-specific sections", () => {
    assert.deepEqual(duplicateSections({ type: "bug" }, BODY + "\n## Steps to reproduce\n\n## Steps to reproduce\n", "open")
      .find((x) => x.section === "Steps to reproduce"), { section: "Steps to reproduce", count: 2 });
    assert.deepEqual(duplicateSections({}, BODY + "\n## Resolution\n\nx\n\n## Resolution\n\ny\n", "closed"),
      [{ section: "Resolution", count: 2 }]);
  });

  test("a heading quoted in a fence, and '## Deferred — resumed', are not duplicates", () => {
    const d = repo();
    const body = BODY + "\n## Deferred — resumed 2026-09-01\n\nx\n\n## Deferred — resumed 2026-09-02\n\nx\n"
      + "\nExample:\n\n```md\n## Acceptance criteria\n\n- [ ] TODO\n```\n";
    ticket(d, "open", FM({}), body);
    const r = run(d, "validate");
    assert.equal(r.code, 0, r.out);
    cleanup(d);
  });

  test("closed/: the Operator validation result appended after Resolution is legal, a third copy is not", () => {
    const closed = BODY + "\n## Resolution\n\nx\n\n## Operator validation\n\nresult\n";
    assert.deepEqual(duplicateSections({}, closed, "closed"), []);
    assert.deepEqual(duplicateSections({}, closed + "\n## Operator validation\n\nagain\n", "closed"),
      [{ section: "Operator validation", count: 3 }]);
    // Only closed/ earns the exemption, and only after Resolution.
    assert.deepEqual(duplicateSections({}, closed, "open"), [{ section: "Operator validation", count: 2 }]);
    assert.deepEqual(duplicateSections({}, BODY + "\n## Operator validation\n\nx\n\n## Resolution\n\nx\n", "closed"),
      [{ section: "Operator validation", count: 2 }]);
  });
});

// ──────────────────────────────────────────────────────────────── index.json ────

describe("index.json", () => {
  test("is idempotent and contains no body text", () => {
    const d = repo(); ticket(d, "open", FM());
    run(d, "index");
    const a = readFileSync(join(d, "tickets/index.json"), "utf8");
    run(d, "index");
    assert.equal(readFileSync(join(d, "tickets/index.json"), "utf8"), a, "must be byte-identical");
    const entries = JSON.parse(a);
    assert.equal(entries.length, 1);
    assert.deepEqual(entries[0].acceptance, { checked: 0, total: 1 });
    assert.ok(!JSON.stringify(entries).includes("## Description"), "index must carry no body");
    cleanup(d);
  });

  test("list filters, and --json carries path and ready", () => {
    const d = repo();
    ticket(d, "open", FM({ id: 1, slug: "a", type: "bug" }));
    ticket(d, "open", FM({ id: 2, slug: "b", depends_on: [1] }));
    const rows = JSON.parse(run(d, "list", "--ready", "--json").out);
    assert.deepEqual(rows.map((r) => [r.id, r.ready, r.path]), [[1, true, "tickets/open/0001-a.md"]]);
    assert.match(run(d, "list", "--type", "feature").out, /0002/);
    assert.doesNotMatch(run(d, "list", "--type", "feature").out, /0001 /);
    cleanup(d);
  });
});

// ─────────────────────────────────────────────────────────────────── deferred ────

describe("deferred: work that is correct, specified, and waiting on a third party", () => {
  const bodyOf = (d, id, slug) => readFileSync(join(d, "tickets/open", `${String(id).padStart(4, "0")}-${slug}.md`), "utf8");

  /** A repo with one open ticket, ready to be deferred. */
  function one(extra = {}) {
    const d = repo();
    ticket(d, "open", FM(extra), BODY_OK);
    return d;
  }

  test("defer refuses without a reason, and without a re-check — both are mandatory", () => {
    const d = one();
    const noReason = run(d, "defer", "1", "--recheck", "true");
    assert.notEqual(noReason.code, 0);
    assert.match(noReason.out, /requires --reason/);

    const noCheck = run(d, "defer", "1", "--reason", "upstream has not shipped the fix");
    assert.notEqual(noCheck.code, 0);
    assert.match(noCheck.out, /requires --recheck/);

    // Neither refusal may leave the ticket half-deferred.
    assert.match(bodyOf(d, 1, "a-ticket"), /status: open/);
    cleanup(d);
  });

  test("defer writes the section, stamps the frontmatter, and the result validates", () => {
    const d = one();
    const r = run(d, "defer", "1", "--reason", "upstream has not shipped the fix", "--recheck", "npm ci\necho done");
    assert.equal(r.code, 0, r.out);
    const body = bodyOf(d, 1, "a-ticket");
    assert.match(body, /^status: deferred$/m);
    assert.match(body, /^deferred: \d{4}-\d\d-\d\dT/m);
    assert.match(body, /## Deferred/);
    assert.match(body, /\*\*Reason:\*\* upstream has not shipped the fix/);
    assert.match(body, /```sh\nnpm ci\necho done\n```/);
    // The section lands between Description and the next heading, not at the end.
    assert.ok(body.indexOf("## Deferred") > body.indexOf("## Description"));
    assert.ok(body.indexOf("## Deferred") < body.indexOf("## Acceptance criteria"));
    assert.equal(run(d, "validate").code, 0, run(d, "validate").out);
    cleanup(d);
  });

  test("defer --recheck-file reads the re-check from a file", () => {
    const d = one();
    writeFileSync(join(d, "check.sh"), "test -f nothing-yet\n");
    assert.equal(run(d, "defer", "1", "--reason", "waiting", "--recheck-file", "check.sh").code, 0);
    assert.match(bodyOf(d, 1, "a-ticket"), /```sh\ntest -f nothing-yet\n```/);
    cleanup(d);
  });

  test("defer refuses a blocked ticket and says why the two are different", () => {
    const d = repo();
    ticket(d, "open", FM({ id: 1, slug: "a", status: "blocked", blocked_by: [2] }), BODY_OK);
    ticket(d, "open", FM({ id: 2, slug: "b" }), BODY_OK);
    const r = run(d, "defer", "1", "--reason", "waiting", "--recheck", "true");
    assert.notEqual(r.code, 0);
    assert.match(r.out, /that is 'blocked', not 'deferred'/i);
    cleanup(d);
  });

  test("defer refuses a closed ticket", () => {
    const d = repo();
    ticket(d, "closed", FM({ status: "closed", closed: "2026-08-30T00:00:00Z" }), BODY_CLOSED);
    const r = run(d, "defer", "1", "--reason", "waiting", "--recheck", "true");
    assert.notEqual(r.code, 0);
    assert.match(r.out, /Only a live ticket can be deferred/);
    cleanup(d);
  });

  test("validate errors on a deferral with no reason, with no re-check, and with no section", () => {
    // Separate rules because the right fix differs: one is "say what you are
    // waiting for", the other is "say how anyone would know".
    const d = repo();
    ticket(d, "open", FM({ id: 1, slug: "a", status: "deferred", deferred: "2026-09-01T00:00:00Z" }),
      "\n## Description\n\nx\n\n## Deferred\n\n```sh\ntrue\n```\n\n## Acceptance criteria\n\n- [ ] a\n\n## Notes\n\nx\n\n## Operator validation\n\nx\n");
    ticket(d, "open", FM({ id: 2, slug: "b", status: "deferred", deferred: "2026-09-01T00:00:00Z" }),
      "\n## Description\n\nx\n\n## Deferred\n\n**Reason:** upstream\n\n## Acceptance criteria\n\n- [ ] a\n\n## Notes\n\nx\n\n## Operator validation\n\nx\n");
    ticket(d, "open", FM({ id: 3, slug: "c", status: "deferred", deferred: "2026-09-01T00:00:00Z" }), BODY_OK);

    const r = run(d, "validate");
    assert.notEqual(r.code, 0);
    assert.match(r.out, /0001-a\.md\s+\[deferred-reason\]/);
    assert.match(r.out, /0002-b\.md\s+\[deferred-recheck\]/);
    assert.match(r.out, /0003-c\.md\s+\[deferred-section\]/);
    cleanup(d);
  });

  test("validate errors on a deferred: stamp without the status, and vice versa", () => {
    const d = repo();
    ticket(d, "open", FM({ id: 1, slug: "a", deferred: "2026-09-01T00:00:00Z" }), BODY_OK);
    ticket(d, "open", FM({ id: 2, slug: "b", status: "deferred" }),
      "\n## Description\n\nx\n\n## Deferred\n\n**Reason:** r\n\n```sh\ntrue\n```\n\n## Acceptance criteria\n\n- [ ] a\n\n## Notes\n\nx\n\n## Operator validation\n\nx\n");
    const r = run(d, "validate");
    assert.notEqual(r.code, 0);
    assert.match(r.out, /0001-a\.md\s+\[deferred-stamp\].*status is 'open'/);
    assert.match(r.out, /0002-b\.md\s+\[deferred-stamp\].*no 'deferred:' timestamp/);
    cleanup(d);
  });

  test("an unterminated fence yields no re-check rather than feeding the rest of the ticket to the shell", () => {
    const d = deferral("\n## Deferred\n\n**Reason:** r\n\n```sh\nrm -rf /\n\n## Notes\n\nx\n");
    assert.equal(d.found, true);
    assert.equal(d.reason, "r");
    assert.equal(d.recheck, "");
  });

  test("a deferred ticket is not ready, is not offered by next, and is counted aloud", () => {
    const d = repo();
    ticket(d, "open", FM({ id: 1, slug: "a", priority: "high" }), BODY_OK);
    ticket(d, "open", FM({ id: 2, slug: "b", priority: "high" }), BODY_OK);
    run(d, "defer", "1", "--reason", "upstream", "--recheck", "true");

    const n = run(d, "next");
    assert.equal(n.code, 0, n.out);
    assert.match(n.out, /0002/);
    assert.doesNotMatch(n.out.split("\n")[0], /0001/);
    assert.match(n.out, /1 ticket\(s\) deferred/);
    assert.match(n.out, /never un-defers/);

    const all = run(d, "next", "--all");
    assert.match(all.out, /\[DEFERRED\]/);
    assert.match(all.out, /1 ready, 1 deferred on something outside the project/);

    const json = JSON.parse(run(d, "next", "--json").out);
    assert.equal(json.id, 2);
    assert.equal(json.deferred, 1);

    const idx = JSON.parse(readFileSync(join(d, "tickets/index.json"), "utf8"));
    assert.equal(idx.find((t) => t.id === 1).ready, false);
    cleanup(d);
  });

  test("next with nothing workable names the deferrals instead of saying 'nothing'", () => {
    const d = one();
    run(d, "defer", "1", "--reason", "upstream", "--recheck", "false");
    const r = run(d, "next");
    assert.notEqual(r.code, 0);
    assert.match(r.out, /nothing open/);
    assert.match(r.out, /1 ticket\(s\) are deferred/);
    cleanup(d);
  });

  test("recheck reports and changes nothing — a passing check does not un-defer", () => {
    const d = one();
    run(d, "defer", "1", "--reason", "upstream", "--recheck", "echo the wait is over; exit 0");
    const before = bodyOf(d, 1, "a-ticket");

    const r = run(d, "recheck");
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /PASSES\s+0001\s+the wait is over/);
    assert.match(r.out, /Nothing was changed/);
    assert.match(r.out, /tickets\.mjs resume 0001/);
    assert.equal(bodyOf(d, 1, "a-ticket"), before, "recheck must never mutate a ticket");
    cleanup(d);
  });

  test("recheck runs from the project root, wherever it is invoked", () => {
    const d = one();
    run(d, "defer", "1", "--reason", "upstream", "--recheck", "test -d tickets/open");
    const r = runIn(tmpdir(), d, "recheck", "--json");
    assert.equal(JSON.parse(r.out)[0].passes, true, r.out);
    cleanup(d);
  });

  test("recheck exits 0 on a failing check — it is a report, not a gate", () => {
    const d = one();
    run(d, "defer", "1", "--reason", "upstream", "--recheck", "echo still broken; exit 1");
    const r = run(d, "recheck", "1");
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /waits\s+0001\s+exit 1: still broken/);
    assert.match(r.out, /every wait is still on/);

    const json = JSON.parse(run(d, "recheck", "--json").out);
    assert.equal(json.length, 1);
    assert.equal(json[0].passes, false);
    cleanup(d);
  });

  test("recheck refuses a ticket that is not deferred, and says so when none is", () => {
    const d = one();
    const r = run(d, "recheck", "1");
    assert.notEqual(r.code, 0);
    assert.match(r.out, /is not deferred/);
    assert.match(run(d, "recheck").out, /no deferred tickets/);
    assert.equal(run(d, "recheck", "--json").out.trim(), "[]");
    cleanup(d);
  });

  test("resume returns it to open, keeps the record, and a second defer starts a fresh section", () => {
    const d = one();
    run(d, "defer", "1", "--reason", "upstream 1", "--recheck", "false");
    const r = run(d, "resume", "1", "--reason", "upstream shipped 1.24.1");
    assert.equal(r.code, 0, r.out);

    let body = bodyOf(d, 1, "a-ticket");
    assert.match(body, /^status: open$/m);
    assert.doesNotMatch(body, /^deferred:/m);
    assert.match(body, /## Deferred — resumed \d{4}-\d\d-\d\d/);
    assert.match(body, /\*\*Resumed \d{4}-\d\d-\d\d:\*\* upstream shipped 1\.24\.1/);
    assert.match(body, /upstream 1/, "the reason it was deferred stays in the record");
    assert.equal(run(d, "validate").code, 0, run(d, "validate").out);

    // A second deferral must not read the first one's stale re-check.
    run(d, "defer", "1", "--reason", "upstream 2", "--recheck", "second-check");
    body = bodyOf(d, 1, "a-ticket");
    assert.match(body, /```sh\nsecond-check\n```/);
    const r2 = run(d, "recheck", "--json");
    assert.match(JSON.parse(r2.out)[0].detail, /second-check/, "the fresh block is the one that runs");
    cleanup(d);
  });

  test("resume refuses a ticket that is not deferred", () => {
    const d = one();
    const r = run(d, "resume", "1");
    assert.notEqual(r.code, 0);
    assert.match(r.out, /is not deferred/);
    cleanup(d);
  });
});

// ─────────────────────────────────────────────────── audit: mechanical half ────

describe("audit runs the mechanical half and is honest about what it cannot run", () => {
  const withCap = (d, name = "00-x") => {
    writeFileSync(join(d, "docs/capabilities", `${name}.md`), "# cap\n");
    return name;
  };
  const auditJson = (d, cap) => JSON.parse(run(d, "audit", cap, "--json").out);

  test("every n/a result carries a reason — an empty one is a bug, not a shortcut", () => {
    const d = repo();
    const cap = withCap(d);
    ticket(d, "closed", FM({ status: "closed", closed: "2026-08-30T00:00:00Z", capability: cap }), BODY_CLOSED);
    const { checks } = auditJson(d, cap);
    const nas = checks.filter((c) => c.status === "na");
    assert.ok(nas.length >= 1, `a bare repo declares no project checks, so at least one n/a: ${JSON.stringify(checks)}`);
    for (const c of checks) {
      assert.ok(c.detail && c.detail.trim().length > 0, `check '${c.id}' has an empty detail`);
      if (c.status === "na") {
        assert.ok(c.detail.length > 25, `n/a reason for '${c.id}' is too thin to be useful: '${c.detail}'`);
        assert.ok(/exist|no |activat|add one|until|yet/i.test(c.detail),
          `n/a reason for '${c.id}' does not say what would make it applicable: '${c.detail}'`);
      }
    }
    cleanup(d);
  });

  test("a bare capability number resolves against the docs, as it does for waves", () => {
    const d = repo();
    const cap = withCap(d, "03-thing");
    ticket(d, "closed", FM({ status: "closed", closed: "2026-08-30T00:00:00Z", capability: cap }), BODY_CLOSED);
    assert.equal(auditJson(d, "3").capability, cap);
    assert.equal(auditJson(d, "03").capability, cap);
    withCap(d, "03-other");
    const r = run(d, "audit", "3");
    assert.notEqual(r.code, 0);
    assert.match(r.out, /ambiguous/);
    cleanup(d);
  });

  test("the generic checks are exactly validate, blocked-by-closed and capability-tickets-closed", () => {
    const d = repo();
    const cap = withCap(d);
    ticket(d, "closed", FM({ status: "closed", closed: "2026-08-30T00:00:00Z", capability: cap }), BODY_CLOSED);
    const ids = auditJson(d, cap).checks.map((c) => c.id);
    assert.deepEqual(ids, ["audit-checks", "validate", "blocked-by-closed", "capability-tickets-closed"]);
    cleanup(d);
  });

  test("n/a alone exits 0 — an inapplicable check is not a failure", () => {
    const d = repo();
    const cap = withCap(d);
    ticket(d, "closed", FM({ status: "closed", closed: "2026-08-30T00:00:00Z", capability: cap }), BODY_CLOSED);
    const r = run(d, "audit", cap);
    assert.equal(r.code, 0, `a repo whose checks are all pass-or-n/a must exit 0:\n${r.out}`);
    cleanup(d);
  });

  test("an open ticket in the capability fails the audit and is named", () => {
    const d = repo();
    const cap = withCap(d);
    ticket(d, "open", FM({ capability: cap }));
    const r = run(d, "audit", cap);
    assert.notEqual(r.code, 0);
    assert.match(r.out, /capability-tickets-closed/);
    assert.match(r.out, /0001/);
    cleanup(d);
  });

  test("a validation error anywhere fails the validate row", () => {
    const d = repo();
    const cap = withCap(d);
    ticket(d, "closed", FM({ status: "closed", closed: "2026-08-30T00:00:00Z", capability: cap }), BODY_CLOSED);
    ticket(d, "open", FM({ id: 2, slug: "b", capability: "null", priority: "urgent" }));
    const c = auditJson(d, cap).checks.find((x) => x.id === "validate");
    assert.equal(c.status, "fail");
    assert.match(c.detail, /enum/);
    cleanup(d);
  });

  test("a blocked_by pointing at a closed ticket fails", () => {
    const d = repo();
    const cap = withCap(d);
    writeFileSync(join(d, "docs/capabilities/09-other.md"), "# other\n");
    ticket(d, "closed", FM({ id: 1, status: "closed", closed: "2026-08-30T00:00:00Z", capability: cap }), BODY_CLOSED);
    ticket(d, "open", FM({ id: 2, slug: "b", status: "blocked", blocked_by: [1], capability: "09-other" }));
    const { checks } = auditJson(d, cap);
    const c = checks.find((x) => x.id === "blocked-by-closed");
    assert.equal(c.status, "fail", c.detail);
    assert.match(c.detail, /0002 blocked_by 0001/);
    cleanup(d);
  });

  test("an unknown capability is refused and the real ones are listed", () => {
    const d = repo();
    withCap(d, "00-preflight");
    withCap(d, "01-ticket-system");
    const r = run(d, "audit", "01-ticket-sistem");
    assert.notEqual(r.code, 0);
    assert.match(r.out, /00-preflight/);
    assert.match(r.out, /01-ticket-system/);
    cleanup(d);
  });

  test("audit with no capability names the ones that exist rather than guessing", () => {
    const d = repo();
    withCap(d, "01-ticket-system");
    const r = run(d, "audit");
    assert.notEqual(r.code, 0);
    assert.match(r.out, /01-ticket-system/);
    cleanup(d);
  });

  test("the table says a green table is not a passed audit, and names the way to one", () => {
    const d = repo();
    const cap = withCap(d);
    const out = run(d, "audit", cap).out;
    assert.match(out, /not a passed audit/i);
    for (const s of [/Design conformance/, /operator validation/i, /REFLECT/, /--sections/, /--record/, /docs\/capabilities\/AUDIT\.md/]) {
      assert.match(out, s);
    }
    cleanup(d);
  });
});

// ──────────────────────────────────────────── audit: the declared checks block ────

describe("project checks are declared in AUDIT.md's audit-checks block, not hard-coded", () => {
  const AUDIT = (block) => `# Capability close audit\n\nProse about the audit.\n\n${block}\n\nMore prose.\n`;
  const setup = (auditDoc) => {
    const d = repo();
    writeFileSync(join(d, "docs/capabilities/00-x.md"), `# 00-x\n${REFLECT}`);
    ticket(d, "closed", FM({ status: "closed", closed: "2026-08-30T00:00:00Z" }), BODY_CLOSED);
    if (auditDoc !== null) writeFileSync(join(d, "docs/capabilities/AUDIT.md"), auditDoc);
    return d;
  };
  const rows = (d, cwd = d) => JSON.parse(runIn(cwd, d, "audit", "00-x", "--json").out).checks;
  const row = (d, id) => rows(d).find((c) => c.id === id);

  test("a passing command is a pass row, named by its id, with the command as detail", () => {
    const d = setup(AUDIT("```audit-checks\n# comments and blank lines are allowed\n\ntypecheck: echo types are fine\n```"));
    const c = row(d, "typecheck");
    assert.equal(c.status, "pass", JSON.stringify(c));
    assert.equal(c.detail, "echo types are fine");
    assert.equal(c.section, "declared");
    assert.equal(run(d, "audit", "00-x").code, 0);
    assert.ok(!rows(d).some((x) => x.id === "audit-checks"), "no n/a row once checks are declared");
    cleanup(d);
  });

  test("a failing command is a fail row carrying the exit code and the last line of output", () => {
    const d = setup(AUDIT("```audit-checks\nlint: echo first line; echo '3 problems found' >&2; exit 3\nok: true\n```"));
    const c = row(d, "lint");
    assert.equal(c.status, "fail");
    assert.equal(c.detail, "exit 3: 3 problems found");
    assert.equal(row(d, "ok").status, "pass", "one failure does not stop the others running");
    const r = run(d, "audit", "00-x");
    assert.equal(r.code, 1);
    assert.match(r.out, /FAIL\s+lint\s+exit 3: 3 problems found/);
    cleanup(d);
  });

  test("--record refuses while a declared check fails, and writes nothing", () => {
    const d = setup(AUDIT("```audit-checks\ntests: exit 1\n```"));
    const r = run(d, "audit", "00-x", "--record", "--no-divergences");
    assert.notEqual(r.code, 0);
    assert.match(r.out, /1 mechanical check\(s\) failed: tests/);
    assert.equal(records(d, "00-x").length, 0);
    cleanup(d);
  });

  test("commands run with a shell from the project root, wherever audit is invoked", () => {
    const d = setup(AUDIT("```audit-checks\nat-root: test -f docs/capabilities/AUDIT.md && test -d tickets/open\npipes: printf 'a\\nb\\n' | grep -q b\n```"));
    const cs = rows(d, tmpdir());
    assert.equal(cs.find((c) => c.id === "at-root").status, "pass", JSON.stringify(cs));
    assert.equal(cs.find((c) => c.id === "pipes").status, "pass", JSON.stringify(cs));
    cleanup(d);
  });

  test("no AUDIT.md at all is one n/a row that says where to declare checks", () => {
    const d = setup(null);
    const cs = rows(d).filter((c) => c.section === "declared");
    assert.equal(cs.length, 1);
    assert.equal(cs[0].id, "audit-checks");
    assert.equal(cs[0].status, "na");
    assert.match(cs[0].detail, /docs\/capabilities\/AUDIT\.md does not exist/);
    assert.match(cs[0].detail, /audit-checks block/);
    cleanup(d);
  });

  test("an AUDIT.md with no block, or an empty block, is one n/a row that says where to declare checks", () => {
    for (const [doc, why] of [
      [AUDIT("```sh\nnot-this: true\n```"), /has no audit-checks block yet/],
      [AUDIT("```audit-checks\n# nothing yet\n\n```"), /declares no checks yet/],
    ]) {
      const d = setup(doc);
      const cs = rows(d).filter((c) => c.section === "declared");
      assert.deepEqual(cs.map((c) => [c.id, c.status]), [["audit-checks", "na"]]);
      assert.match(cs[0].detail, why);
      assert.match(cs[0].detail, /'<check-id>: <shell command>'/);
      assert.equal(run(d, "audit", "00-x").code, 0, "n/a alone never fails the run");
      cleanup(d);
    }
  });

  test("a malformed line is an ERR row, never silently dropped — and ERR blocks --record", () => {
    const d = setup(AUDIT("```audit-checks\ngood: true\nthis line has no id\n```"));
    const cs = rows(d);
    const err = cs.find((c) => c.status === "error");
    assert.ok(err, JSON.stringify(cs));
    assert.match(err.detail, /line \d+ is not '<check-id>: <shell command>'/);
    assert.equal(cs.find((c) => c.id === "good").status, "pass", "the well-formed lines still run");
    const r = run(d, "audit", "00-x");
    assert.equal(r.code, 1);
    assert.match(r.out, /1 could not run/);
    assert.match(r.out, /ERR is not n\/a/);
    const rec = run(d, "audit", "00-x", "--record", "--no-divergences");
    assert.notEqual(rec.code, 0);
    assert.match(rec.out, /could not run: audit-checks/);
    cleanup(d);
  });

  test("an unterminated block runs nothing and says so", () => {
    const d = setup(AUDIT("```audit-checks\nrm-everything: echo would-have-run > ran.txt"));
    const cs = rows(d);
    assert.deepEqual(cs.filter((c) => c.section === "declared").map((c) => c.status), ["error"]);
    assert.match(cs[0].detail, /never closed/);
    assert.ok(!existsSync(join(d, "ran.txt")), "nothing in an unterminated block may run");
    cleanup(d);
  });

  test("parseAuditChecks: ids, comments, duplicates, built-in ids and a second block", () => {
    const p = parseAuditChecks([
      "intro", "",
      "```audit-checks",
      "  # indented comment",
      "typecheck: npx tsc --noEmit",
      "url-check: curl -fsS http://localhost:8080/health",
      "typecheck: again",
      "validate: true",
      "```",
      "",
      "~~~audit-checks",
      "other: true",
      "~~~",
    ].join("\n"));
    assert.equal(p.found, true);
    assert.deepEqual(p.checks, [
      { id: "typecheck", command: "npx tsc --noEmit" },
      { id: "url-check", command: "curl -fsS http://localhost:8080/health" },
    ], "a colon inside the command belongs to the command");
    assert.equal(p.problems.length, 3);
    assert.match(p.problems[0].msg, /'typecheck' is declared twice/);
    assert.match(p.problems[1].msg, /'validate' is a built-in check id/);
    assert.match(p.problems[2].msg, /a second audit-checks block/);
  });

  test("parseAuditChecks: a longer fence closes only on a fence at least as long", () => {
    const p = parseAuditChecks("````audit-checks\na: echo ```\n````\n");
    assert.deepEqual(p.checks, [{ id: "a", command: "echo ```" }]);
    assert.deepEqual(p.problems, []);
  });
});

// ──────────────────────────────────────── audit: the record + the drift budget ────

describe("the audit record, the divergence list and the drift budget", () => {
  const STUB = "\n## Reflection\n\n_Filled in at the REFLECT step, after USE._\n";

  /** A repo whose capability doc is ready to be recorded against. */
  const ready = (reflect = REFLECT, cap = "00-x") => {
    const d = repo();
    writeFileSync(join(d, "docs/capabilities", `${cap}.md`), `# ${cap}\n${reflect}`);
    ticket(d, "closed", FM({ status: "closed", closed: "2026-08-30T00:00:00Z", capability: cap }), BODY_CLOSED);
    return [d, cap];
  };
  const docOf = (d, cap) => readFileSync(join(d, "docs/capabilities", `${cap}.md`), "utf8");

  test("an omitted divergence list is refused — an empty one must be asserted", () => {
    // A skipped design review and one that found nothing must not look the same.
    const [d, cap] = ready();
    const r = run(d, "audit", cap, "--record");
    assert.notEqual(r.code, 0);
    assert.match(r.out, /never assumed by omission/i);
    assert.equal(records(d, cap).length, 0, "nothing may be recorded on a refusal");
    cleanup(d);
  });

  test("--no-divergences records a clean audit, and says the assertion was made", () => {
    const [d, cap] = ready();
    const r = run(d, "audit", cap, "--record", "--no-divergences");
    assert.equal(r.code, 0, r.out);
    assert.match(docOf(d, cap), /Divergences: none.*Asserted explicitly/s);
    const [rec] = records(d, cap);
    assert.equal(rec.verdict, "pass");
    assert.equal(rec.divergences, 0);
    assert.equal(rec.capability, cap);
    assert.match(rec.audited, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    assert.deepEqual(rec.mechanical, { pass: 3, fail: 0, na: 1 });
    cleanup(d);
  });

  test("--no-divergences alongside a --divergence is refused rather than guessed at", () => {
    const [d, cap] = ready();
    const r = run(d, "audit", cap, "--record", "--no-divergences", "--divergence", "code-was-wrong|0042|x");
    assert.notEqual(r.code, 0);
    assert.match(r.out, /Pick one/);
    cleanup(d);
  });

  test("a divergence must resolve one way or the other — 'neither' is not an outcome", () => {
    const [d, cap] = ready();
    for (const bad of ["we-will-remember|x|y", "code-was-wrong||no ref", "code-was-wrong|0042|"]) {
      const r = run(d, "audit", cap, "--record", "--divergence", bad);
      assert.notEqual(r.code, 0, `'${bad}' must be refused`);
      assert.equal(records(d, cap).length, 0);
    }
    assert.match(run(d, "audit", cap, "--record", "--divergence", "x|y|z").out, /docs\/DECISIONS\.md/,
      "the refusal says where a design-was-wrong decision is recorded");
    cleanup(d);
  });

  test("three divergences pass; a fourth fails and calls for a DESIGN session", () => {
    const div = (n) => ["--divergence", `design-was-wrong|decision ${n}|divergence number ${n}`];
    const [d, cap] = ready();
    assert.equal(run(d, "audit", cap, "--record", ...div(1), ...div(2), ...div(3)).code, 0);
    assert.equal(records(d, cap)[0].divergences, 3);
    assert.match(docOf(d, cap), /Divergences \(3 of a budget of 3\)/);
    assert.match(docOf(d, cap), /1\. \*\*design-was-wrong\*\* — `decision 1` — divergence number 1/);

    const [e, ecap] = ready();
    const r = run(e, "audit", ecap, "--record", ...div(1), ...div(2), ...div(3), ...div(4));
    assert.notEqual(r.code, 0);
    assert.match(r.out, /budget of three/i);
    assert.match(r.out, /DESIGN session/);
    assert.equal(records(e, ecap).length, 0);
    cleanup(d, e);
  });

  test("a placeholder REFLECT section fails — the heading existing is not enough", () => {
    const [d, cap] = ready(STUB);
    const r = run(d, "audit", cap, "--record", "--no-divergences");
    assert.notEqual(r.code, 0);
    assert.match(r.out, /placeholder/i);
    assert.match(r.out, /AUDIT\.md/);
    cleanup(d);
  });

  test("no REFLECT heading at all fails and says what heading it looks for", () => {
    const [d, cap] = ready("\n## Notes\n\n" + "x".repeat(300) + "\n");
    const r = run(d, "audit", cap, "--record", "--no-divergences");
    assert.notEqual(r.code, 0);
    assert.match(r.out, /no REFLECT section.*Reflect/);
    cleanup(d);
  });

  test("a REFLECT section under any heading depth counts", () => {
    const [d, cap] = ready("\n## Close audit\n\n### Reflection\n\n" + "Real content about what the design got wrong and why it mattered. ".repeat(6) + "\n");
    assert.equal(run(d, "audit", cap, "--record", "--no-divergences").code, 0);
    cleanup(d);
  });

  test("--force needs a reason, and records the override rather than hiding it", () => {
    const [d, cap] = ready(STUB);
    assert.notEqual(run(d, "audit", cap, "--record", "--no-divergences", "--force").code, 0,
      "a bare --force must be refused");

    const r = run(d, "audit", cap, "--record", "--no-divergences", "--force", "shipping before the retro, agreed with the operator");
    assert.equal(r.code, 0, r.out);
    const [rec] = records(d, cap);
    assert.equal(rec.verdict, "forced", "a forced audit must never record as a pass");
    assert.equal(rec.forced, "shipping before the retro, agreed with the operator");
    assert.match(docOf(d, cap), /Overridden with/);
    assert.match(docOf(d, cap), /shipping before the retro/);
    cleanup(d);
  });

  test("records are append-only — a re-audit adds a line and keeps the old one", () => {
    const [d, cap] = ready();
    run(d, "audit", cap, "--record", "--no-divergences");
    run(d, "audit", cap, "--record", "--divergence", "design-was-wrong|slug rule|found on the second pass");
    const rs = records(d, cap);
    assert.equal(rs.length, 2, "the first record must survive the second audit");
    assert.equal(rs[0].divergences, 0);
    assert.equal(rs[1].divergences, 1);
    cleanup(d);
  });

  test("capability-tickets-closed passes with a deferral, and names it", () => {
    // One upstream bug must not hold a capability, but a capability that passed
    // with work outstanding must never read as clean.
    const [d, cap] = ready();
    ticket(d, "open", FM({ id: 2, slug: "b" }), BODY_OK);

    const before = run(d, "audit", cap);
    assert.notEqual(before.code, 0);
    assert.match(before.out, /FAIL\s+capability-tickets-closed\s+1 still open: 0002/);

    run(d, "defer", "2", "--reason", "upstream ships nothing", "--recheck", "false");
    const after = run(d, "audit", cap);
    assert.equal(after.code, 0, after.out);
    assert.match(after.out, /capability-tickets-closed\s+1 closed; 1 deferred \(0002\)/);

    const rec = run(d, "audit", cap, "--record", "--no-divergences");
    assert.equal(rec.code, 0, rec.out);
    assert.match(docOf(d, cap), /Deferred, and therefore excluded/);
    assert.match(docOf(d, cap), /`0002`/);
    const record = records(d, cap).pop();
    assert.equal(record.verdict, "pass", "a deferral must not force the verdict");
    assert.deepEqual(record.deferred, ["0002"]);
    cleanup(d);
  });

  test("capability-tickets-closed exempts a ticket the audit filed, and only that one", () => {
    const [d, cap] = ready();
    ticket(d, "open", FM({ id: 2, slug: "found-by-audit" }), BODY_OK);

    // The plain table has no divergences, so it cannot know — it fails and says how.
    const table = run(d, "audit", cap);
    assert.notEqual(table.code, 0);
    assert.match(table.out, /FAIL\s+capability-tickets-closed\s+1 still open: 0002.*--divergence/);

    // Named as this audit's code-was-wrong finding: exempt, and the record says so.
    const rec = run(d, "audit", cap, "--record", "--divergence", "code-was-wrong|0002|scanner skips src/");
    assert.equal(rec.code, 0, rec.out);
    assert.match(rec.out, /capability-tickets-closed\s+1 closed; 1 filed by this audit \(0002\)/);
    assert.match(docOf(d, cap), /Filed by this audit, and therefore excluded from `capability-tickets-closed`:\*\* `0002`/);
    assert.equal(records(d, cap).pop().verdict, "pass", "the audit's own finding must not force the verdict");
    assert.deepEqual(records(d, cap).pop().filed, ["0002"]);

    // An ordinary open ticket — not named — still fails, even alongside a named one.
    ticket(d, "open", FM({ id: 3, slug: "unfinished" }), BODY_OK);
    const bad = run(d, "audit", cap, "--record", "--divergence", "code-was-wrong|#0002|scanner skips src/");
    assert.notEqual(bad.code, 0, "unfinished work is not exempted by an audit having filed something else");
    assert.match(bad.out, /FAIL\s+capability-tickets-closed\s+1 still open: 0003; 1 filed by this audit \(0002\)/);
    assert.equal(records(d, cap).length, 1, "a refused record writes nothing");

    // A design-was-wrong divergence names a decision, never a ticket: it exempts nothing.
    const dw = run(d, "audit", cap, "--record", "--divergence", "design-was-wrong|3|x");
    assert.notEqual(dw.code, 0);
    assert.match(dw.out, /FAIL\s+capability-tickets-closed\s+2 still open: 0002, 0003/);
    cleanup(d);
  });
});

// ────────────────────────────────────────────────── audit --sections, generic ────

describe("audit --sections: the reading list is any cited .md, with its § sections", () => {
  const OWN = "docs/capabilities/00-x.md";

  /** --sections --json for one ticket whose Description is `lines`, against the named files. */
  const sectionsOf = (files, lines, extraTickets = () => {}) => {
    const d = repo();
    for (const f of files) {
      mkdirSync(join(d, f, ".."), { recursive: true });
      writeFileSync(join(d, f), "# doc\n");
    }
    ticket(d, "open", FM({ id: 2, slug: "b" }),
      `\n## Description\n\n${lines.join("\n")}\n\n## Acceptance criteria\n\n- [ ] a\n\n## Notes\n\nx\n\n## Operator validation\n\nx\n`);
    extraTickets(d);
    const r = run(d, "audit", "00-x", "--sections", "--json");
    cleanup(d);
    const { cited } = JSON.parse(r.out);
    return cited.map((c) => [c.doc, c.sections]);
  };

  test("the capability's own design doc leads the list even when no ticket cites it", () => {
    assert.deepEqual(sectionsOf([], ["nothing cited here"]), [[OWN, []]]);
  });

  test("a path as written resolves, and its sections attach to it", () => {
    assert.deepEqual(sectionsOf(["docs/api.md"], ["Implements `docs/api.md` §3 and §4.7."]),
      [[OWN, []], ["docs/api.md", ["§3", "§4.7"]]]);
  });

  test("a bare name resolves when exactly one file in the project has it", () => {
    assert.deepEqual(sectionsOf(["design/storage.md"], ["Per storage.md §2.1."]),
      [[OWN, []], ["design/storage.md", ["§2.1"]]]);
  });

  test("an ambiguous bare name is dropped, not guessed", () => {
    assert.deepEqual(sectionsOf(["a/README.md", "b/README.md"], ["See README.md §1."]), [[OWN, []]]);
  });

  test("the capability's own doc collects its own citations; another capability's doc is a normal entry", () => {
    assert.deepEqual(sectionsOf(["docs/capabilities/01-next.md"],
      ["Built to `00-x.md` §5; touches `docs/capabilities/01-next.md` §2."]),
      [[OWN, ["§5"]], ["docs/capabilities/01-next.md", ["§2"]]]);
  });

  test("ticket files are never on the reading list, even when they exist", () => {
    // `0042-some-slug.md` is the work, not the design it was built from — and
    // a ticket filename looks exactly like a doc name from the middle.
    const got = sectionsOf([], ["Follows 0001-first.md §2 and tickets/open/0001-first.md §3."],
      (d) => ticket(d, "open", FM({ id: 1, slug: "first" })));
    assert.deepEqual(got, [[OWN, []]]);
  });

  test("a § after a prose referent is dropped, not hung on the doc sharing its line", () => {
    // "roadmap" is prose, not roadmap.md — §4.3 is the roadmap's.
    assert.deepEqual(sectionsOf(["docs/data-model.md", "docs/roadmap.md"],
      ["**the rebuild drill depends on it** (`data-model.md` §8.3 step 2, roadmap §4.3). A drill"]),
      [[OWN, []], ["docs/data-model.md", ["§8.3"]]]);
  });

  test("with two docs on a line, each § goes to the nearer preceding doc only", () => {
    assert.deepEqual(sectionsOf(["docs/data-model.md", "docs/fog.md"],
      ["See `data-model.md` §3.2 and §3.4, and `fog.md` §4.1–§4.3, §9 table."]),
      [[OWN, []], ["docs/data-model.md", ["§3.2", "§3.4"]], ["docs/fog.md", ["§4.1", "§4.3", "§9"]]]);
  });

  test("a § with no doc before it is dropped, and an unresolvable .md ends the run", () => {
    assert.deepEqual(sectionsOf(["docs/vision.md"],
      ["And §9.6, which is the reason: `vision.md` §5 says so. RFC §2.1 and `missing.md` §2 too."]),
      [[OWN, []], ["docs/vision.md", ["§5"]]]);
  });

  test("a description between sections keeps the run — only the word right before a § decides", () => {
    assert.deepEqual(sectionsOf(["docs/ui.md"],
      ["Work the `ui.md` §9 accessibility requirements and run the §9.6 reality-check table; `02` §4 is not this doc's."]),
      [[OWN, []], ["docs/ui.md", ["§9", "§9.6"]]]);
  });

  test("the text form leads with the own doc and says an empty list must be asserted", () => {
    const d = repo();
    writeFileSync(join(d, "docs/api.md"), "# api\n");
    ticket(d, "open", FM({ id: 2, slug: "b" }), "\n## Description\n\nSee `docs/api.md` §3 and 0121-tickets-audit-subcommand.md.\n\n## Acceptance criteria\n\n- [ ] a\n\n## Notes\n\nx\n\n## Operator validation\n\nx\n");
    const out = run(d, "audit", "00-x", "--sections").out;
    assert.ok(out.indexOf(OWN) < out.indexOf("docs/api.md"), out);
    assert.match(out, /docs\/api\.md\s+§3/);
    assert.ok(!/21-tickets-audit/.test(out), `a ticket filename leaked into the reading list:\n${out}`);
    assert.match(out, /--no-divergences/);
    cleanup(d);
  });
});

// ──────────────────────────────────────────────── the capability gate in next ────

describe("next refuses to advance into a new capability until every lower one has passed its audit", () => {
  /** A repo with one open ticket per named capability, and a doc for each. */
  function caps(d, ...names) {
    names.forEach((cap, i) => {
      writeFileSync(join(d, "docs/capabilities", `${cap}.md`), `# ${cap}\n`);
      ticket(d, "open", FM({ id: i + 1, slug: `t${i + 1}`, capability: cap, priority: "high" }), BODY_OK);
    });
  }
  const recordPass = (d, cap, verdict = "pass") =>
    writeFileSync(join(d, "docs/capabilities", `${cap}.md`),
      readFileSync(join(d, "docs/capabilities", `${cap}.md`), "utf8") +
      `\n<!-- audit-record ${JSON.stringify({ capability: cap, verdict })} -->\n`);

  test("the gate applies from the first capability: 01 is gated on an unaudited 00", () => {
    const d = repo();
    caps(d, "00-a", "01-b");
    const all = run(d, "next", "--all");
    assert.equal(all.code, 0, all.out);
    assert.match(all.out, /0002 .*\[GATED on 00-a\]/);
    assert.doesNotMatch(all.out, /0001 .*GATED/, "the first capability has nothing below it");
    assert.match(all.out, /2 ready, 1 gated/);
    assert.equal(JSON.parse(run(d, "next", "--json").out).id, 1);
    cleanup(d);
  });

  test("the blocker named is the EARLIEST gap, not the nearest", () => {
    // Capabilities are audited in order, so naming 02 while 00 is outstanding
    // sends you back here two capabilities later.
    const d = repo();
    caps(d, "00-a", "01-b", "02-c", "03-d");
    const all = run(d, "next", "--all");
    for (const id of ["0002", "0003", "0004"]) assert.match(all.out, new RegExp(`${id} .*GATED on 00-a`));
    assert.match(all.out, /4 ready, 3 gated/);
    cleanup(d);
  });

  test("a gap in the numbering does not launder the gate", () => {
    const d = repo();
    caps(d, "00-a", "05-b");
    assert.match(run(d, "next", "--all").out, /0002 .*GATED on 00-a/);
    cleanup(d);
  });

  test("a lower capability with a doc but no tickets does not gate", () => {
    const d = repo();
    writeFileSync(join(d, "docs/capabilities/00-a.md"), "# 00-a\n");
    caps(d, "01-b");
    const all = run(d, "next", "--all");
    assert.doesNotMatch(all.out, /GATED/, all.out);
    cleanup(d);
  });

  test("work inside the capability you are in is never blocked — only advancing is", () => {
    const d = repo();
    caps(d, "00-a", "01-b", "02-c");
    recordPass(d, "00-a");
    recordPass(d, "01-b");
    const all = run(d, "next", "--all");
    assert.equal(all.code, 0, all.out);
    assert.ok(!/GATED/.test(all.out), `02's own audit being unrecorded must not gate 02's tickets:\n${all.out}`);
    assert.match(all.out, /3 ready$/m);
    cleanup(d);
  });

  test("the gate lifts once a record says passed, and a forced verdict lifts it too", () => {
    for (const verdict of ["pass", "forced"]) {
      const d = repo();
      caps(d, "00-a", "01-b");
      assert.match(run(d, "next", "--all").out, /GATED/, "precondition: 01 is gated");
      recordPass(d, "00-a", verdict);
      assert.ok(!/GATED/.test(run(d, "next", "--all").out), `verdict '${verdict}' must lift the gate`);
      cleanup(d);
    }
  });

  test("the LAST record stands: a later failing record would re-gate, a malformed one is not a pass", () => {
    const d = repo();
    caps(d, "00-a", "01-b");
    recordPass(d, "00-a", "pass");
    recordPass(d, "00-a", "fail");
    assert.match(run(d, "next", "--all").out, /GATED on 00-a/);
    const e = repo();
    caps(e, "00-a", "01-b");
    writeFileSync(join(e, "docs/capabilities/00-a.md"), "# 00-a\n<!-- audit-record {verdict: pass} -->\n");
    assert.match(run(e, "next", "--all").out, /GATED on 00-a/);
    cleanup(d, e);
  });

  test("when every ready ticket is gated, next refuses and names the audit commands", () => {
    const d = repo();
    writeFileSync(join(d, "docs/capabilities/01-b.md"), "# 01-b\n");
    writeFileSync(join(d, "docs/capabilities/02-c.md"), "# 02-c\n");
    ticket(d, "closed", FM({ id: 1, slug: "done", capability: "01-b", status: "closed", closed: "2026-08-30T00:00:00Z" }), BODY_CLOSED);
    ticket(d, "open", FM({ id: 2, slug: "next-up", capability: "02-c", priority: "high" }), BODY_OK);
    const r = run(d, "next");
    assert.notEqual(r.code, 0);
    assert.match(r.out, /01-b/);
    assert.match(r.out, /--sections/);
    assert.match(r.out, /--record/);
    assert.match(r.out, /next --all/, "the refusal must point at the way to still see the backlog");
    cleanup(d);
  });

  test("an ungated ticket is preferred over a gated higher-priority one, and it says so", () => {
    const d = repo();
    writeFileSync(join(d, "docs/capabilities/01-b.md"), "# 01-b\n");
    writeFileSync(join(d, "docs/capabilities/02-c.md"), "# 02-c\n");
    ticket(d, "open", FM({ id: 1, slug: "gated-high", capability: "02-c", priority: "high" }), BODY_OK);
    ticket(d, "open", FM({ id: 2, slug: "open-low", capability: "01-b", priority: "low" }), BODY_OK);
    const r = run(d, "next");
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /0002/, "the ungated low-priority ticket is the one that can be worked");
    assert.match(r.out, /1 higher-priority ticket\(s\) are gated/);
    cleanup(d);
  });

  test("a ticket with no capability is never gated", () => {
    const d = repo();
    caps(d, "00-a");
    ticket(d, "open", FM({ id: 9, slug: "loose", capability: "null", type: "chore", priority: "high" }), BODY_OK);
    const r = run(d, "next", "--all");
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /GATED/);
    cleanup(d);
  });
});

describe("the gate message names the blocker's open tickets instead of an audit that cannot pass", () => {
  const BODY_DEFERRED = "\n## Description\n\nx\n\n## Deferred\n\n**Reason:** upstream\n\n```sh\ntrue\n```\n" +
    "\n## Acceptance criteria\n\n- [ ] a\n\n## Notes\n\nx\n\n## Operator validation\n\nx\n";
  const docs = (d, ...caps) => caps.forEach((c) => writeFileSync(join(d, "docs/capabilities", `${c}.md`), `# ${c}\n`));
  const closed = (d, id, cap) => ticket(d, "closed",
    FM({ id, slug: `done${id}`, capability: cap, status: "closed", closed: "2026-08-30T00:00:00Z" }), BODY_CLOSED);
  const AUDIT_ADVICE = /tickets\.mjs audit 01-b/;

  test("tail: open tickets in the blocker are listed, and audit is NOT recommended", () => {
    const d = repo();
    docs(d, "01-b", "02-c");
    ticket(d, "open", FM({ id: 1, slug: "gated", capability: "02-c", priority: "high" }), BODY_OK);
    ticket(d, "open", FM({ id: 2, slug: "open-low", capability: "01-b", priority: "low" }), BODY_OK);
    ticket(d, "open", FM({ id: 3, slug: "wip", capability: "01-b", priority: "low", status: "blocked", blocked_by: [2] }), BODY_OK);
    const r = run(d, "next");
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /1 higher-priority ticket\(s\) are gated on capability '01-b'/);
    assert.match(r.out, /2 ticket\(s\) in it are still open/);
    assert.match(r.out, /0002, 0003/);
    assert.match(r.out, /next --all/);
    assert.ok(!AUDIT_ADVICE.test(r.out), `must not recommend an audit that cannot pass:\n${r.out}`);
    // And the audit really would fail — the message and the check agree.
    assert.match(run(d, "audit", "01-b").out, /capability-tickets-closed\s+2 still open: 0002, 0003/);
    cleanup(d);
  });

  test("tail: with zero open in the blocker (one deferred), the audit wording is unchanged", () => {
    const d = repo();
    docs(d, "01-b", "02-c");
    closed(d, 1, "01-b");
    ticket(d, "open", FM({ id: 2, slug: "parked", capability: "01-b", status: "deferred", deferred: "2026-09-01T00:00:00Z" }), BODY_DEFERRED);
    ticket(d, "open", FM({ id: 3, slug: "gated", capability: "02-c", priority: "high" }), BODY_OK);
    ticket(d, "open", FM({ id: 4, slug: "loose", capability: "null", type: "chore", priority: "low" }), BODY_OK);
    const r = run(d, "next");
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /0004/);
    assert.match(r.out, /1 higher-priority ticket\(s\) are gated on capability '01-b' —\n\s+its audit has not passed\. 'tickets\.mjs audit 01-b' to start it\./);
    assert.ok(!/still open/.test(r.out), `nothing is open in 01-b, so nothing may be listed:\n${r.out}`);
    cleanup(d);
  });

  test("refusal: every ready ticket gated and the blocker's tickets blocked — lists them, no audit commands", () => {
    const d = repo();
    docs(d, "01-b", "02-c");
    ticket(d, "open", FM({ id: 1, slug: "stuck", capability: "01-b", status: "blocked", blocked_by: [2] }), BODY_OK);
    ticket(d, "open", FM({ id: 2, slug: "gated", capability: "02-c", priority: "high" }), BODY_OK);
    const r = run(d, "next");
    assert.notEqual(r.code, 0);
    assert.match(r.out, /gated on capability '01-b'/);
    assert.match(r.out, /1 ticket\(s\) in it are still open, and none is ready/);
    assert.match(r.out, /0001/);
    assert.match(r.out, /tickets\.mjs show <id>/);
    assert.ok(!/--record|--sections/.test(r.out) && !AUDIT_ADVICE.test(r.out),
      `must not hand out audit commands:\n${r.out}`);
    cleanup(d);
  });

  test("refusal: with zero open in the blocker (one deferred), the audit commands are given", () => {
    const d = repo();
    docs(d, "01-b", "02-c");
    closed(d, 1, "01-b");
    ticket(d, "open", FM({ id: 2, slug: "parked", capability: "01-b", status: "deferred", deferred: "2026-09-01T00:00:00Z" }), BODY_DEFERRED);
    ticket(d, "open", FM({ id: 3, slug: "gated", capability: "02-c", priority: "high" }), BODY_OK);
    const r = run(d, "next");
    assert.notEqual(r.code, 0);
    assert.match(r.out, /A capability is not done when its tickets are closed/);
    assert.match(r.out, /tickets\.mjs audit 01-b --sections/);
    assert.match(r.out, /tickets\.mjs audit 01-b --record/);
    assert.ok(!/still open/.test(r.out), r.out);
    cleanup(d);
  });
});

// ─────────────────────────────────────────────────────────────────────── waves ────

describe("waves: a capability's open tickets layered for parallel agents", () => {
  // In-memory tickets. One capability per case, so auditBlockers has no lower
  // capability to look up and the plan is a pure function of the list.
  const T = (o) => ({ fm: FM({ capability: "13-x", ...o }), path: `tickets/open/${o.id}.md` });
  const ids = (plan) => plan.waves.map((w) => w.map((t) => t.fm.id));
  const heldIds = (plan) => plan.held.map((h) => h.ticket.fm.id);

  test("layers by in-capability depends_on; closed dependencies anywhere count as met", () => {
    const ts = [T({ id: 1, status: "closed", capability: "05-y" }), T({ id: 86, depends_on: [1] }),
      T({ id: 87, depends_on: [86] }), T({ id: 88, depends_on: [86] }), T({ id: 249 }), T({ id: 91, depends_on: [87, 88] })];
    assert.deepEqual(ids(planWaves("13-x", ts)), [[86, 249], [87, 88], [91]]);
  });

  test("the default width is 4", () => {
    const ts = [1, 2, 3, 4, 5, 6].map((id) => T({ id }));
    const plan = planWaves("13-x", ts);
    assert.equal(plan.width, 4);
    assert.deepEqual(ids(plan), [[1, 2, 3, 4], [5, 6]]);
  });

  test("a wave wider than --max splits in priority order, then id", () => {
    const ts = [T({ id: 5, priority: "low" }), T({ id: 3, priority: "med" }), T({ id: 4, priority: "high" }), T({ id: 2, priority: "med" })];
    assert.deepEqual(ids(planWaves("13-x", ts, { max: 2 })), [[4, 2], [3, 5]]);
  });

  test("waves fill greedily — a ticket unblocked by wave 1 is in wave 2, not behind the rest of its layer", () => {
    const ts = [T({ id: 1, priority: "high" }), T({ id: 2, priority: "high" }),
      T({ id: 3, priority: "low" }), T({ id: 4, priority: "low" }), T({ id: 5, priority: "low" }), T({ id: 6, priority: "low" }),
      T({ id: 113, priority: "high", depends_on: [1] }), T({ id: 114, priority: "low", depends_on: [113] })];
    assert.deepEqual(ids(planWaves("13-x", ts, { max: 2 })), [[1, 2], [113, 3], [4, 5], [6, 114]]);
  });

  test("every capability gets the same width — no capability is special-cased", () => {
    for (const cap of ["08-map", "09-xp", "12-post"]) {
      const ts = [T({ id: 1, capability: cap }), T({ id: 2, capability: cap })];
      const plan = planWaves(cap, ts, { max: 4 });
      assert.equal(plan.width, 4);
      assert.deepEqual(ids(plan), [[1, 2]]);
    }
  });

  test("holds blocked_by, an unclosed dependency outside the capability, size l — and what depends on them", () => {
    const ts = [T({ id: 50, capability: "14-z" }), T({ id: 1, blocked_by: [50], status: "blocked" }),
      T({ id: 2, depends_on: [50] }), T({ id: 3, size: "l" }), T({ id: 4, depends_on: [3] }), T({ id: 6 })];
    const plan = planWaves("13-x", ts);
    assert.deepEqual(ids(plan), [[6]]);
    assert.deepEqual(heldIds(plan).sort(), [1, 2, 3, 4]);
    const reason = (id) => plan.held.find((h) => h.ticket.fm.id === id).reason;
    assert.match(reason(1), /blocked by 0050/);
    assert.match(reason(2), /waits on 0050 \(14-z\), outside this capability/);
    assert.match(reason(3), /size l/);
    assert.match(reason(4), /waits on 0003, which is held/);
  });

  test("closed and deferred tickets are not planned; a cycle is held, not looped on", () => {
    const ts = [T({ id: 1, status: "closed" }), T({ id: 2, status: "deferred" }),
      T({ id: 3, depends_on: [4] }), T({ id: 4, depends_on: [3] }), T({ id: 5 })];
    const plan = planWaves("13-x", ts);
    assert.deepEqual(ids(plan), [[5]]);
    assert.deepEqual(heldIds(plan).sort(), [3, 4]);
    assert.match(plan.held[0].reason, /cycle/);
  });

  test("CLI: plans the capability next would hand out, --json, and refuses a bad --max", () => {
    const d = repo();
    try {
      ticket(d, "open", FM({ id: 1, slug: "a" }));
      ticket(d, "open", FM({ id: 2, slug: "b", depends_on: [1] }));
      const r = run(d, "waves", "--json");
      assert.equal(r.code, 0, r.out);
      const j = JSON.parse(r.out);
      assert.equal(j.capability, "00-x");
      assert.equal(j.width, 4);
      assert.deepEqual(j.waves.map((w) => w.map((t) => t.id)), [[1], [2]]);
      assert.notEqual(run(d, "waves", "00-x", "--max", "0").code, 0);
      assert.notEqual(run(d, "waves", "99-nope").code, 0);
    } finally { cleanup(d); }
  });

  test("CLI: --max N is a value, never mistaken for the capability argument", () => {
    const d = repo();
    try {
      for (let i = 1; i <= 3; i++) ticket(d, "open", FM({ id: i, slug: `t${i}` }));
      const r = run(d, "waves", "--max", "2", "--json");
      assert.equal(r.code, 0, r.out);
      const j = JSON.parse(r.out);
      assert.equal(j.capability, "00-x");
      assert.deepEqual(j.waves.map((w) => w.length), [2, 1]);
    } finally { cleanup(d); }
  });

  test("CLI: a gated capability's plan says it is gated", () => {
    const d = repo();
    try {
      writeFileSync(join(d, "docs/capabilities/01-b.md"), "# 01-b\n");
      ticket(d, "open", FM({ id: 1, slug: "a" }));
      ticket(d, "open", FM({ id: 2, slug: "b", capability: "01-b" }));
      const r = run(d, "waves", "01-b");
      assert.match(r.out, /GATED: capability '00-x' has not passed its audit/);
      assert.deepEqual(JSON.parse(run(d, "waves", "01-b", "--json").out).gatedOn, ["00-x"]);
    } finally { cleanup(d); }
  });

  test("CLI: a bare capability number resolves to its slug; none or two is refused", () => {
    const d = repo();
    try {
      for (const c of ["13-home", "14-hooks", "14-other"]) writeFileSync(join(d, "docs/capabilities", `${c}.md`), "# c\n");
      ticket(d, "open", FM({ id: 1, slug: "a", capability: "13-home" }));
      ticket(d, "open", FM({ id: 2, slug: "b", capability: "14-hooks" }));
      ticket(d, "open", FM({ id: 3, slug: "c", capability: "14-other" }));
      const r = run(d, "waves", "13", "--json");
      assert.equal(r.code, 0, r.out);
      assert.equal(JSON.parse(r.out).capability, "13-home");
      const none = run(d, "waves", "12");
      assert.notEqual(none.code, 0);
      assert.match(none.out, /numbered 12/);
      const two = run(d, "waves", "14");
      assert.notEqual(two.code, 0);
      assert.match(two.out, /ambiguous: 14-hooks, 14-other/);
    } finally { cleanup(d); }
  });
});

process.on("exit", () => rmSync(EMPTY_ROOT, { recursive: true, force: true }));
