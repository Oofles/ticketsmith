# The TicketSmith Methodology

> The philosophy behind the kit. Read this if you want to understand *why*
> TicketSmith is shaped the way it is. If you just want to use it, the
> README is enough.

## The problem

AI-assisted software development has a coherence problem. A long project
spans dozens or hundreds of sessions. Each session starts with an empty
context window. The AI has no memory of past decisions, past discussions,
or past tradeoffs. It re-derives everything from whatever's currently
visible — usually some code, maybe a README, maybe whatever the operator
remembers to paste in.

This works fine for small projects. It breaks down on long ones in
predictable ways:

- **Scope creep.** The AI sees adjacent code and helpfully extends it,
  even when the operator's task didn't ask for that. Tickets that should
  be 50 lines become 300.
- **Drift between docs and code.** The README says one thing, the code
  does another. Future sessions trust whichever they encounter first,
  often producing wrong work.
- **Re-litigated decisions.** A design choice was made for good reasons
  three months ago. The AI doesn't know those reasons. It proposes
  reverting the choice, the operator says yes because they've forgotten
  too, and the project oscillates.
- **Premature abstraction.** The AI sees one use case and proposes a
  generalization for the second use case that doesn't exist yet. The
  generalization survives; when the real second use case arrives, it
  doesn't fit the generalization.
- **Conversation-as-state.** The operator and AI build up shared context
  in a long conversation. When the conversation ends — `/clear`,
  session crash, new day — that state is lost. Reconstructing it takes
  longer than the original work.

These aren't AI failures. They're failures of *how the work is organized
around the AI*. TicketSmith is a way of organizing work that survives
the empty-context-window reset.

## The core idea

**The artifacts of work outlive any single session.** Every new session
reads the artifacts, not the conversation history. The artifacts encode
enough context that a fresh AI can pick up where the last one left off.

The artifacts are:

- **Architecture documents** that describe the system as it is, not as
  it was originally planned.
- **Decision logs** (ADRs) that explain *why* the system is the way it
  is, append-only.
- **Capability documents** that describe a coherent unit of work before
  any code is written.
- **Tickets** that describe specific implementation work, scoped to
  one focused session.
- **A slash command and prompts** that encode how the AI should approach
  recurring kinds of work.

None of these are clever. The cleverness is in the discipline of
keeping them up to date and trusting them over conversation history.

## Mechanics are a script; judgement is the AI's

A discipline written only as prose is a discipline the AI can skip
under pressure — and it skips it exactly when it matters: the criterion
ticked because the work "obviously" meets it, the audit postponed
because the next capability is more interesting, the dependency order
re-guessed from ticket prose and guessed slightly differently each
session.

So the kit splits the work along one line. Everything **mechanical** —
allocating ids, computing which tickets are ready from their declared
dependencies, moving files, validating the format, refusing a close
whose criteria are unchecked — is done by `tickets.mjs`, deterministically
and for zero tokens. Everything **judgemental** — what a ticket means,
whether the work genuinely meets a criterion, what to write in the
Resolution, whether the design was wrong — is the AI's, and the script
never pretends to decide it.

The script's refusals are where the disciplines bite. It will not close
a ticket with an unchecked box, will not accept an operator check
without a dated result, and will not hand over work in the next
capability until the last one's drift audit is recorded. None of these
have a quiet override. The ones that can be overridden at all (`--force`
on an audit) record that they were.

This also removes a tax that grows with the project. Ordering a backlog
by reading every open ticket is fine at eight tickets and broken at
sixty; the script reads frontmatter, not prose, and answers the same way
every time.

## The five disciplines

### 1. Design before tickets, tickets before code

Every capability has a design document first. The design document is
filled out *in conversation* with the AI, before any tickets exist.
The design covers what the capability adds, what it changes
architecturally, what new abstractions (if any), what's deliberately
out of scope, and any open questions.

When the design document is settled, tickets are generated from it.
Tickets cite the design document. Tickets do not invent scope; they
implement scope.

When the tickets are ready, a fresh session implements them.
Implementation does not redesign; it implements.

Skipping the design step is the single most common way to break this
methodology. The temptation is always to "just start coding" — and
just-start-coding is exactly how scope creeps, abstractions get
premature, and capabilities turn into multi-session slogs.

### 2. Ask first, code second

When the AI starts work — implementing a ticket, designing a
capability, whatever — its first job is not to produce output. Its
first job is to *understand the constraints*. That means reading the
architecture docs, reading the capability doc if relevant, reading
related code, and then asking clarifying questions about ambiguities.

Clarifying questions are asked **in batches**, not dripped one at a
time. One round of questions per task; multiple rounds if absolutely
necessary, but treat that as a sign the task was underspecified.

