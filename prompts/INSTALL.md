# TicketSmith Install Prompt

> Paste this prompt into a fresh Claude Code session in your target project.
> Claude Code will install TicketSmith into the project, discovering the
> project's structure and adapting the templates as it goes.

## How to use

1. In your target project, open Claude Code and `/clear` to start fresh.
2. Decide where TicketSmith lives — either:
   - A local clone (e.g., `~/code/ticketsmith/`)
   - The GitHub repo URL (Claude will use web_fetch)
3. Paste the prompt below, filling in the placeholder.
4. Answer Claude's discovery questions.
5. Review Claude's integration plan before confirming.

## The prompt

```
You're going to install TicketSmith into this project. TicketSmith is a
markdown-based design-and-build methodology that lives alongside the
existing code without touching it.

TICKETSMITH LOCATION: <FILL IN ONE>
  - Local path: /path/to/ticketsmith
  - OR GitHub raw URL: https://raw.githubusercontent.com/USER/ticketsmith/main

Work through the phases below in order. STOP for my confirmation between
each phase. Do not skip phases or combine them.

═══════════════════════════════════════════════════════════════════════
PHASE 1 — READ TICKETSMITH ITSELF
═══════════════════════════════════════════════════════════════════════

Read these files from the TicketSmith location so you understand what
you're installing:

  README.md
  docs/METHODOLOGY.md
  docs/TICKET_FORMAT.md
  templates/CLAUDE.md.template
  templates/.claude/commands/tickets.md
  templates/docs/capabilities/WORKFLOW.md
  templates/docs/capabilities/TEMPLATE.md
  templates/prompts/CAPABILITY_DESIGN.md
  templates/prompts/CONSOLIDATION_PASS.md
  templates/prompts/ARCHITECTURE_REVIEW.md

Then summarize back to me, briefly:
- What TicketSmith is (one paragraph)
- The five disciplines from the methodology
- What files will be installed and where they go
- The opinionated positions you'll be enforcing during install

Wait for me to confirm understanding before proceeding to Phase 2.

═══════════════════════════════════════════════════════════════════════
PHASE 2 — DISCOVER THE TARGET PROJECT
═══════════════════════════════════════════════════════════════════════

Read-only. Do not write any files yet.

Discover the target project's structure:

  1. List the project root. Note the major folders.
  2. If `README.md` exists at the root, read it.
  3. If `CLAUDE.md` exists at the root, read it fully.
  4. If `docs/` (or similar named documentation folder) exists, list
     its contents. Read any file that looks like architecture, design,
     contributing, or decisions documentation.
  5. If `.claude/commands/` exists, list contents. Note any existing
     slash commands, especially `tickets.md` if present.
  6. Look for existing ticketing or issue-tracking systems:
     - `tickets/` directory in any format
     - `issues/` directory
     - `.github/ISSUE_TEMPLATE/`
     - GitHub Issues (note in summary, but don't fetch)
     - Any other tracking convention you spot
  7. Identify project type (language, framework, primary purpose)
     from the obvious signals (package.json, pyproject.toml, Cargo.toml,
     go.mod, etc.). One sentence summary.

Then produce a Discovery Report with this exact structure:

  ## Project type
  [one sentence]

  ## Documentation found
  [list of relevant docs with one-line descriptions]

  ## Existing CLAUDE.md
  [exists / does not exist; if exists, summarize what's in it]

  ## Existing slash commands
  [list, or "none"]

  ## Existing ticketing system
  [describe in detail if found, or "none detected"]

  ## Architecture documentation
  [exists / partial / does not exist]

  ## Capability roadmap or feature plan
  [exists / partial / does not exist]

  ## Integration concerns
  [anything that looks like it'll need careful handling — naming
   collisions, existing patterns to respect, etc.]

Wait for me to review the Discovery Report before proceeding.

═══════════════════════════════════════════════════════════════════════
PHASE 3 — RESOLVE PREREQUISITES
═══════════════════════════════════════════════════════════════════════

Based on the Discovery Report, route to the appropriate prerequisite
work before installing. STOP at each branch and wait for me to confirm
the path.

BRANCH A — Existing ticketing system detected.
  TicketSmith requires a clean slate. You must direct me to migrate or
  remove the existing ticketing system before install can proceed. Tell
  me to run the migration prompt at `prompts/MIGRATE_EXISTING_TICKETS.md`
  in the TicketSmith location, in a separate session. Stop here.

BRANCH B — No architecture documentation found.
  TicketSmith depends on the project having an architecture document
  that tickets and capabilities can reference. If none exists, surface
  this as a blocker. Ask me whether to:
    (i) Pause install and design an architecture document collaboratively
        first (you'll guide me through it as part of this session)
    (ii) Proceed with install and treat architecture documentation as
        the first thing to create afterward
  If (i), guide me through a brief architecture discovery: what is the
  project, what are its core constraints, what's the tech stack, what
  are the major components. Produce a draft `docs/ARCHITECTURE.md`.
  Wait for my confirmation before proceeding.

BRANCH C — No capability roadmap found.
  TicketSmith is more powerful when there's a forward-looking roadmap
  to pick from. Tell me about the roadmap design prompt at
  `prompts/ROADMAP_DESIGN.md` and offer to run it as part of this
  session, or to defer until after install. Either is fine; if I defer,
  add a note in the installed CLAUDE.md pointing me at the roadmap
  prompt as a recommended next step.

BRANCH D — Existing CLAUDE.md detected.
  You will MERGE TicketSmith content into the existing CLAUDE.md, never
  replace it. Note the existing content's structure so you can integrate
  cleanly. If there are competing conventions (e.g., the existing
  CLAUDE.md says one thing, TicketSmith says another), surface them
  for my decision.

BRANCH E — Existing `.claude/commands/tickets.md` detected.
  REFUSE to silently overwrite. Show me the existing file's first 20
  lines, describe what it does, and ask explicitly whether to:
    (i) Overwrite (existing content is replaced)
    (ii) Rename existing to `tickets.legacy.md` and install fresh
    (iii) Abort install
  Wait for explicit choice. Do not assume.

Once all relevant branches are resolved, summarize the resolved
prerequisites and proceed to Phase 4.

═══════════════════════════════════════════════════════════════════════
PHASE 4 — PRODUCE INTEGRATION PLAN
═══════════════════════════════════════════════════════════════════════

Do not write files yet. Produce a written integration plan listing
every file that will be created or modified, in this format:

  FILE: <path>
  ACTION: <create | merge | overwrite-with-confirmation>
  SOURCE: <which template it derives from>
  ADAPTATIONS: <list of project-specific changes from the template>

The adaptations are how TicketSmith fits this project. Specifically:

  templates/CLAUDE.md.template → CLAUDE.md
    Adapt the "Constraints worth remembering" section to reflect the
    actual constraints of THIS project. Read the architecture doc and
    pull the load-bearing constraints. Common examples:
      - Single-user vs multi-user
      - Local-only vs cloud-deployed
      - Tech stack specifics ("no Alembic until schema evolves")
      - Architectural rules ("LLM never sees raw secrets")
    Replace placeholder constraints with project-specific ones. Don't
    leave generic placeholder text in the installed file.

  templates/docs/capabilities/WORKFLOW.md → docs/capabilities/WORKFLOW.md
    Install verbatim. This is the methodology; it doesn't adapt.

  templates/docs/capabilities/TEMPLATE.md → docs/capabilities/TEMPLATE.md
    Install verbatim. This is the methodology; it doesn't adapt.

  templates/prompts/CAPABILITY_DESIGN.md → prompts/CAPABILITY_DESIGN.md
    Install verbatim. The prompt is generic by design.

  templates/prompts/CONSOLIDATION_PASS.md → prompts/CONSOLIDATION_PASS.md
    Install verbatim.

  templates/prompts/ARCHITECTURE_REVIEW.md → prompts/ARCHITECTURE_REVIEW.md
    Install verbatim.

  templates/.claude/commands/tickets.md → .claude/commands/tickets.md
    Install verbatim. The command's behavior is uniform.

  (new) docs/DECISIONS.md
    Create empty with just a header. Operator will append ADRs as
    decisions get made.

  (new) tickets/open/.gitkeep, tickets/closed/.gitkeep
    Create empty placeholders so the folders are tracked by git.

If branch B (architecture doc) was resolved by creating a new
ARCHITECTURE.md, include that in the plan as well.

Show me the full plan. Wait for me to approve or revise before
proceeding.

═══════════════════════════════════════════════════════════════════════
PHASE 5 — EXECUTE
═══════════════════════════════════════════════════════════════════════

Apply the approved plan. For each file:

  - If ACTION is `create`, write the file. Confirm it doesn't exist
    first; if it does, stop and ask.
  - If ACTION is `merge`, read existing content, integrate
    TicketSmith content, preserve everything else. Show me the merged
    result before saving if the merge involved nontrivial decisions.
  - If ACTION is `overwrite-with-confirmation`, confirm one more time
    before writing.

Apply changes in this order so a partially-failed install is still
useful:

  1. Create folder structure (tickets/, docs/capabilities/, prompts/,
     .claude/commands/ as needed)
  2. Install verbatim files (templates that don't adapt)
  3. Create new files (DECISIONS.md, gitkeeps)
  4. Adapt and install CLAUDE.md
  5. If architecture doc was created in Phase 3, install it
  6. If roadmap design was done in Phase 3, install the roadmap doc

After each file is written, briefly confirm: "Wrote <path>."

═══════════════════════════════════════════════════════════════════════
PHASE 6 — VERIFY AND SUMMARIZE
═══════════════════════════════════════════════════════════════════════

After all files are written:

  1. Verify the installation:
     - All files from the plan exist at their expected paths
     - No files were left half-written
     - `tickets/open/` and `tickets/closed/` exist (even if empty)
     - `.gitignore` is sane (if the project has one, ensure
       tickets/ folders aren't accidentally gitignored)
  2. Run `git status` and report what's new or changed.
  3. Produce a final summary with:
     - Installed files
     - Files merged (with brief note on what was preserved)
     - Any branches resolved (architecture doc created, roadmap
       drafted, etc.)
     - Recommended next steps:
       a. Review the installed CLAUDE.md and confirm the constraints
          section accurately reflects the project
       b. If no roadmap was created during install, run the roadmap
          design prompt
       c. If no open tickets exist yet, the next action is to design
          the first capability with prompts/CAPABILITY_DESIGN.md
     - A reminder that I should commit this install as a single commit
       with a message like `chore: install TicketSmith methodology`

Then stop. The install is complete.

═══════════════════════════════════════════════════════════════════════
CONSTRAINTS THROUGHOUT
═══════════════════════════════════════════════════════════════════════

- Never touch any source code. The kit is markdown only. Source code
  changes are not part of an install.
- Never silently overwrite an existing file. Confirm explicitly.
- Never proceed past a phase without confirming the previous phase's
  output with me.
- Never assume the project's conventions; ask if unclear.
- Never invent project-specific constraints in the CLAUDE.md. Pull
  them from the actual architecture documentation. If they aren't in
  the docs, ask me.
- If something in the kit's templates contradicts something in the
  project's existing docs, surface the contradiction and ask me to
  resolve it before installing.

Start with Phase 1 now.
```

