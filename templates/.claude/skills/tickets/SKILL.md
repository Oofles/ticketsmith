---
name: tickets
description: >
  Manage and implement this project's tickets. Subcommands: list, show, next, waves, wave,
  create, start, block, unblock, defer, resume, recheck, close, validate, sync, audit.
  Bare /tickets works the backlog in priority order.
argument-hint: "[list|show|next|waves|wave|create|start|block|unblock|defer|resume|recheck|close|validate|sync|audit] [id|capability]"
arguments: [action, id]
allowed-tools: "Bash(node ${CLAUDE_PROJECT_DIR}/.claude/skills/tickets/scripts/tickets.mjs *), Bash(git *), Read, Edit, Write, Grep, Glob"
disable-model-invocation: true
---

# /tickets

`$1` is the action, `$2` is usually a ticket id or a capability. Everything after them is in
`$ARGUMENTS` and is passed through **verbatim** — never re-interpret a quoted reason or a filter
flag.

**The split that governs every branch below:** the script does everything MECHANICAL — parsing,
id allocation, dependency resolution, file moves, validation, the close preconditions. You do
everything JUDGEMENTAL — what a ticket means, whether the work is genuinely done, what to write in
`## Resolution`, which questions to ask. **Never re-derive by reading what the script can tell you
by running.** Reading every ticket body to work out an order is the exact tax this system exists
to remove.

`SCRIPT` below means `node ${CLAUDE_PROJECT_DIR}/.claude/skills/tickets/scripts/tickets.mjs`.
The ticket format and the full close procedure are in
`${CLAUDE_PROJECT_DIR}/.claude/skills/tickets/reference.md`.

## Routing

Dispatch on `$1`. **Every branch's first action is a `SCRIPT` call** — there is no native
subcommand dispatch, so this table is the dispatch.

| `$1` | First action | Then |
|---|---|---|
| *(empty)* | `SCRIPT index`, `SCRIPT validate`, then `SCRIPT next --all --json` | The default loop, below |
| `list` | `SCRIPT list $ARGUMENTS` | Print the table. Nothing else. |
| `show` | `SCRIPT show $2` | Add the capability doc link; read the body only if asked to explain it |
| `next` | `SCRIPT next --json` | Summarize, propose an approach, **wait for a go** |
| `waves` | `SCRIPT waves [$2] [--max N]` | Propose wave 1, **wait for a go**, then follow `docs/capabilities/WAVES.md` |
| `wave` | `SCRIPT waves $2` | **The invocation is the go.** Run the next ready wave end to end. See `## wave` below |
| `create` | `SCRIPT create --title "…" --type … --priority …` | Confirm the path it printed, then write the body sections |
| `start` | `SCRIPT start $2` | Then work it |
| `block` | `SCRIPT block $2 --on <id> --reason "…"` | Report; **never close a blocked ticket** |
| `unblock` | `SCRIPT unblock $2 --on <id>` | Report the resulting status |
| `defer` | `SCRIPT defer $2 --reason "…" --recheck "<shell>"` | For a wait on something **outside** the project. See `## defer` below |
| `resume` | `SCRIPT resume $2 [--reason "…"]` | Report that it is back in the ready set |
| `recheck` | `SCRIPT recheck [$2]` | Report each verdict. **Never `resume` on the strength of it without saying so first** |
| `close` | **Read `reference.md` first**, then the close procedure | See below |
| `validate` | `SCRIPT validate` | Report errors verbatim; fix or file, do not silence |
| `sync` | `git pull --rebase` (if the project has a remote), then `SCRIPT index`, `SCRIPT validate`, `SCRIPT recheck` | Report validation errors and any deferred re-check that now passes |
| `audit` | `SCRIPT audit $2` | The audit procedure, below. **A green table is not a passed audit** |
| anything else | `SCRIPT` (prints usage) | Say which actions exist |

## `next`