For non-obvious solutions — where multiple architectures are plausible,
or where a new abstraction is being introduced, or where shared
infrastructure is being modified — the AI **proposes** before
implementing. The operator confirms or redirects. Mechanical changes
don't need this; design decisions do.

This is slow. It's slower than letting the AI just start coding. The
slowness is the value. Mistakes caught at proposal time cost
proportionally less than mistakes caught at code-review time.

### 3. Disk is the source of truth

Tickets live on disk as markdown files. Capability docs live on disk.
Architecture docs live on disk. Decision logs live on disk.

Nothing lives only in conversation. Nothing lives only in a database.
Anything that matters for future work is committed to disk and
versioned with the code.

This is what makes the methodology survive session resets. A fresh AI
can read the disk and reconstruct everything it needs. A fresh AI
cannot read the previous conversation.

### 4. Don't design ahead

The temptation when designing capability #1 is to also design
capabilities #2 through #5. Resist this. The shape of capability #2
will be informed by what you learn building capability #1. The shape
of #3 by #2. And so on.

Roadmaps are useful for *picking* the next capability. They are not
useful for *designing* the next capability. The detail goes in the
capability doc, written immediately before that capability is built.

A capability roadmap that's six months ahead of where you are is
mostly fiction. Treat it accordingly.

### 5. Reality grounds design

Every capability ships through a five-step cycle: DESIGN →
TICKET-WRITE → BUILD → USE → REFLECT. The fourth step — actually
using the capability against real work — is the most important and
the most-skipped.

Shipping code that passes tests is not the same as shipping a
capability that works in practice. The capability isn't done until
you've used it on a real task and lived with the consequences. The
reflection step captures what you learned, in the capability doc,
so the next capability is informed by reality rather than design
intention.

REFLECT is a drift audit, not a diary entry. Re-read the design
sections the capability's tickets cited, list every place the
implementation differs, and resolve each one: either the code was
wrong (file a ticket) or the design was wrong (amend the doc and record
why). Never neither. More than three divergences means the design is
stale, and the next step is a design session, not more tickets. The
next capability does not start until the audit is recorded.

Validation follows the same honesty. The operator's eyes are spent on
what only eyes can judge — does it look right, does it read, does it
feel right. Anything the AI can check itself, it checks, and writes
down what the check proved.

## What this is and isn't

**TicketSmith is:**

- A way to organize work that survives AI session resets
- A set of opinionated defaults for project structure
- A pattern for separating design from implementation
- A discipline for keeping documentation accurate

**TicketSmith is not:**

- A code generator
- A project management tool (no kanban, no burndown, no time tracking)
- A replacement for thinking about your architecture
- Specific to any language or framework (it is built for Claude Code,
  and needs Node.js and git for its one script)
- Multiplayer (it assumes one operator, though nothing fundamentally
  blocks teams from using it)

## When to use it

TicketSmith is overkill for short projects, prototypes, scripts, or
anything you expect to finish in one or two sessions. The overhead
isn't worth it.

TicketSmith starts to earn its keep when:

- The project will span more than a handful of sessions
- You expect to come back to it after a break and need to remember why
- The project has architectural decisions worth preserving
- You've felt the pain of AI scope creep or doc drift before
- You're working on something where consistency matters more than speed

If any of those apply, the discipline pays off quickly. The first few
captures of "wait, why did we decide that?" in `DECISIONS.md` justify
the methodology by themselves.

## When not to use it

- One-off scripts or single-file projects
- Throwaway prototypes that won't survive the week
- Projects where the architecture is genuinely emergent and you don't
  yet know what you're building
- Projects where you actually want the AI to just-start-coding because
  the cost of mistakes is low and the speed gain matters

TicketSmith trades speed for coherence. If you don't need coherence,
don't pay the speed cost.

## Origins

The methodology was extracted from Cyclopean Codex, a personal CTF
automation framework built across many evenings with Claude Code. Early
in the project, sessions kept producing work that didn't fit together —
tickets that overlapped, abstractions that contradicted each other,
docs that drifted from code. The disciplines in this document evolved
in response to those specific failures. Each one solves a real problem
that occurred at least twice before the discipline was added.

The kit was then used to build Lost Soles, a phone-first running app,
across hundreds of tickets and nineteen capabilities. That second
project is where the kit grew its machinery: structured dependencies
once the backlog outgrew reading every ticket, the `deferred` state
once tickets started waiting on upstream fixes, the drift audit once
capabilities began closing with their designs quietly falsified, and
parallel waves once tickets were small and well-declared enough to
build side by side. Each of those, again, answered a failure that had
already happened.

The kit is what's left when you extract the methodology from any one
project's specifics. It should work on any sufficiently long-lived
software project where an AI is doing meaningful work.
