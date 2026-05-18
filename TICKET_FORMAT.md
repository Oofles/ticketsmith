# Ticket Format Specification

> The exact format of a ticket markdown file. Read this if you're writing
> tickets by hand or curious about why the format is the way it is.

## File location and naming

Tickets live in two folders:

- `tickets/open/` — active tickets
- `tickets/closed/` — resolved tickets (never deleted)

Files are named `NNNN-slug.md` where:

- `NNNN` is a four-digit sequential number, zero-padded (`0001`, `0042`,
  `0137`). Numbers do not reset between open and closed.
- `slug` is a kebab-case version of the title, immutable once assigned.
  Example: `0042-nmap-parser-drops-hostnames.md`.

When closing a ticket, the file is **moved** from `open/` to `closed/`. The
filename does not change.

## Frontmatter

YAML frontmatter at the top of each ticket. All fields except `closed`
are required.

```yaml
---
id: 0042
slug: nmap-parser-drops-hostnames
title: Nmap parser drops hostnames when no PTR record exists
type: bug
priority: high
status: open
created: 2026-05-12T14:30:00Z
closed: 2026-05-15T09:45:00Z
---
```

Field definitions:

- `id` — the four-digit ticket number, matching the filename prefix. Integer
  in YAML, but always displayed and referenced as zero-padded.
- `slug` — kebab-case identifier, matching the filename slug. Immutable.
- `title` — human-readable title. May be edited if it improves clarity, but
  the slug never changes.
- `type` — one of `bug`, `feature`, `refactor`, `docs`, `chore`.
- `priority` — one of `low`, `med`, `high`.
- `status` — one of `open`, `closed`. Mirrors which folder the file is in.
- `created` — ISO 8601 timestamp, UTC.
- `closed` — ISO 8601 timestamp, UTC. Omitted on open tickets.

## Body sections

The body of a ticket has a fixed set of sections. Not all sections apply
to all ticket types — see the per-type guidance below.

### Required for all tickets

```markdown
## Description

Plain prose describing the issue, feature, or refactor. Enough detail
that a future implementer who hasn't been in this conversation can
understand what's being asked.

## Acceptance criteria

- [ ] Specific, checkable item
- [ ] Another specific, checkable item
- [ ] ...

## Notes

Free-form additional context. Links to related runs, screenshots,
references to other tickets, design rationale, anything that doesn't
fit in Description or Acceptance.
```

### Required for `bug` tickets, in addition

```markdown
## Steps to reproduce

1. Specific action
2. Another specific action
3. ...

## Expected vs actual

**Expected:** what should happen.

**Actual:** what does happen.
```

### Added when closing a ticket

When a ticket is closed, the implementer appends two sections at the
bottom:

```markdown
## Resolution

Brief summary of what changed:
- Files touched
- Tests added or modified
- Any design decisions made and their rationale
- Links to commits, if applicable

## Operator validation

Things the human operator should manually verify before considering
this ticket truly done. Each item should be specific and concrete.

- [ ] Open the UI at /some/path and verify X renders correctly
- [ ] Run `command --flag` and confirm output matches expectation
- [ ] ...

If no manual validation is needed, write "None" — but be honest: if
there's a UI change, screenshot it; if there's a CLI change, run it;
if there's an integration with external state, verify the state.
```

The **Operator validation** section is the contract between
implementation and the operator. It exists so the operator can review a
session's work and validate it *before* `/clear`-ing and starting the
next session. Items here should be small and concrete, not "make sure
everything works."

## Example: a feature ticket