## What to expect during install

The install takes one Claude Code session, usually 15-30 minutes of
back-and-forth. Most of that time is in Phase 2 (Discovery) and Phase 3
(Resolve Prerequisites). The actual file writes are fast.

The most common branches you'll hit:

- **Branch A (existing tickets)** — common if migrating from any other
  ticketing approach. You'll run the migration prompt, then come back
  to install.
- **Branch B (no architecture doc)** — common in young projects. The
  installer will offer to draft one with you, which is usually worth
  doing inline rather than deferring.
- **Branch D (existing CLAUDE.md)** — very common. The installer
  merges; review the merged output carefully.

The opinionated positions the kit enforces during install are:

- Tickets are markdown on disk, not anywhere else
- Folder structure is fixed (`tickets/open/`, `tickets/closed/`,
  `docs/capabilities/`, `prompts/`, `.claude/commands/`)
- Ticket frontmatter fields are fixed (no custom fields)
- The `/tickets` slash command behavior is uniform across projects
- Closed tickets move, never get deleted
- `DECISIONS.md` is append-only

If any of these are blockers for your project, TicketSmith probably
isn't the right fit — consider whether you actually want this kit or a
different approach.

## After install

The next step is almost always one of:

- **Design the first capability** — run `prompts/CAPABILITY_DESIGN.md`
  in a fresh session. If the installer drafted a roadmap, pick from it;
  if not, run `prompts/ROADMAP_DESIGN.md` from TicketSmith first.
- **Commit the install** — `git add . && git commit -m "chore: install
  TicketSmith methodology"`. Keep the install as a single commit so the
  diff is easy to review later.

You won't use the install prompt again unless you're installing
TicketSmith into a different project.
