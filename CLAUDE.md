# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

This is **TicketSmith itself** — the source of a markdown-only methodology
*kit*, not a project that has the kit installed. There is no application
code, no build, no lint, no test suite, no dependency manifest. Every file
is Markdown. "Working in this repo" means editing prose: templates, prompts,
and methodology docs that get copied into *other* projects.

Do not look for a way to "run" or "test" this. Validation is reading the
Markdown and checking it against the methodology (below) and for internal
cross-reference consistency.

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

The repo is organized by *how each file is used*. The three top-level
directories map directly to three roles:

- **`docs/`** — methodology references. `METHODOLOGY.md` (the why) and
  `TICKET_FORMAT.md` (the exact ticket-markdown spec). Plus `README.md` at
  the root (overview). Read these as authoritative on intent.
- **`templates/`** — everything that gets copied into a *target* project at
  install time. The subtree mirrors where each file lands in that project:
  - `templates/CLAUDE.md.template` → the project's `CLAUDE.md` (the one file
    *adapted* per project; the rest are copied verbatim)
  - `templates/.claude/commands/tickets.md` → the `/tickets` slash command
  - `templates/docs/capabilities/WORKFLOW.md` → capability process
  - `templates/docs/capabilities/TEMPLATE.md` → capability-doc template
  - `templates/prompts/{CAPABILITY_DESIGN,CONSOLIDATION_PASS,ARCHITECTURE_REVIEW}.md`
    → prompts the operator runs *inside* their installed project
- **`prompts/`** — operator-run prompts that act *on* the kit or target, and
  are **not** installed: `INSTALL.md`, `MIGRATE_EXISTING_TICKETS.md`,
  `ROADMAP_DESIGN.md`. Each is self-contained; the operative text lives in a
  fenced ```` ``` ```` block meant to be pasted whole.

This layout is what `README.md`'s links and `prompts/INSTALL.md` (Phase 1
read list, Phase 4 source→destination map) already describe. The two were
inconsistent before — the repo was flat while the docs assumed this nested
shape — and have now been reconciled to match.

The lifecycle these files drive, end to end: `prompts/MIGRATE_EXISTING_TICKETS.md`
(if needed) → `prompts/INSTALL.md` installs the kit (adapting
`templates/CLAUDE.md.template`, copying the rest) → `prompts/ROADMAP_DESIGN.md`
picks work → `templates/prompts/CAPABILITY_DESIGN.md` designs one capability
→ `templates/.claude/commands/tickets.md` (`/tickets`) implements it →
`templates/prompts/CONSOLIDATION_PASS.md` / `ARCHITECTURE_REVIEW.md` clean up
periodically.

## Two path namespaces — don't confuse them

Files under `templates/` reference *each other* using the paths they'll have
**after install** in the target project (e.g. `WORKFLOW.md` points at
`prompts/CAPABILITY_DESIGN.md`, `docs/capabilities/TEMPLATE.md`, and
`.claude/commands/tickets.md`). Those are **destinations**, correct for the
installed context — not locations in this repo. Do **not** "fix" them to
`templates/...` paths; that would break the installed project.

By contrast, `prompts/INSTALL.md` reads from the *kit* and so refers to repo
paths (`docs/METHODOLOGY.md`, `templates/CLAUDE.md.template`, etc.), and
`README.md`'s links resolve within this repo. When editing any cross-
reference, first decide which namespace it's in: a file *in this repo*
(matches the layout above) or a file *in an installed project* (the nested
post-install layout described in `README.md`'s "What you get").

## Editing discipline specific to this repo

- **Keep the contracts in lockstep.** `docs/TICKET_FORMAT.md` (the spec), the
  closing procedure in `templates/.claude/commands/tickets.md`, and the
  capability lifecycle in `templates/docs/capabilities/WORKFLOW.md` and
  `TEMPLATE.md` describe the same artifacts from different angles. Frontmatter
  fields, status values, folder names (`tickets/open/`, `tickets/closed/`),
  and the `NNNN-slug.md` naming must stay identical across all of them. A
  change to one usually needs the same change in the others.
- **Preserve the verbatim/adapted distinction.** The `/tickets` command,
  `WORKFLOW.md`, and `TEMPLATE.md` are installed verbatim — write them to be
  project-agnostic (no project-specific assumptions). `CLAUDE.md.template` is
  the one file meant to be adapted per project; its placeholder/`INSTALLER
  NOTE` comment blocks exist on purpose — don't fill them with concrete
  content here.
- **Don't break the pasteable prompt blocks.** In the prompt files, the
  fenced code block is the artifact the operator copies. Edits go inside it;
  keep it self-contained and don't add repo-specific context that wouldn't
  make sense pasted into a stranger's project.
- **Examples reference Cyclopean Codex**, the CTF framework TicketSmith was
  extracted from (`docs/METHODOLOGY.md` "Origins"). Sample tickets/paths like
  `backend/cyclopean/...` are illustrative, not part of this repo.
