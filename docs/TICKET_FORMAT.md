# Ticket Format Specification

> The exact format of a ticket markdown file, and why each part of it
> exists. The installed project carries a short extract of this file at
> `.claude/skills/tickets/reference.md`; the script
> `.claude/skills/tickets/scripts/tickets.mjs` enforces it. Tickets are
> created and moved by that script, not by hand — but they are plain
> markdown, and reading or editing their bodies needs nothing but an
> editor.

## File location and naming

Tickets live in two folders:

- `tickets/open/` — active tickets: status `open`, `blocked` or `deferred`
- `tickets/closed/` — resolved tickets (never deleted)

Files are named `NNNN-slug.md` where:

- `NNNN` is the ticket's id, zero-padded to four digits (`0001`, `0042`,
  `0137`). Ids are sequential and do not reset between open and closed.
- `slug` is a kebab-case identifier, immutable once assigned.
  Example: `0042-nmap-parser-drops-hostnames.md`.

When a ticket closes, the file is **moved** (`git mv`) from `open/` to
`closed/`. The filename does not change.

`tickets/index.json` is a generated index of every ticket's frontmatter,
rebuilt by the script on every change and committed. It is a convenience
for tools and for `git log`; the markdown files are the source of truth.

## Frontmatter

Flat YAML frontmatter: scalars and integer lists only. The script's
parser is deliberately not a YAML library — a real one would accept
nested structures the format does not allow, then silently reformat them
on write. Unknown keys are preserved, and warned about.

```yaml
---
id: 42
slug: nmap-parser-drops-hostnames
title: Nmap parser drops hostnames when no PTR record exists
type: bug
priority: high
status: open
size: m
capability: 04-recon-parsers
depends_on: [38]
blocked_by: []
source: operator
created: 2026-05-12T14:30:00Z
started: 2026-05-14T09:02:00Z
---
```

| Field | Required | Values / rules |
|---|---|---|
| `id` | yes | Integer, matching the filename prefix. **Allocated by the script only.** Displayed zero-padded. |
| `slug` | yes | `^[a-z0-9]+(-[a-z0-9]+)*$`, matching the filename. Immutable. |
| `title` | yes | Human-readable. May be edited for clarity; the slug never changes. |
| `type` | yes | `feature` · `bug` · `design` · `chore` · `refactor` · `docs` |
| `priority` | yes | `high` · `med` · `low` |
| `status` | yes | `open` · `blocked` · `deferred` · `closed` |
| `size` | yes | `s` · `m` · `l` |
| `capability` | yes | `NN-name` matching `docs/capabilities/NN-name.md`, or `null` |
| `depends_on` | yes | Ticket ids. Planned ordering. `[]` when none. |
| `blocked_by` | yes | Ticket ids. Discovered ordering. `[]` when none. Non-empty ⇔ `status: blocked`. |
| `source` | yes | `agent` · `operator` |
| `created` | yes | ISO 8601 UTC. Set once. |
| `started` | no | ISO 8601 UTC. Stamped by `start`. |
| `deferred` | iff `deferred` | ISO 8601 UTC. Stamped by `defer`, removed by `resume`. |
| `closed` | iff `closed` | ISO 8601 UTC. Stamped by `close`. |

### `type`

- `feature` — new operator-visible behaviour.
- `bug` — existing behaviour is wrong. Requires extra body sections.
- `design` — **the deliverable is a capability doc, not code.** This is
  how "we need to work out how scan scheduling interacts with rate
  limits" gets tracked as real work without pretending to be an
  implementation task. Its acceptance criteria read "a capability doc
  exists at `docs/capabilities/NN-x.md` with no open questions," never
  "the feature works."
- `chore` — maintenance with no behaviour change: dependency bumps, CI,
  key rotation.
- `refactor` — internal structure changes; behaviour identical, tests
  unchanged.
- `docs` — documentation only.

### `priority`

Three is enough. Five invites deliberation about whether something is P2
or P3, which is not work.

### `status`

The folder is the coarse state: `closed` lives in `closed/`; `open`,
`blocked` and `deferred` all live in `open/`.

There is deliberately no `in-progress` status. `start` stamps `started:`
instead, so an abandoned session leaves a timestamp rather than a stuck
state that has to be cleaned up.