`SCRIPT next --json` picks the ticket — highest priority in the ready set, ties by lowest id. Do not
second-guess it; if it picked something surprising, `SCRIPT show <id>` explains why.

If it refuses because every ready ticket is **gated on an unaudited capability**, that is the
capability-close audit working: do what it says. **If it lists tickets still open in the blocking
capability, the audit cannot pass yet — work or unblock those, and do not propose the audit.** A
capability's planned tickets run out long before the tickets its build generates do, so the audit
is easy to propose too early. Only when `next` names the audit commands is the audit next (see
`## audit` below). Do not route around the gate by starting a ticket by hand — it exists because
the audit is skipped exactly when it matters most.

Then: summarize the ticket in two or three sentences, **state the approach you intend to take**, and
**wait for a go before touching anything.** This is the operator's cheapest chance to redirect.

If the script refuses because the ticket is `size: l`, do not work around it. Offer a concrete split
into two or three tickets with proposed titles, and create them with `SCRIPT create` once agreed.
`size: l` is a smell recorded honestly, not a valid plan.

## `wave`

`/tickets wave 3` means *run capability 3's next ready wave*. `$2` may be the bare number or the
full slug; the script resolves it. With no `$2`, it means the capability `next` would pick. Typing
the command **is** the operator's go for that wave, so there is no propose-and-wait step. Every
other stop in `docs/capabilities/WAVES.md` still applies.

**Read `docs/capabilities/WAVES.md` first, every time.** It is the procedure, and this section only
says where it may and may not stop.

1. **Plan.** `SCRIPT waves $2`. Wave 1 of the output is the wave to run, because earlier waves have
   already merged and closed. If it prints `GATED`, or nothing is open, stop and say what
   `next`/`audit` says instead.
2. **Look for undeclared coupling before spawning.** Read each wave ticket's Description and Notes,
   not the design docs. Look for one ticket saying it *follows*, *builds from*, or *waits on*
   another in the same wave, without a `depends_on` that says so. This is the one check the script
   cannot make. On a hit, **stop and ask**: offer to add the dependency, which moves the ticket to
   a later wave.
3. **At a capability's first wave,** read `docs/DECISIONS.md` in full (WAVES §2). In later waves,
   read only the decisions the wave's tickets cite.
4. **Start, commit, spawn** (WAVES §2). Use the WAVES §6 prompt verbatim, plus an orchestrator
   note per ticket naming any decision it must build from that its text predates.
5. **Merge and gate** (WAVES §4). Before closing, check each agent ticked its criteria
   (`grep '^- \[ \]'`). An unticked box is checked against the code by you, never ticked on trust.
6. **Stop and hand over** when any of these happens: an agent returns an open question (relay it,
   then send the answer back to that agent); a decision only the operator can make; a red gate you
   cannot fix mechanically; and, always, **the wave's perceptual checks**, in one batch. Close the
   tickets after the operator answers. Tickets with no perceptual checks close as soon as their
   smoke tests pass.
7. **End** with the next wave's contents and the context used. Do not roll into the next wave
   without a new `/tickets wave`: one wave per invocation, so each one costs the operator one word.

## `defer`

For work that is **specified, correct, and waiting on something outside the project** — an upstream
bug, a third party's release. Not `blocked`: `blocked_by` holds ticket ids, and a placeholder ticket
filed so that `blocked_by` has something to hold is the dishonesty this status removes.

Both `--reason` and `--recheck` are mandatory and the script refuses without them. The re-check is
**runnable shell** — the cheap two-minute version of the ticket, not the ticket. Write one that
prints a one-line verdict on both paths, because its last line is what `recheck` reports.

`SCRIPT recheck` runs them and **reports**. It never un-defers, and neither do you silently: if a
re-check passes, say so and let the operator decide, then `SCRIPT resume`. A ticket that returns to
the backlog without anyone reading why is the failure this status was invented to prevent.

Run `SCRIPT recheck` as part of `sync`, and report any that now pass.

## `close`

