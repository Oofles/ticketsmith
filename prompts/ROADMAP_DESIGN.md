# Design a Capability Roadmap

> Paste this prompt into a fresh Claude Code session in your target project,
> either during TicketSmith install (Branch C of the install prompt) or
> any time after install when you want to formalize a roadmap.

## When to use this

A capability roadmap is a forward-looking list of what you intend to
build, organized into layers, with short descriptions for each
capability. The roadmap is not a commitment to build everything; it's
a menu you pick from when starting a new capability.

Run this prompt if:

- TicketSmith is installed and you have no roadmap doc yet
- You have an informal sense of what to build but want it structured
- The project has shifted direction and the existing roadmap is stale
- You're starting a new project and want to map the territory before
  diving in

## Output

A `docs/capabilities/ROADMAP.md` file with:

- Capabilities organized into layers (Foundation → Specialized →
  Quality-of-life)
- Each capability has a one-paragraph short description suitable for
  direct paste into the `CAPABILITY_DESIGN.md` prompt
- Strategic notes about ordering, what's intentionally not on the list,
  and reminders about the "don't design ahead" discipline

## The prompt

```
You're going to help me design a capability roadmap for this project.
Read TicketSmith's workflow first, then the project's architecture, then
guide me through a discovery conversation, then produce a roadmap doc.

TICKETSMITH LOCATION (only needed if not yet installed): <FILL IF APPLICABLE>

Work through the phases below in order. STOP for my input between phases.

═══════════════════════════════════════════════════════════════════════
PHASE 1 — READ CONTEXT
═══════════════════════════════════════════════════════════════════════

Read these:

  1. `docs/ARCHITECTURE.md` (or whatever the project's architecture doc
     is named — find it). Understand what the project is, what its
     constraints are, what's in scope and what's out.
  2. `docs/capabilities/WORKFLOW.md` if it exists (i.e., TicketSmith is
     installed). This describes how capabilities are built, which
     shapes what makes a good capability.
  3. Any existing capability docs in `docs/capabilities/NN-*.md`. These
     are work already done or designed. The roadmap should not repeat
     them.
  4. `README.md` for the project's stated purpose.

If TicketSmith is not yet installed, also read:
  - TICKETSMITH_LOCATION/docs/METHODOLOGY.md
  - TICKETSMITH_LOCATION/docs/capabilities/WORKFLOW.md (the same file
    that gets installed)

Briefly confirm what you've read so I know we're working from the same
context. Wait for me to confirm.

═══════════════════════════════════════════════════════════════════════
PHASE 2 — DISCOVER MY VISION
═══════════════════════════════════════════════════════════════════════

Ask me questions to surface what's in my head but not in the docs.
Don't ask all of these — pick the ones that matter most given the
project's stage. Aim for 5-8 high-leverage questions across one or
two rounds.

Areas to probe:

  THE BIG PICTURE
  - What's the project's purpose, in one sentence? (Often differs
    from the README's marketing-speak.)
  - Who is the operator (yourself, future you, a team)? What do they
    care about?
  - What does "done enough" look like? Is this a long-running project
    or one with a finish line?

  THE INFLECTION POINT
  - What's the smallest set of capabilities that would make this
    project genuinely useful, not just functional? (This is the
    "Layer 1+2" inflection point.)
  - What's already built that you're happy with? What's working but
    feels rough? What's missing entirely?

  THE SHAPE OF WORK
  - What kinds of capabilities does this project naturally
    decompose into? (E.g., domain-specific modules, user-facing
    features, infrastructure layers, integrations, etc.)
  - Are there natural "phases" of difficulty or risk? What should be
    built early because it's foundational vs. late because it depends
    on other things?

  CONSTRAINTS AND BOUNDARIES
  - What's explicitly NOT on the roadmap? (Things you've ruled out for
    scope, complexity, or values reasons.)
  - Are there hard external constraints — deadlines, dependencies,
    other systems — that affect ordering?

  ANTI-OVERPLANNING
  - Which capabilities are you certain you want? Which are speculative?
    (Speculative ones still belong on the roadmap, just labeled.)
  - Have you tried similar tools or projects before? What did you
    learn about what you actually USE vs what sounded good in theory?

Ask the questions in one batch. Wait for my answers.

═══════════════════════════════════════════════════════════════════════
PHASE 3 — DRAFT A ROADMAP STRUCTURE
═══════════════════════════════════════════════════════════════════════

Based on my answers and the docs, propose a layered structure for the
roadmap. Don't fill in capabilities yet — just propose the layers and
what belongs in each.

Examples of layer schemes that work:

  GENERIC PRODUCT-SHAPED LAYERS:
    1. Foundation — what makes the thing minimally useful
    2. Common cases — features that cover the 80% workflow
    3. Edge cases and integrations
    4. Quality of life and polish

  DOMAIN-SHAPED LAYERS (when the project has natural domains):
    1. Core infrastructure
    2. Each domain as a layer (e.g., for a CTF tool: recon, exploitation,
       post-exploitation)
    3. Cross-cutting features (analysis, reporting, export)

  RISK-ORDERED LAYERS (when risk drives ordering):
    1. Validate the riskiest assumption
    2. Build out the unrisky-but-essential
    3. Optimize and polish

Propose the structure as bullets. Tell me which scheme you picked and
why. Wait for my response — I may revise or pick differently.

═══════════════════════════════════════════════════════════════════════
PHASE 4 — POPULATE CAPABILITIES
═══════════════════════════════════════════════════════════════════════

Within each approved layer, propose specific capabilities. For each:

  - A short, kebab-case name (e.g., `service-enumeration`,
    `user-profile-editing`)
  - A one-paragraph short description — written in a form suitable
    for direct paste into the CAPABILITY_DESIGN.md prompt's
    `<ONE_LINE_DESCRIPTION>` placeholder
  - 1-3 sentences of rationale explaining why it's at this layer,
    what it unblocks, or what its scope contains

Aim for 4-10 capabilities per layer. If a layer ends up with more than
10, it's probably two layers; propose a split. If a layer has fewer
than 3, it might not be a real layer.

Be honest about speculative capabilities — mark them as such. The
roadmap is more useful with honest uncertainty than with false
confidence.

Show me the populated roadmap. We may iterate — moving capabilities
between layers, splitting/merging, removing, adding.

═══════════════════════════════════════════════════════════════════════
PHASE 5 — STRATEGIC NOTES
═══════════════════════════════════════════════════════════════════════

After the capabilities are settled, draft a "Strategic Notes" section
at the bottom of the roadmap covering:

  - Which layers are the inflection point (the minimum that makes
    the project useful)
  - Realistic sizing (rough capability count × rough capability
    duration)
  - Reminders that the roadmap is for picking, not designing
  - What's deliberately NOT on the roadmap and why
  - Suggested order, including any non-obvious ordering rationale

The strategic notes are the part that survives changes. The
capabilities themselves will shift; the strategy holds.

Show me the strategic notes. Iterate if needed.

═══════════════════════════════════════════════════════════════════════
PHASE 6 — WRITE THE ROADMAP DOC
═══════════════════════════════════════════════════════════════════════

Write the assembled roadmap to `docs/capabilities/ROADMAP.md` with this
structure:

  # <Project Name> — Capability Roadmap

  > Brief intro: what this doc is, who it's for, the
  > "don't design ahead" reminder

  ## Layer 1 — <Layer Name>

  ### 1. <capability-name>

  **Short description:** <one paragraph, paste-ready>

  <1-3 sentences of rationale>

  ### 2. <next-capability-name>
  ...

  ## Layer 2 — <Layer Name>
  ...

  ## Strategic notes

  <the strategic notes from Phase 5>

  ## How to use this with the design prompt

  <brief instructions: copy the short description, fill the
  CAPABILITY_DESIGN.md placeholders, run it in a fresh session>

Confirm the file is written. Run `git status` to show what's new.

═══════════════════════════════════════════════════════════════════════
PHASE 7 — STOP
═══════════════════════════════════════════════════════════════════════

Don't do anything else. Don't start designing capability #1. Don't
generate tickets. The roadmap exists; the next session will pick from
it.

Suggest the commit:
  git add docs/capabilities/ROADMAP.md
  git commit -m "docs: add capability roadmap"

═══════════════════════════════════════════════════════════════════════
CONSTRAINTS THROUGHOUT
═══════════════════════════════════════════════════════════════════════

- The roadmap is the operator's vision, surfaced and structured. Don't
  inject capabilities I didn't ask for unless they're load-bearing
  prerequisites; surface those as questions, not as additions.
- Push back when something belongs at a different layer than I put it.
- Push back when capabilities are too big (need a split) or too small
  (need a merge).
- Don't over-specify. Each capability is a short description — not a
  spec. The spec gets written when the capability is actually started.
- Honor what's NOT on the roadmap. If I say "I'm explicitly not building
  X," capture that in the strategic notes, not as a missing entry.

Start with Phase 1 now.
```

## After the roadmap exists

The first thing to do once the roadmap exists is **not** to design every
capability. The roadmap is for picking, not designing.

When you're ready to start the first capability:

1. Fresh Claude Code session, `/clear`
2. Open `prompts/CAPABILITY_DESIGN.md`
3. Fill in the placeholders with the first capability's name and short
   description (copy from the roadmap)
4. Follow the design prompt

The roadmap should be revisited periodically (every few capabilities)
to reorder based on what you've learned. It's not immutable; it's a
living document.

## Anti-patterns to avoid

- **Designing all roadmap capabilities upfront.** The point of the
  roadmap is to LIST capabilities, not to specify them. Specs come
  later, one at a time, based on real learning.
- **Treating the roadmap as a commitment.** It's a menu. You'll
  reorder, drop, and add as the project evolves. Set the expectation
  that capabilities will shift.
- **Roadmap creep.** Don't add capabilities to the roadmap just because
  they're possible. The list should reflect what you actually plan to
  build, with honest speculation marked as such.
- **Skipping the strategic notes.** The notes are the part that
  outlasts changes to specific capabilities. They're worth doing well.
