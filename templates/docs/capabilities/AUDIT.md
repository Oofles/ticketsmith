# Capability close audit

**A capability is not done when its tickets are closed. It is done when this audit passes.**

Run it as the REFLECT step, before starting the next capability. It takes 20–40 minutes and it is
the only thing standing between a long build and architectural drift.

> **The governing rule:** if the implementation diverged from the design doc, **either the code
> changes or the doc changes — never neither.** Silent divergence *is* the drift. Every finding
> below resolves one way or the other, and nothing is left as "we'll remember."

The audit is driven by `/tickets audit <capability>`. The script runs everything that can be run
(§1 and the mechanical parts of §5) and refuses to record a result until the judgement parts —
§2, §3 and §6 — have been done and asserted.

**The audit is also a gate.** `/tickets next` will not hand over a ticket in capability *N* while
any lower-numbered capability that has tickets lacks a recorded `pass` or `forced` audit. It does
not hide that work — `next --all` lists it, marked gated — it refuses to start it. Do not route
around the gate by starting a ticket by hand: the audit is skipped exactly when it matters most,
which is when the next capability is already exciting.

---

## 1. Automated — must be green, no exceptions

- [ ] `/tickets validate` reports no errors across `open/` and `closed/`.
- [ ] Every check in the block below passes.

The script runs each line of the `audit-checks` block from the project root: `<check-id>: <shell
command>`, where exit 0 is a pass and anything else a fail. These are this project's own gates —
its tests, typecheck, lint, build, and any structural checks its architecture depends on. A check
that should exist but cannot run yet is not deleted; it is left out until the code it checks
exists, and the audit table says so.

<!--
INSTALLER NOTE: replace the block below with this project's real checks, taken from its manifest
and CI config (package.json scripts, Makefile targets, pyproject tool config, CI workflow steps).
One check per line, `<check-id>: <shell command>`, run from the project root. Good candidates:
the full test suite, typecheck, lint, the production build, and any grep or script that enforces
an architectural boundary named in ARCHITECTURE.md. Never invent a command the project does not
have; if a gate is missing, list it in the install summary as recommended work instead. Remove
this comment block once filled in.
-->

```audit-checks
# <check-id>: <shell command>
tests: <the project's full test command>
```

## 2. Design conformance — the manual half, and the part that actually catches drift

`/tickets audit <capability> --sections` lists the design-doc sections this capability's tickets
cite. For each one:

- [ ] Re-read the section. **List every place the implementation differs from it.**
- [ ] For each difference, choose explicitly and record which:
      - **the code was wrong** → file a `bug` ticket (`--source agent`), or fix now if trivial, and
        name it in `--record --divergence "code-was-wrong|<id>|…"`. A ticket filed this way does
        **not** fail §5's `capability-tickets-closed` — it is this audit's own finding, tracked on
        purpose. The record lists it as outstanding work; it never reads as a clean close; or
      - **the design was wrong** → amend the doc *in this commit*, append an ADR to
        `docs/DECISIONS.md` with the reasoning, and note which earlier decision it supersedes.
- [ ] Check any contract the architecture names as canonical — an API schema, a data contract, an
      interface between components — is still accurate. If it drifted, the contract is wrong or
      the code is; resolve it here, never later.
- [ ] Scan `docs/DECISIONS.md` for any decision this capability's work has quietly falsified. A
      decision contradicted by shipped code and left standing is the most expensive kind of drift,
      because the next session will trust it.

**Drift budget: three.** More than three divergences in one capability means the design is stale,
not that the code is sloppy. Stop shipping tickets and run a DESIGN session on the affected doc.
The script refuses to record more than three without `--force`.

## 3. Operator validation — did it actually happen

- [ ] Every closed ticket has a real `## Operator validation` result — the operator's dated report
      for perceptual checks, or **the agent's smoke test against the real thing** for everything
      else — not a restatement of the instruction and not "None" where something was observable.
- [ ] **The USE step happened.** The capability was exercised against real work, through the real
      path, and looked at — not merely unit-tested. A capability with nothing operator-facing (a
      library seam, a migration) is exercised by whatever consumes it; demanding a ritual where
      there is nothing to look at is ceremony, not validation.
- [ ] Anything that looked wrong but passed its tests is filed as a ticket, not tolerated.

## 4. Regression against earlier capabilities

- [ ] Did this capability change anything an earlier one depends on? If so, that earlier
      capability's validation is re-run — for an operator-facing capability, at minimum exercise
      its main path once; for a backend one, re-run its smoke test.
- [ ] Any invariant the project promises never to break (data never lost, a counter never lowered,
      a contract never narrowed) still holds. Where such an invariant is scriptable, it belongs in
      §1's `audit-checks` block so the audit checks it every time instead of hoping someone does.

## 5. Hygiene

- [ ] No `blocked_by` left pointing at a closed ticket (`blocked-by-closed`, scripted).
- [ ] Every ticket in the capability is closed (`capability-tickets-closed`, scripted). Two
      exceptions, both named in the recorded audit rather than hidden: a `deferred` ticket, and a
      ticket this audit filed as a §2 code-was-wrong divergence. Ordinary unfinished work still
      fails.
- [ ] Any scope discovered mid-capability was filed as a new ticket (`source: agent`), not absorbed
      silently.

## 6. Write the REFLECT section

In `docs/capabilities/NN-name.md`, under the REFLECT heading the template ships with, record:

- What the design got wrong, and what it got right that was non-obvious.
- Divergences found above, and how each was resolved.
- Estimate vs. actual sessions, and what drove the difference.
- **What the next capability should do differently.** If nothing, say so — but say it deliberately.

The script refuses to record an audit while this section is still a heading and a placeholder.

## 7. Record

```
/tickets audit <capability>        # → SCRIPT audit <capability> --record --divergence "…" …
```

`--record` appends a human-readable write-up and a one-line machine-readable `<!-- audit-record -->`
comment to the capability doc. Records are append-only: a re-audit adds a new one and the last one
stands. `--force "<reason>"` records `verdict: forced` with its reason, never `pass`, and opens the
gate the same way — use it for a genuine emergency, and say so in the session summary.

Then set the capability doc's `Status:` to `shipped`, commit, and clear context.
