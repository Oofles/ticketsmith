# Capability Workflow

> How this project grows. The steady-state process for adding new
> capabilities. If you're reading this and about to start a new
> capability, follow it. If it feels wrong for what you're doing,
> that's worth a discussion with the operator before deviating.

## The unit of work: a capability

A **capability** is a coherent operator-facing change to the project.
"User authentication" might be a capability. "Add a button" is not — it's
a ticket within some capability. "Make the project better" is not — it's
a wish.

A good capability has these properties:

- One sentence describes what changes for the operator
- Designable in a single focused session
- Implementable in 3-8 tickets
- Shippable in one or two `/tickets` runs
- Useful on its own, even if nothing else gets built afterward

If your proposed capability fails any of these tests, it's too big.
Split it.

## The cycle

Each capability follows the same five-step cycle:

```
1. DESIGN        → docs/capabilities/NN-name.md exists, filled out,
                   open questions resolved
2. TICKET-WRITE  → tickets/open/NNNN-*.md files exist, one per
                   capability ticket
3. BUILD         → all tickets closed, code merged, capability docs
                   updated with implementation notes
4. USE           → run the project against real work for at least
                   one session
5. REFLECT       → the drift audit passes (`/tickets audit`), the
                   REFLECT section is written, Status: shipped
```

Don't skip steps 4 and 5. They're where the project actually gets
better, because they're where reality contradicts the design.

## Capability close: the drift audit

A capability is not done when its tickets are closed — it is done when
`docs/capabilities/AUDIT.md` passes. The governing rule: *if the
implementation diverged from the design doc, either the code changes
or the doc changes, never neither.*

This is enforced, not requested. `/tickets next` refuses to hand over
work in a later capability while an earlier one with tickets has no
recorded audit, and the audit refuses to record without an explicit
statement of what diverged (or that nothing did) and a REFLECT section
with substance. More than three divergences fails the audit: the
design is stale, and the fix is a DESIGN session, not more tickets.

## Tickets, briefly

The full format is in `.claude/skills/tickets/reference.md`. What
matters for capability work:

- Every ticket names its `capability`, so a ticket leads back to its
  design and the audit can find every ticket a capability owns.
- Planned ordering goes in `depends_on` at ticket-write time; walls
  hit mid-build go in `blocked_by`. Keeping them apart is what lets
  REFLECT tell foreseen order from discovered order.
- `size: m` (30 minutes to 2 hours) is the target. `size: l` means
  "split it", and `/tickets next` will not start one.
- A ticket waiting on the outside world — an upstream fix, a third
  party — is `deferred`, with a reason and a runnable re-check, not
  left open to be rediscovered every session.
- The mechanics (ids, ordering, moves, validation) belong to
  `.claude/skills/tickets/scripts/tickets.mjs`. Don't do them by hand.

A capability with several independent tickets can be built in
parallel waves — one agent per ticket, in its own worktree — following
`docs/capabilities/WAVES.md`.

## Where design happens

**Default: in the AI coding environment, against the actual
codebase.** Reality grounding beats clean separation in almost all
cases.

**Exceptions where you should use a different surface (chat, web UI,
whatever) instead:**

- You're considering changing foundational architecture documents.
  Foundational changes deserve outside perspective.
- You're stuck. The "this doesn't fit and I don't know why" feeling
  means a fresh view is worth more than another pass at the code.
- Cross-capability decisions that affect multiple unbuilt things at
  once.
- Periodic architecture review (see below).

When in doubt: design in the code environment. The escape hatches
are explicit.

## The design protocol

When designing a capability, the session must follow this discipline
or it slips into premature implementation:

**Session opens with `/clear`. First prompt is the design prompt** (see
`prompts/CAPABILITY_DESIGN.md`). The prompt explicitly forbids
implementation proposals until the design doc is filled out.

**Order of operations within the session:**

1. Read foundational docs (`ARCHITECTURE.md`, this `WORKFLOW.md`, recent
   capability docs).
2. Summarize what was found and ask clarifying questions about the
   proposed capability. **No implementation yet.**
3. Iterate on filling out the capability doc from `TEMPLATE.md`.
4. Resolve open questions or explicitly punt them with stated defaults
   before tickets are generated.
5. Create the tickets with `/tickets create` (one per ticket in the
   doc, with `capability`, `size` and `depends_on` set), write their
   bodies, and get `/tickets validate` clean.
