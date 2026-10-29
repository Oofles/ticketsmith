# Waves — building a capability's tickets in parallel

One agent per ticket, each in its own git worktree, a wave at a time. The main session
orchestrates: it plans, merges, runs the project's gate **once per wave**, runs the smoke tests,
and brings the operator one batch of perceptual checks. Expensive per-integration costs (a full
test suite, a CI run, a deploy) are paid per wave, not per ticket, and each ticket gets a fresh
context that holds only its own ticket and the design sections it cites.

Everything in `CLAUDE.md` and the `/tickets` standing rules still holds. Ask before implementing
what the plan does not cover; operator validation is for perception only; the project's hard
constraints bind every agent exactly as they bind the main session.

A wave of one is the serial protocol, so nothing is lost by using waves everywhere.

---

## 1. Plan

```
node .claude/skills/tickets/scripts/tickets.mjs waves              # the capability next would pick
node .claude/skills/tickets/scripts/tickets.mjs waves <cap> --max 3
```

Wave 1 is ready now. Wave *k* becomes ready once waves 1..*k*-1 have merged. `held` says why a
ticket cannot be scheduled. Width defaults to 4, because merge cost grows with width: tickets in
one capability touch the same files. Lower it with `--max` for a capability whose tickets all edit
one module. Waves fill greedily: each takes up to the width of the tickets whose in-capability
`depends_on` are all in earlier waves, highest priority first, then lowest id. A ticket unblocked
by wave 1 is in wave 2, not queued behind the rest of its topological layer. The flip side: a
ticket that should run last (a sweep, a docs pass) runs as soon as its *declared* deps allow, so
declare them.

**Propose the wave to the operator and wait for a yes**, as for any session's batch. The exception
is **`/tickets wave <n>`**: typing it is the yes for that capability's next ready wave, and the
skill runs this whole procedure from it.

**Before spawning, read each ticket's Description and Notes for a dependency on another ticket in
the same wave that `depends_on` does not declare** — one ticket says it "follows" or "builds from"
another. The script layers only what is declared. Two tickets in one wave where the second builds
from a section the first is rewriting is the classic miss. On a hit, add the `depends_on` (after
the operator agrees) and re-plan.

## 2. Before spawning

1. The main checkout is clean, and level with its upstream if it has one.
2. At a capability's first wave, the orchestrator reads `docs/DECISIONS.md` in full. Agents do not.
3. `tickets.mjs start <id>` for every ticket in the wave, then **commit** those ticket changes.
   **Agents branch from HEAD at spawn time**, so anything they need must be committed first.
4. Spawn one agent per ticket, **all in one message**, each in its own git worktree (in Claude
   Code, the Agent tool with `isolation: "worktree"`), with the prompt in §6. Make sure worktrees
   are gitignored and excluded from the project's test and typecheck globs.

## 3. What an agent may and may not touch

Each agent works **only its own ticket**. Shared, append-only and generated files are the
orchestrator's, because parallel edits to them always conflict:

| An agent must not | Instead |
|---|---|
| edit `docs/DECISIONS.md` or number an ADR | propose it in the report as `ADR-NEW-a` |
| run `tickets.mjs create`, `start` or `close`, or allocate an id | propose new tickets in the report |
| edit `tickets/index.json` | leave it stale; the orchestrator regenerates it |
| edit any other ticket's file | mention it in the report |
| push, or touch any remote | commit locally on its worktree branch |
| change shared external state (deployed services, databases, cloud resources) | read-only; post-merge checks go in the report |
| ask the operator anything directly | stop and return the question |

An agent **may** edit design docs its ticket requires, under the usual rule: a wrong doc is a
finding. Say so in the report.

## 4. Merge, gate, validate (orchestrator)

1. **Read the reports, not the diffs.** `git show --stat <sha>` is enough unless something is off.
   A report with an open question waits: put it to the operator, then send the answer to that
   agent, which still holds its context.