**Read `.claude/skills/tickets/reference.md` before closing anything.** It carries the full
procedure and the format spec.

Refuse first, then act:

1. **Verify every acceptance criterion is genuinely met.** The script refuses on any unchecked box,
   and there is no `--force`. **Do not tick a box on the ticket's behalf to make the close pass.**
   If a criterion turned out to be wrong or unbuildable, say so in `## Resolution`, amend the
   criterion, and explain why — that is a finding worth recording, not an obstacle to route around.
   **A criterion prefixed `(operator)` is one only a human can check, and is never yours to tick.**
   Unchecked, it means the ticket does not close today: leave it open, commit the work, and close it
   in a later session once the operator reports what they saw — recorded on the criterion itself as
   `— verified YYYY-MM-DD: <result>`. Amending it away is the same failure as ticking it.
2. Append `## Resolution` — files touched, tests added, decisions and their rationale. **The honest
   record of what happened, not what was planned.** Include what went wrong; a Resolution that reads
   as though everything worked first time is a Resolution nobody will trust later.
3. Fill `## Operator validation` — evidence of verification, **by whoever could actually perform
   it.** Perceptual work (does it look right, does it read, does it feel right) names **a screen
   and what to look at**, for the operator. Everything you can reach with the tools and credentials
   you have — a running service, a status code, a database row, a CLI's output — **you verify
   yourself with a smoke test** and write down what it proved; do not route that to the operator.
   "None" is permitted only for genuinely invisible work with nothing to poke, and even then say
   why. A close with neither an operator check nor a smoke test is the failure this section exists
   to prevent.
4. If a real architectural decision was made, append an ADR to `docs/DECISIONS.md`.
   **Never edit an existing decision to make a ticket easier.** Supersede it explicitly, with the
   reasoning, so the change is visible.
5. `SCRIPT close <id>` — sets status, stamps `closed:`, `git mv`s, regenerates the index.
   It refuses on a dirty tree; commit unrelated work first rather than reaching for `--allow-dirty`.
6. **Commit on its own**: `tickets(#NNNN): <title>`.
7. The script reports which tickets just became ready. **Say so** — that is the handoff to the next
   session.

## `audit`

`docs/capabilities/AUDIT.md`'s split, same as everywhere else: the script runs what can be run,
**you do §2 and §3**, and the script refuses to record a result until you have.

1. `SCRIPT audit <capability>` — the mechanical half. Report the table verbatim. Read every `n/a`
   reason and say whether you believe it; an `n/a` you cannot justify is a finding, not a row.
2. `SCRIPT audit <capability> --sections` — the reading list. **Re-read each section listed** and,
   for each, name every place the implementation differs from it. This is the part that catches
   drift and the part no script can do.
3. **§3** — check every closed ticket in the capability has a real `## Operator validation` result,
   not a restatement of the instruction and not "None" where the ticket was operator-visible. Check
   the USE step happened: the capability was **exercised against real work through the real path**,
   not merely unit-tested. If it did not happen, say so and stop.
4. **Resolve each divergence, explicitly.** `code-was-wrong` → file a ticket (`SCRIPT create …
   --source agent`). `design-was-wrong` → amend the doc **now** and record an ADR in
   `docs/DECISIONS.md`. There is no third option; "we'll remember" is the drift.
5. **§6** — write the REFLECT section in `docs/capabilities/NN-name.md` before recording. The script
   checks it has substance, not just a heading — every capability doc ships with the heading already
   there.
6. Record it:
   ```
   SCRIPT audit <capability> --record \
     --divergence "design-was-wrong|ADR-12|§3 assumed one writer per table" \
     --divergence "code-was-wrong|0127|create could not derive a valid slug"
   ```
   or, if there genuinely were none, `--record --no-divergences`. **Omitting the assertion is
   refused** — a §2 that found nothing and a §2 that never happened must not look the same.
7. More than three divergences fails the audit and means **the design is stale, not the code**. Run
   a DESIGN session on the affected doc rather than arguing the budget.

