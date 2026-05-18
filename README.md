# TicketSmith

> A disciplined design-and-build methodology for AI-assisted software projects.
> Markdown tickets, capability-driven design, and an opinionated workflow that
> keeps long projects coherent across many sessions.

## What this is

TicketSmith is a **methodology kit**, not a tool. It's a set of prompts,
templates, and conventions that you install into a software project so that
work with an AI coding assistant (Claude Code, Cursor, etc.) follows a
consistent shape:

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
- **The AI asks clarifying questions first.** The `/tickets` command
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
that survived 30+ implementation sessions without architectural drift.
The discipline works in any language, any framework, any project shape.
The kit is intentionally markdown-only so it imposes nothing on your
tech stack.

## What you get

After installing TicketSmith into a project:

```
your-project/
├── CLAUDE.md                          # merged orientation file
├── tickets/
│   ├── open/                          # active tickets
│   └── closed/                        # resolved tickets (historical)
├── docs/
│   ├── ARCHITECTURE.md                # exists already, or designed during install
│   ├── DECISIONS.md                   # append-only ADR log
│   └── capabilities/
│       ├── WORKFLOW.md                # the steady-state process
│       ├── TEMPLATE.md                # capability doc template
│       └── NN-name.md                 # one per capability you build
├── prompts/
│   ├── CAPABILITY_DESIGN.md           # design prompt for new capabilities
│   ├── CONSOLIDATION_PASS.md          # cleanup after multi-ticket builds
│   └── ARCHITECTURE_REVIEW.md         # periodic doc-drift correction
└── .claude/
    └── commands/
        └── tickets.md                 # the /tickets slash command
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
  Claude reads the docs, prioritizes the open tickets, and works through
  them — asking clarifying questions and proposing approaches for
  non-obvious work.

Every few capabilities (or every few months of active work), use
`prompts/ARCHITECTURE_REVIEW.md` to catch documentation drift before it
bites. After a multi-ticket buildout where the code grew faster than the
seams got smoothed, use `prompts/CONSOLIDATION_PASS.md` to clean up.

## Reading further

- [`docs/METHODOLOGY.md`](docs/METHODOLOGY.md) — the philosophy in detail
- [`docs/TICKET_FORMAT.md`](docs/TICKET_FORMAT.md) — the ticket markdown spec
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
