# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

This is **TicketSmith itself** — the source of a methodology *kit*, not a
project that has the kit installed. It is Markdown plus **one script**:
`templates/.claude/skills/tickets/scripts/tickets.mjs`, the mechanical half
of `/tickets` (ids, dependency ordering, file moves, validation, the audit
gate). There is no build, no lint, and no dependency manifest. "Working in
this repo" mostly means editing prose: templates, prompts, and methodology
docs that get copied into *other* projects.

The script is installed verbatim into arbitrary target projects, so it must
stay **Node standard library only** — no `package.json`, no imports outside
`node:*`, nothing that assumes the target's language or stack. Its tests
live in `tests/tickets.test.mjs` (not installed) and run with:

```
node --test tests/tickets.test.mjs
```

Run them after any change to the script. For prose, validation is reading
the Markdown and checking it against the methodology (below) and for
internal cross-reference consistency.

## The methodology these files encode

TicketSmith exists to keep long, AI-assisted projects coherent across many
sessions by making the *artifacts of work outlive any single session*. The
five disciplines (full text in `docs/METHODOLOGY.md`) constrain every edit
you make here, because the files you're editing are what enforce them
downstream:

1. **Design before tickets, tickets before code.** Capabilities get a design
   doc before any ticket; tickets before any code.
2. **Ask first, code second.** Read constraints, batch clarifying questions,
   propose before implementing non-obvious work.
3. **Disk is the source of truth.** Tickets/docs/decisions live on disk as
   markdown, never only in conversation or a database.
4. **Don't design ahead.** Each capability's design is informed by the
   previous one's reality; roadmaps pick the next capability, they don't
   design it.
5. **Reality grounds design.** Every capability ships through DESIGN →
   TICKET-WRITE → BUILD → USE → REFLECT. Steps 4–5 are the most-skipped and
   the most important.

The kit is **deliberately opinionated**. Per `README.md`, changes that
compromise the opinionation are likely to be declined. Don't soften the
disciplines, add configurability, or make the structure flexible to be
"helpful." If a request fights the opinionation, surface that rather than
quietly accommodating it.

## Repository layout (the real architecture)

The repo is organized by *how each file is used*. The four top-level
directories map directly to four roles:

- **`docs/`** — methodology references. `METHODOLOGY.md` (the why) and
  `TICKET_FORMAT.md` (the exact ticket-markdown spec). Plus `README.md` at
  the root (overview). Read these as authoritative on intent.
- **`templates/`** — everything that gets copied into a *target* project at
  install time. The subtree mirrors where each file lands in that project:
  - `templates/CLAUDE.md.template` → the project's `CLAUDE.md` (adapted
    per project)
  - `templates/.claude/skills/tickets/{SKILL.md,reference.md,scripts/tickets.mjs}`
    → the `/tickets` skill: routing and judgement, the format spec and close
    procedure, and the script
  - `templates/docs/capabilities/WORKFLOW.md` → capability process
  - `templates/docs/capabilities/TEMPLATE.md` → capability-doc template
  - `templates/docs/capabilities/AUDIT.md` → capability-close drift audit
    (its `audit-checks` block is adapted per project)
  - `templates/docs/capabilities/WAVES.md` → parallel build protocol (its §7
    gate is adapted per project)
  - `templates/prompts/{CAPABILITY_DESIGN,CONSOLIDATION_PASS,ARCHITECTURE_REVIEW}.md`
    → prompts the operator runs *inside* their installed project
- **`tests/`** — `tickets.test.mjs`, the script's `node:test` suite. Not
  installed.
- **`prompts/`** — operator-run prompts that act *on* the kit or target, and
  are **not** installed: `INSTALL.md`, `MIGRATE_EXISTING_TICKETS.md`,
  `ROADMAP_DESIGN.md`. Each is self-contained; the operative text lives in a
  fenced ```` ``` ```` block meant to be pasted whole.

This layout is what `README.md`'s links and `prompts/INSTALL.md` (Phase 1
read list, Phase 4 source→destination map) describe; keep all three in
step.

The lifecycle these files drive, end to end: `prompts/MIGRATE_EXISTING_TICKETS.md`
(if needed) → `prompts/INSTALL.md` installs the kit (adapting
`templates/CLAUDE.md.template`, copying the rest) → `prompts/ROADMAP_DESIGN.md`
picks work → `templates/prompts/CAPABILITY_DESIGN.md` designs one capability
→ `/tickets` (the skill) implements it, serially or in waves
(`WAVES.md`) → `/tickets audit` closes it against `AUDIT.md`, which gates
the next capability → `templates/prompts/CONSOLIDATION_PASS.md` /
`ARCHITECTURE_REVIEW.md` clean up periodically.

## Two path namespaces — don't confuse them

Files under `templates/` reference *each other* using the paths they'll have
**after install** in the target project (e.g. `WORKFLOW.md` points at
`prompts/CAPABILITY_DESIGN.md`, `docs/capabilities/TEMPLATE.md`, and
`.claude/skills/tickets/SKILL.md`). Those are **destinations**, correct for the
installed context — not locations in this repo. Do **not** "fix" them to
`templates/...` paths; that would break the installed project.

By contrast, `prompts/INSTALL.md` reads from the *kit* and so refers to repo
paths (`docs/METHODOLOGY.md`, `templates/CLAUDE.md.template`, etc.), and
`README.md`'s links resolve within this repo. When editing any cross-
reference, first decide which namespace it's in: a file *in this repo*
(matches the layout above) or a file *in an installed project* (the nested
post-install layout described in `README.md`'s "What you get").

## Editing discipline specific to this repo

- **Keep the contracts in lockstep.** `docs/TICKET_FORMAT.md` (the spec and
  its rationale), `templates/.claude/skills/tickets/reference.md` (the
  installed extract of it, plus the close procedure), `SKILL.md`, the script
  itself, and the capability lifecycle in `WORKFLOW.md`, `TEMPLATE.md`,
  `AUDIT.md` and `WAVES.md` describe the same artifacts from different
  angles. Frontmatter fields, enum values, required sections, folder names
  (`tickets/open/`, `tickets/closed/`), the `NNNN-slug.md` naming, the
  validation rules, and the audit's REFLECT-heading and record format must
  stay identical across all of them. **The script is the ground truth for
  behaviour**: when prose and code disagree, decide which is wrong, then fix
  both in one commit — and add a test when the code changes.
- **Preserve the verbatim/adapted distinction.** The skill (all three files),
  `WORKFLOW.md`, and `TEMPLATE.md` are installed verbatim — write them to be
  project-agnostic (no project-specific assumptions). Three things are
  adapted per project: `CLAUDE.md.template`, AUDIT.md's `audit-checks` block,
  and WAVES.md's §7 gate. Their placeholder/`INSTALLER NOTE` comment blocks
  exist on purpose — don't fill them with concrete content here. Don't add a
  fourth adapted surface or a config file to the script: per-project
  flexibility in the mechanics is exactly what the kit is opinionated
  against.
- **Don't break the pasteable prompt blocks.** In the prompt files, the
  fenced code block is the artifact the operator copies. Edits go inside it;
  keep it self-contained and don't add repo-specific context that wouldn't
  make sense pasted into a stranger's project.
- **Examples reference Cyclopean Codex**, the CTF framework TicketSmith was
  extracted from (`docs/METHODOLOGY.md` "Origins"). Sample tickets/paths like
  `backend/cyclopean/...` are illustrative, not part of this repo. The
  skill, script, audit and waves were hardened in a second project, Lost
  Soles; its specifics (its decision ids, ticket numbers, stack) don't
  belong in the kit.
