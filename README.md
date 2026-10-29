# TicketSmith

> A disciplined design-and-build methodology for AI-assisted software projects.
> Markdown tickets, capability-driven design, and an opinionated workflow that
> keeps long projects coherent across many sessions.

## What this is

TicketSmith is a **methodology kit**. It's a set of prompts, templates,
conventions, and one small script that you install into a software project
so that work with Claude Code follows a consistent shape:

- **Tickets are markdown files on disk.** No database, no GitHub Issues, no
  Jira. Disk is the source of truth.
- **Work happens in capability units, not feature units.** A capability is
  a coherent operator-facing change, designed in one focused session,
  decomposed into 3-8 tickets, built across one or two implementation
  sessions, and validated against real use before being marked shipped.
- **Design is separate from implementation.** Each capability gets a
  design document before any tickets are filed. Tickets are filed before
  any code is written. Code is written against tickets, not against
  conversation.
- **The mechanics are a script; the judgement is the AI's.** A
  dependency-free Node script owns ticket ids, dependency ordering, file
  moves, and validation. It refuses to close a ticket with unmet criteria
  or an unverified operator check, and refuses to start the next
  capability until the last one has passed its drift audit. The AI decides
  what a ticket means and whether the work is genuinely done.
- **The AI asks clarifying questions first.** The `/tickets` skill
  doesn't start coding the moment it has a ticket. It reads the
  architecture docs, surfaces ambiguity, proposes approaches for
  non-obvious solutions, and gets your input before committing.
- **Architectural decisions are append-only history.** A `DECISIONS.md`
  file logs why things are the way they are, so future sessions don't
  silently relitigate past choices.

## Why it exists

Long AI-assisted projects fail in predictable ways: scope creep, drift
between docs and code, prematurely-abstracted code, and conversations that
get longer and longer until the AI loses the plot. TicketSmith addresses
each of those by making the artifacts of work — capability docs, tickets,
decisions — *outlive any single session*. Every new session reads the docs,
not the conversation history.

The methodology was extracted from a personal CTF automation framework
that survived 30+ implementation sessions without architectural drift,
then hardened over 300+ tickets on a second project, where rules written
only as prose were the ones that got skipped. The discipline works in any
language, any framework, any project shape.

The kit imposes one requirement on your environment: **Node.js
18 or later** and **git**, for `tickets.mjs`. The script uses only
Node's standard library — no `package.json`, no `npm install` — so it
runs the same in a Python, Go, or Rust project as in a JavaScript one.
Everything else is markdown.

## What you get

After installing TicketSmith into a project:

```
your-project/
├── CLAUDE.md                          # merged orientation file
├── tickets/
│   ├── open/                          # active tickets (open, blocked, deferred)
│   ├── closed/                        # resolved tickets (historical)
│   └── index.json                     # generated index, committed
├── docs/
│   ├── ARCHITECTURE.md                # exists already, or designed during install
│   ├── DECISIONS.md                   # append-only ADR log
│   └── capabilities/
│       ├── WORKFLOW.md                # the steady-state process
│       ├── TEMPLATE.md                # capability doc template
│       ├── AUDIT.md                   # capability-close drift audit
│       ├── WAVES.md                   # parallel build protocol
│       └── NN-name.md                 # one per capability you build
├── prompts/
│   ├── CAPABILITY_DESIGN.md           # design prompt for new capabilities
│   ├── CONSOLIDATION_PASS.md          # cleanup after multi-ticket builds
│   └── ARCHITECTURE_REVIEW.md         # periodic doc-drift correction
└── .claude/
    └── skills/
        └── tickets/
            ├── SKILL.md               # the /tickets skill
            ├── reference.md           # ticket format + close procedure
            └── scripts/
                └── tickets.mjs        # ids, ordering, moves, validation
```

Your code is untouched. The kit installs alongside whatever you've got.

## How to install

TicketSmith is installed by an AI assistant, not by hand. You paste a
prompt; Claude Code (or equivalent) handles the rest.

The install flow:

1. Clone this repo, or note its raw URL on GitHub.
2. Open Claude Code in your target project. `/clear` to start fresh.
3. Paste the install prompt from [`prompts/INSTALL.md`](prompts/INSTALL.md).
4. Tell Claude where TicketSmith lives (local path or GitHub URL).
5. Answer Claude's discovery questions about your project.
6. Review Claude's integration plan.
7. Confirm; Claude installs the kit.

The install prompt is opinionated about structure but adapts to your
project. It will read your existing architecture docs to produce a
project-specific `CLAUDE.md`. It will never touch your source code. It
refuses to overwrite existing TicketSmith files without explicit
confirmation.

If your project already has a ticketing system in another format, see
[`prompts/MIGRATE_EXISTING_TICKETS.md`](prompts/MIGRATE_EXISTING_TICKETS.md)
to convert your tickets first, then run the installer.

If your project doesn't have a capability roadmap yet, the installer will
direct you to [`prompts/ROADMAP_DESIGN.md`](prompts/ROADMAP_DESIGN.md) to
design one collaboratively.

## How to use it after install

The two prompts you'll use most:

- **To design a new capability:** paste `prompts/CAPABILITY_DESIGN.md` in
  a fresh Claude Code session, fill in the placeholders, iterate on the
  design doc, then `/clear` and run `/tickets` to implement.
- **To work through filed tickets:** in a fresh session, run `/tickets`.
  Claude reads the docs, asks the script for the ready order, and works
  through the tickets — asking clarifying questions and proposing
  approaches for non-obvious work. `/tickets wave <NN>` builds a
  capability's independent tickets in parallel, one agent per ticket.
- **When a capability's tickets are all closed:** run `/tickets audit <NN>`.
  The drift audit checks the implementation against the design, and the
  next capability can't start until it passes.

Every few capabilities (or every few months of active work), use
`prompts/ARCHITECTURE_REVIEW.md` to catch documentation drift before it
bites. After a multi-ticket buildout where the code grew faster than the
seams got smoothed, use `prompts/CONSOLIDATION_PASS.md` to clean up.

## Reading further

- [`docs/METHODOLOGY.md`](docs/METHODOLOGY.md) — the philosophy in detail
- [`docs/TICKET_FORMAT.md`](docs/TICKET_FORMAT.md) — the ticket markdown spec, and why each field exists
- [`prompts/INSTALL.md`](prompts/INSTALL.md) — the AI install prompt
- [`templates/`](templates/) — what gets installed into your project

## License

MIT. Use it for anything. No attribution required, no warranty implied.
See [`LICENSE`](LICENSE).

## Contributions

Personal project, but PRs welcome. No commitment to review them quickly,
and the methodology is opinionated — changes that compromise the
opinionation are likely to be declined. Open an issue first if you're
proposing something significant.