6. `/clear`. Fresh session. Run `/tickets` (or `/tickets wave <NN>`)
   to implement.

The two `/clear`s matter. Design context contaminates implementation
decisions; implementation context contaminates the next capability's
design.

## When to step outside the code environment

Specifically use a fresh chat surface (or any environment that doesn't
have the codebase in context) for:

**Foundational changes.** If a capability would alter the architecture
documents, design it outside first. Paste the current docs, describe
what's pushing the change, work it out without code-inertia.

**Stuckness.** If you've tried designing a capability twice in the code
environment and it keeps coming out wrong, that's a signal. Step
outside, paste the current docs and the failing attempts, ask "what am
I missing?"

**Periodic architecture review.** Every 4-6 capabilities, or every
couple months of active development, do this:

1. Open a fresh chat surface
2. Paste the architecture docs, decisions log, and recent capability
   docs
3. List capabilities shipped since the last review
4. Ask: "What's drifted? What's the docs telling me that's no longer
   true? What patterns have we evolved that aren't reflected here?"
5. Update the foundational docs based on the review

The `prompts/ARCHITECTURE_REVIEW.md` file in this project has a ready
prompt for this. Run it on the cadence above. Skipping it is the most
common way the workflow breaks.

## The capability doc lifecycle

Capability docs live at `docs/capabilities/NN-name.md`, numbered
sequentially. They have five states reflected in the `Status:` line at
the top:

- **draft** — being written, not all sections filled out, open
  questions remain
- **in-design** — actively being designed with the AI, may iterate
- **tickets-generated** — tickets exist in `tickets/open/`,
  implementation pending
- **building** — at least one ticket closed, more in progress
- **shipped** — all tickets closed, capability used on real work at
  least once, REFLECT section written, drift audit recorded

A doc in **shipped** state is historical record. Don't edit it for
style later. If you want to revise the capability, write a new
capability doc that references it.

## Anti-patterns to watch for

**The "while I'm in here" expansion.** Tickets that grow scope because
the AI notices related work. File a new ticket for the related work;
don't expand the current one. The capability doc's "Out of scope"
section is the forcing function.

**The drive-by abstraction.** A capability adds an abstraction that
"we'll need for the next thing." Don't. Add abstractions when the
third use case appears, not the first. Build the next capability
concretely; refactor when the pattern is real.

**Doc drift.** Capability ships, foundational docs don't get updated.
If `ARCHITECTURE.md` says one thing and the code does another, the
docs are lying to future AI sessions. Update them as part of the
capability that changed them, not "later."

**Skipping USE and REFLECT.** Shipping the code without running the
project against real work means you don't actually know if the
capability is good. The first time you'll find out is when the *next*
capability is built on top of a shaky one. Always exercise the
capability against real work before considering it shipped.

**Forcing the audit.** `--force` exists for emergencies and records
`verdict: forced`, never `pass`. A project whose audit history is a
column of `forced` has stopped auditing and kept the paperwork.

**Designing five capabilities ahead.** The temptation to spec out the
next five capabilities now is strong and almost always wrong. Each
capability's design should be informed by the previous one's reality.
The further ahead you plan, the more of the plan you'll throw away.

**Closing tickets without honest operator validation.** Tickets close
with a Resolution section AND an Operator validation section. If the
validation section is always "None," nobody is checking the work.
That's not validation; that's hope. The opposite failure is real too:
routing to the operator a check the agent could have run itself. The
operator's eyes are for perception — does it look right, does it read.
A status code, a database row or a CLI's output is the agent's smoke
test to run and record.

## Quick reference

- **Starting a new capability?** → `prompts/CAPABILITY_DESIGN.md`
- **Filling out a capability doc?** → `docs/capabilities/TEMPLATE.md`
- **Tickets ready to implement?** → `/tickets` (the skill at
  `.claude/skills/tickets/`), or `/tickets wave <NN>` to build a
  capability in parallel (`docs/capabilities/WAVES.md`)
- **Capability's tickets all closed?** → `/tickets audit <NN>`
  (`docs/capabilities/AUDIT.md`)
- **Need an architecture review?** → `prompts/ARCHITECTURE_REVIEW.md`
  in a fresh chat surface
- **Cleaning up after a multi-ticket buildout?** →
  `prompts/CONSOLIDATION_PASS.md`
- **Foundational decision being made?** → append an ADR to
  `docs/DECISIONS.md`