2. **Cherry-pick each agent's commit onto the main branch**, in the wave's printed order. History
   stays linear, one commit per ticket. On a conflict, resolve it if it is mechanical. Otherwise,
   ask the agent to rebase onto the new main branch in its worktree and report the new sha.
3. **Do the shared-file work in one commit:** proposed `ADR-NEW` entries become real ADRs (fix the
   references in the merged commits' text), proposed tickets are created, and `tickets.mjs index`
   is run. Message: `wave <n>: decisions and indexes`.
4. **Run the full gate on the main branch** (§7), on a clean tree.
5. **Integrate once** — push, deploy, whatever this project does after the gate — so its cost is
   paid once per wave.
6. **When it is green, run every ticket's smoke tests.** Either run the reported commands, or ask
   each agent to run its own; they still hold the context. Then bring the operator **all** the
   wave's perceptual checks in one sitting.
7. **Close each ticket** (`tickets.mjs close`) with its `## Operator validation`, one commit each.
8. **Clean up.** Remove each agent worktree and delete its branch. These branches are local and
   short-lived, and are never pushed.

**If the gate or the integration fails,** fix it on the main branch in the main session, or ask the
agent whose change broke it.

## 5. Context

The orchestrator holds plans, reports and decisions, never an agent's file reads. Clear between
waves when context passes ~50%. The handoff is the same as ever: each ticket's `## Resolution`,
plus this file.

## 6. The agent prompt

Fill in the `<…>`s. Keep the rest verbatim: it is the contract in §3.

```
You are building ticket <NNNN> of this project, in your own git worktree, as one of several agents
working a wave in parallel. CLAUDE.md is loaded; its constraints bind you.
docs/capabilities/WAVES.md §3 lists what you must not touch. Read it first.

Ticket: tickets/open/<NNNN-slug>.md. Read it in full, then ONLY the design sections it cites.
Never read a design doc end to end.

Rules:
- If the acceptance criteria do not settle a question, or the design looks wrong, STOP and return
  the question with the options you see. Do not choose and proceed. The orchestrator will relay
  the answer.
- Do not edit docs/DECISIONS.md, tickets/index.json or any other ticket. Do not run
  tickets.mjs create/start/close. Do not push. Shared external state is read-only for you.
- Before committing, the gate in docs/capabilities/WAVES.md §7 must pass in your worktree.
- Tick each acceptance criterion you have actually satisfied (`- [x]`), and amend in place, with a
  reason, any you could not. Leave `(operator)` criteria unticked.
- Append a full `## Resolution` to your ticket (files touched, decisions made, why). Leave the
  ticket in tickets/open with its status as it is; the orchestrator closes it.
- Make exactly ONE commit containing the code and the ticket file: `<NNNN>: <ticket title>`.

Report, in this order and nothing else:
1. Commit sha and branch.
2. Files touched (one line each).
3. Verification: each gate check and its result.
4. Proposed decisions: ADR-NEW-a, ADR-NEW-b… with one paragraph each, or "none".
5. Proposed new tickets: title, type, priority, one-line why, or "none".
6. Smoke test: the exact commands to run after integration.
7. Perceptual checks for the operator (would two competent people disagree by looking?), or
   "none".
8. Open questions, or "none".
```

## 7. The gate

<!--
INSTALLER NOTE: list the commands every agent runs in its worktree before committing, and the
orchestrator runs on the main branch before integrating. Usually the same commands as the
`audit-checks` block in AUDIT.md §1 — the full test suite, typecheck, lint, build. Include any
one-time worktree setup (dependency install, generated files) the project needs, since a fresh
worktree has none of it. If integration means something specific here (a push that triggers CI, a
deploy), say what in §4 step 5's terms. Never invent a command the project does not have. Remove
this comment block once filled in.
-->

Setup, once per worktree:

```
<worktree setup, or "none">
```

Gate:

```
<test command>
<typecheck / lint / build, as the project has them>
```