**`blocked` vs `deferred`, in one sentence: `blocked` is waiting on a
ticket in this backlog; `deferred` is waiting on the world.** Closing the
blocking ticket clears a `blocked` automatically, and `blocked_by` names
it. Nothing in the backlog can clear a `deferred` — there is no ticket id
for "upstream ships the fix" — so if you find yourself wanting to file a
placeholder ticket so that `blocked_by` has something to hold, the state
you want is `deferred`.

`deferred` is for work that is **specified, correct, and unworkable
through no fault of its own.** Every other status lies about such a
ticket: `open` claims it is available and makes every future session
re-derive that it is not; `blocked` needs a ticket id there is no honest
candidate for; `closed` says the criteria are met when they are not.
Consequences, all of them the point:

- It is **not in the ready set**, but `next` still counts it aloud — a
  backlog that hides its deferrals makes "nothing is ready" and
  "everything is waiting on upstream" look identical.
- It is **excluded from its capability's audit** "all tickets closed"
  check, so one third-party defect cannot hold a capability — and through
  the audit gate, every capability after it. The audit record **names
  every deferred ticket it passed with.**
- It carries a **mandatory reason and a mandatory runnable re-check** in
  a `## Deferred` section. A deferral with no reason is indistinguishable
  from a ticket nobody got to; a deferral with no re-check is a wait with
  no end condition.

**Leaving `deferred` is never automatic.** `recheck` runs the re-checks
and *reports*; a human or agent reads the result and runs `resume`. A
ticket that silently un-defers is a ticket nobody looks at.

### `size`

A session-length estimate, not story points.

- `s` — under 30 minutes.
- `m` — 30 minutes to 2 hours. **The target.**
- `l` — **too big. Split it.** `next` refuses to start an `l` and the
  skill offers a split instead. `size: l` is a smell recorded honestly,
  not a valid plan.

### `source`