```markdown
---
id: 0007
slug: streaming-tool-output-via-websocket
title: Stream tool output to the UI via WebSocket
type: feature
priority: high
status: open
created: 2026-05-12T11:00:00Z
---

## Description

The Tool Run view should display tool output in real time as it streams,
not after the run completes. Implement a WebSocket endpoint that pushes
output lines from the executor to connected clients.

## Acceptance criteria

- [ ] `GET /api/ws/runs/{run_id}` accepts WebSocket connections
- [ ] Each output line is pushed as a JSON event `{"type": "line", "data": "..."}`
- [ ] Status changes push `{"type": "status", "status": "...", "exit_code": ...}`
- [ ] Client reconnect within 5s replays buffered output for the run
- [ ] Frontend `ToolRunStream` component connects, renders lines, and
      auto-scrolls (with a pause-autoscroll toggle)
- [ ] Tests cover: happy path streaming, mid-stream disconnect/reconnect,
      run completes while disconnected (replay on reconnect)

## Notes

The executor already writes per-run logs to disk. The WS path can replay
from those logs on reconnect rather than maintaining an in-memory ring
buffer.

Depends on ticket #0006 (tool registry and executor).
```

## Example: a bug ticket (after closing)

```markdown
---
id: 0042
slug: nmap-parser-drops-hostnames
title: Nmap parser drops hostnames when no PTR record exists
type: bug
priority: high
status: closed
created: 2026-05-12T14:30:00Z
closed: 2026-05-15T09:45:00Z
---

## Description

When nmap returns XML for a host with no reverse DNS, the parser
silently drops the user-supplied hostname. The Host page then shows
only the IP and loses the original target name the operator added.

## Steps to reproduce

1. Add an in-scope target by hostname: `add-target example.htb`
2. Run `nyarl/initial-recon` against `example.htb`
3. Observe the resulting Host row in the database

## Expected vs actual

**Expected:** Host has `primary_address=<IP>` and `hostnames=["example.htb"]`.

**Actual:** Host has `primary_address=<IP>` and `hostnames=[]`.

## Acceptance criteria

- [ ] Parser preserves the input hostname from the nmap target when no
      PTR record exists
- [ ] Existing tests still pass
- [ ] New test covers the no-PTR case using a fixture XML

## Notes

The fixture `tests/parsers/fixtures/nmap_no_ptr.xml` was added during
investigation; reuse it.

## Resolution

Updated `backend/cyclopean/parsers/nmap_xml.py` to fall back to the
nmap `<address>` element's `addrtype="user"` entry when no PTR is
present. Added `test_parses_hostname_when_no_ptr` in
`tests/parsers/test_nmap_xml.py`. Fixture committed as
`tests/parsers/fixtures/nmap_no_ptr.xml`.

## Operator validation

- [ ] Run `nyarl/initial-recon` against any HTB box added by hostname
      (not IP), then check the Host page — the hostname should appear
      in the Hostnames row.
- [ ] No regression in normal-DNS case; verify by running against an
      internal IP with PTR.
```

## Why this format

A few things in the format aren't obvious:

**Frontmatter, not headers.** The `id`, `type`, `priority`, `status`
fields are structured data, not prose. Putting them in frontmatter makes
them trivial to parse, filter, and index — without committing to any
specific tool to do that parsing.

**Slug is immutable.** The slug becomes part of the filename and
shouldn't change because the filename is referenced by humans (in
commits, in conversations, in other tickets). Letting the title evolve
without breaking references is the value.

**Acceptance criteria as checkboxes.** The criteria are explicitly
checkable. When the implementer is closing a ticket, they should be
able to look at the criteria and verify each one. Vague criteria
("the feature works") produce vague implementations.

**Resolution and Operator validation are added on close, not in
advance.** The implementer fills these in based on what they actually
did, not what was originally planned. This is the honest record.

**Closed tickets are never deleted.** Closed tickets are history. They
explain why the code is the way it is, what was tried, what failed,
what was decided. The `closed/` directory is one of the most valuable
artifacts the project produces.

## Numbering and concurrency

Ticket numbers are sequential integers. When a new ticket is created:

1. Read the filenames in both `tickets/open/` and `tickets/closed/`
2. Extract the numeric prefixes
3. Find the maximum
4. Add 1

For single-operator projects this is straightforward. For multi-operator
work (not the kit's primary use case), branches will sometimes assign
the same number; resolve in the merge by renaming the later one.

## Validation

The format is intentionally simple enough that a script could validate
it, but the kit ships no validator. The `/tickets` command checks for
format compliance when it reads a ticket; if frontmatter is malformed,
it surfaces the issue and asks the operator to fix it before continuing.