**`--force "<reason>"`** overrides a failing audit and records the override, with its reason, in the
capability doc. It records `verdict: forced`, never `pass`. Use it for a genuine emergency and say
in the session summary that it was used.

## Bare `/tickets` — the default loop

1. **Orient.** `CLAUDE.md` → `docs/ARCHITECTURE.md` → `docs/DECISIONS.md` →
   `docs/capabilities/WORKFLOW.md`. If any is missing or visibly stale, **raise it before starting
   work.** The docs are the project's memory; if they are absent or wrong, the work will be too.
2. **Sync.** `SCRIPT index`, `SCRIPT validate`, `SCRIPT recheck`. Report validation errors before
   anything else.
3. **Order.** `SCRIPT next --all --json`. **State the proposed order and your reasoning aloud, then
   wait for confirmation.**
4. **Work tickets**, one at a time: `SCRIPT start <id>`, then understand → clarify → propose →
   build → close.
   - **Understand.** Read the ticket, then the design-doc sections it cites — not whole docs. Locate
     and skim the relevant code.
   - **Clarify: STOP and ask EVERYTHING AT ONCE**, before writing any code, when the acceptance
     criteria are ambiguous or contradict the architecture docs; the change touches a public
     interface whose impact is not fully specified; there is a design decision with several
     reasonable answers; you would need a dependency not already in the project's manifest; or you
     would need to violate a constraint in `CLAUDE.md`. Questions dribbled out one at a time cost
     far more than one round up front. You may continue other tickets that need no clarification
     while waiting.
   - **Propose** before implementing when the solution involves choices the ticket did not pin
     down — several plausible architectures, a new abstraction, a change to shared infrastructure.
     For mechanical changes, just do it; do not manufacture a proposal step.
   - **Build.** Follow existing patterns. Write tests for new logic where the project has a test
     convention, and run them.
   - **Close** per `## close` above.
5. **Stop** on any of: backlog empty · **~60% context used** (finish the current ticket cleanly,
   then stop) · blocked with nothing ready · a test failure revealing a deeper problem (file a
   ticket, stop) · operator interrupt.
6. **Session summary**, in this fixed format:
   - Tickets closed — `NNNN: <title> — <one-line resolution>`
   - Tickets in progress — and what is stopping each
   - New tickets filed — and why
   - **★ OPERATOR VALIDATION REQUIRED ★** — the consolidated checklist across every ticket worked
     this session, including every unchecked `(operator)` criterion holding a ticket open. This is
     the most important part of the summary: it is what the operator checks before the next
     session.
   - Recommended next session

## Standing rules

- **Never expand a ticket's scope.** Discovered work becomes a new ticket via
  `SCRIPT create … --source agent`. A ticket that grows while being worked cannot be estimated,
  reviewed, or honestly closed.
- **Never edit a settled decision to make a ticket easier.** Supersede it visibly instead.
- **Never modify foundational docs to make a ticket easier.** Either the ticket conforms to the
  architecture, or the architecture changes deliberately — itself a ticket, with operator buy-in.
- **Never hand-edit ticket frontmatter** when a `SCRIPT` command exists for it — the script
  maintains `tickets/index.json`, enforces preconditions, and `git mv`s so history follows the file.
  Never hand-number a ticket: there is exactly one id allocator, and it is the script.
- **Never delete a ticket.** `tickets/closed/` is history.
- **Ask when the plan does not cover it.** If acceptance criteria do not settle a question, or the
  design turns out to be wrong, stop and ask. A wrong design doc is a finding, not an obstacle.
- **A capability closes with its drift audit** (`docs/capabilities/AUDIT.md`) before the next one
  starts.
- **Never silently overwrite the operator's uncommitted changes**, never commit secrets, and never
  run anything destructive outside the project repository.
- **Honest records beat impressive ones.** If something did not work as expected, or a decision was
  made on a hunch, write that. The closed ticket is the truth about what happened.