`agent` (filed by the AI mid-session, per "never expand a ticket's scope
— file a new ticket") or `operator` (filed by the human). Cheap, and it
tells you at a glance whether the backlog is being driven by the
operator's intent or by the build's discoveries.

### Why the structured fields earn their place

`capability`, `depends_on`, `blocked_by` and `size` all do the same
thing: **they move information out of prose the AI must re-infer every
session and into fields a script computes for free.**

Ordering work by "priority, then dependencies, then id" sounds simple.
But when dependencies live in `## Notes` prose ("Depends on ticket
#0006"), honouring them means reading every open ticket in full, every
session, and re-deriving the graph with an LLM. That is a context tax
paid at the start of every session; it gives a slightly different answer
each time; and it degrades silently as the backlog grows — fine at eight
open tickets, broken at sixty. As integer lists, the ready set is a
topological filter: milliseconds, deterministic, zero tokens.

The two dependency fields are kept apart on purpose:

- **`depends_on`** is a **planned** constraint, set at ticket-write time.
  "0042 needs the schema 0038 creates."
- **`blocked_by`** is a **discovered** constraint, set mid-session by
  `block`. "Found while implementing that this can't proceed until 0011
  lands."

Mixing them loses the ability to tell "we planned this order" from "we
hit a wall," which is exactly what the REFLECT step wants to know.

`capability` closes a one-directional link: capability docs list their
tickets, but without it a ticket has no cheap way back to its design
context — and the capability audit has no way to find every ticket a
capability owns.

`size` costs one character and turns "tickets should be small" from a
hope into something `next` enforces.

## Body sections

### Required for all tickets

```markdown
## Description

Plain prose describing the issue, feature, or refactor. Enough detail
that a future implementer who hasn't been in this conversation can
understand what's being asked. Cite the design sections it implements
by path and §.

## Acceptance criteria

- [ ] Specific, checkable item
- [ ] Another specific, checkable item
- [ ] (operator) A check only a human eye can make

## Notes

Free-form additional context. Links, references to other tickets,
design rationale, anything that doesn't fit in Description or
Acceptance.

## Operator validation

What will need verifying at close, and by whom. Rewritten at close
time with what was actually verified.
```

### Required for `bug` tickets, in addition

```markdown
## Steps to reproduce

1. Specific action
2. Another specific action

## Expected vs actual

**Expected:** what should happen.

**Actual:** what does happen.
```

### Required for `design` tickets, in addition

```markdown
## Options considered

## Open questions
```

### Required for `deferred` tickets, in addition

Written by `defer`, never by hand:

````markdown
## Deferred

**Reason:** Waiting on <third party> to <thing>, tracked at <link>.

```sh
<the cheap re-check: prints a one-line verdict, exits 0 when the wait is over>
```
````

`resume` renames the heading to `## Deferred — resumed YYYY-MM-DD` and
appends the result rather than deleting the section: what was waited on,
and why, is worth keeping.

### Added when closing a ticket

```markdown
## Resolution

Brief summary of what changed:
- Files touched
- Tests added or modified
- Any design decisions made and their rationale
- What went wrong along the way
- Links to commits, if applicable
```

…and the `## Operator validation` section is filled in with what was
actually verified (see below).

### `(operator)` criteria

An acceptance criterion prefixed `(operator)` is one **only a human can
check** — a human eye or hand is the only instrument that can answer it.
Not "the agent hasn't checked it": anything the agent can reach with its
tools and credentials, it checks itself.

```markdown
- [ ] (operator) The Host page shows the hostname in the Hostnames row
- [x] (operator) Hostname shows on a real HTB box — verified 2026-05-15: both names shown, no wrap
```

Ticking one requires the inline dated result. `close` refuses while one
is unchecked — leave the ticket open, commit the work, and close it in a
later session once the operator has looked — and refuses one ticked
without a sign-off. `validate` errors on the latter in every folder.

The marker exists because the cheapest way to make a close pass is to
tick a box nobody checked. A criterion ticked in advance by an AI, on the
reasonable-sounding belief that it would obviously work, is exactly how a
feature ships that never worked at all.

## Operator validation

`## Operator validation` is the contract between implementation and the
operator: the evidence that someone actually looked. It is
non-negotiable on every ticket, and it records verification **by
whoever could actually perform it**:

- **Perceptual checks go to the operator.** Name the screen and what to
  look at. The test: *would two competent people disagree about the
  answer by looking at it?* A layout a few pixels off, a chart that
  misleads, an error message that reads wrong — these pass every
  automated test. The check must be answerable by opening the project as
  it already is; never ask the operator to construct a scenario or
  re-verify something a test already proves.
- **Everything else is the agent's smoke test.** A status code, a
  database row, a CLI's output, a deployed service's behaviour: the agent
  runs it and writes down what it proved. Routing those to the operator
  spends the scarcest resource in the project on work a command could do.
- **"None" is permitted** for genuinely invisible work with nothing to
  poke — and even then, say why. If the validation section is always
  "None," nobody is checking the work. That's not validation; that's
  hope.

## Example: a feature ticket

```markdown
---
id: 7
slug: streaming-tool-output-via-websocket
title: Stream tool output to the UI via WebSocket
type: feature
priority: high
status: open
size: m
capability: 02-live-tool-runs
depends_on: [6]
blocked_by: []
source: agent
created: 2026-05-12T11:00:00Z
---

## Description

The Tool Run view should display tool output in real time as it streams,
not after the run completes (`docs/capabilities/02-live-tool-runs.md` §2).
Implement a WebSocket endpoint that pushes output lines from the executor
to connected clients.

## Acceptance criteria

- [ ] `GET /api/ws/runs/{run_id}` accepts WebSocket connections
- [ ] Each output line is pushed as a JSON event `{"type": "line", "data": "..."}`
- [ ] Status changes push `{"type": "status", "status": "...", "exit_code": ...}`
- [ ] Client reconnect within 5s replays buffered output for the run
- [ ] Tests cover: happy path streaming, mid-stream disconnect/reconnect,
      run completes while disconnected (replay on reconnect)
- [ ] (operator) Output in the Tool Run view scrolls smoothly during a
      long nmap run, with the pause-autoscroll toggle working

## Notes

The executor already writes per-run logs to disk. The WS path can replay
from those logs on reconnect rather than maintaining an in-memory ring
buffer.

## Operator validation

Agent: smoke-test the endpoint against a running dev server with a
scripted client. Operator: watch a long run stream in the Tool Run view.
```

Note what is *not* in the Notes: "Depends on ticket #0006." That is
`depends_on: [6]`, where the script can read it.

## Example: a bug ticket (after closing)

```markdown
---
id: 42
slug: nmap-parser-drops-hostnames
title: Nmap parser drops hostnames when no PTR record exists
type: bug
priority: high
status: closed
size: s
capability: 04-recon-parsers
depends_on: []
blocked_by: []
source: operator
created: 2026-05-12T14:30:00Z
started: 2026-05-15T08:50:00Z
closed: 2026-05-15T09:45:00Z
---

## Description

When nmap returns XML for a host with no reverse DNS, the parser
silently drops the user-supplied hostname. The Host page then shows
only the IP and loses the original target name the operator added.

## Acceptance criteria

- [x] Parser preserves the input hostname from the nmap target when no
      PTR record exists
- [x] Existing tests still pass
- [x] New test covers the no-PTR case using a fixture XML
- [x] (operator) Hostname appears on the Host page for a box added by
      name — verified 2026-05-15: shows example.htb, no layout change

## Notes

The fixture `tests/parsers/fixtures/nmap_no_ptr.xml` was added during
investigation; reuse it.

## Steps to reproduce

1. Add an in-scope target by hostname: `add-target example.htb`
2. Run `nyarl/initial-recon` against `example.htb`
3. Observe the resulting Host row in the database

## Expected vs actual

**Expected:** Host has `primary_address=<IP>` and `hostnames=["example.htb"]`.

**Actual:** Host has `primary_address=<IP>` and `hostnames=[]`.

## Resolution

Updated `backend/cyclopean/parsers/nmap_xml.py` to fall back to the
nmap `<address>` element's `addrtype="user"` entry when no PTR is
present. Added `test_parses_hostname_when_no_ptr` in
`tests/parsers/test_nmap_xml.py`. Fixture committed as
`tests/parsers/fixtures/nmap_no_ptr.xml`. First attempt read the
hostname from `<hostnames>`, which is empty in exactly this case; the
fixture caught it.

## Operator validation

Agent smoke test: ran `nyarl/initial-recon` against a lab box added by
hostname and against an internal IP with a PTR record; the database
rows had `hostnames=["example.htb"]` and the PTR name respectively.
Operator: confirmed the Host page rendering (see the criterion above).
```

## Why this format

A few things in the format aren't obvious:

**Frontmatter, not headers.** The `id`, `type`, `priority`, `status` and
dependency fields are structured data, not prose. In frontmatter they are
trivial to parse, filter, and index — which is what lets a script do the
ordering instead of an LLM re-reading every ticket.

**Slug is immutable.** The slug becomes part of the filename and
shouldn't change because the filename is referenced by humans (in
commits, in conversations, in other tickets). Letting the title evolve
without breaking references is the value.

**Acceptance criteria as checkboxes.** The criteria are explicitly
checkable, and the script refuses to close a ticket with one unchecked.
Vague criteria ("the feature works") produce vague implementations.

**Resolution and Operator validation are filled in on close, not in
advance.** The implementer writes these based on what they actually
did, not what was originally planned. This is the honest record.

**Closed tickets are never deleted.** Closed tickets are history. They
explain why the code is the way it is, what was tried, what failed,
what was decided. The `closed/` directory is one of the most valuable
artifacts the project produces.

## Numbering and concurrency

Ids come from exactly one place: the script, which takes the highest id
in `open/` and `closed/` and adds one. Nothing else allocates — not a
human, not the AI by hand, and not a parallel build agent. In a wave
(`docs/capabilities/WAVES.md`), agents *propose* new tickets in their
reports and the orchestrating session creates them, so parallel work
never races for a number.

For multi-operator work on separate branches (not the kit's primary use
case), two branches can still allocate the same id. Resolve it in the
merge by renumbering the later ticket, then run `validate`.

## Validation

`tickets.mjs validate` checks every ticket and exits non-zero on any
error. The full list of errors and warnings is in
`.claude/skills/tickets/reference.md` ("Validation rules"); the
categories are:

- **Frontmatter**: parses, has every required field, uses only legal
  enum values, and agrees with the filename.
- **State**: status agrees with the folder; `blocked_by` agrees with
  `blocked`; the `deferred:` and `closed:` stamps agree with their
  statuses.
- **Graph**: no dangling ids, no self-edges, no cycles.
- **Body**: every required section for the ticket's type and state is
  present exactly once; a closed ticket has a Resolution and no
  unchecked criterion; an `(operator)` criterion is never ticked without
  a dated result; a deferred ticket has its reason and re-check.
- **Links**: a ticket's `capability` names a capability doc that exists.

Warnings — a `feature` with no capability, a `size: l` ticket in the
ready set, an unknown frontmatter key — exit 0. They are smells, not
errors.
