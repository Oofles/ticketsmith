# Migrate Existing Tickets to TicketSmith

> Paste this prompt into a fresh Claude Code session in your target project,
> BEFORE running the TicketSmith install prompt. This converts an existing
> ticketing system to TicketSmith format and removes the old system entirely.

## When to use this

Run this prompt if the target project already has:

- Markdown tickets in a non-TicketSmith format
- A custom issue-tracking convention (any folder of structured files)
- GitHub Issues that you want to migrate
- Any other format you want to bring into TicketSmith

Run the TicketSmith install prompt AFTER this migration completes.

If your project has no existing ticketing system, skip this prompt and
go straight to the install.

## What this prompt does

1. Discovers the existing ticketing system
2. Confirms scope and format with the operator
3. Converts each existing ticket to TicketSmith format
4. Verifies the migration is complete
5. Removes the old ticketing system entirely
6. Stops, ready for TicketSmith install to be run

The removal step is **destructive** and requires explicit confirmation.

## The prompt

```
You're going to migrate an existing ticketing system to TicketSmith format
and remove the old system entirely. This runs BEFORE the main TicketSmith
install — once migration is complete, the operator will run the install
prompt separately.

TICKETSMITH LOCATION: <FILL IN ONE>
  - Local path: /path/to/ticketsmith
  - OR GitHub raw URL: https://raw.githubusercontent.com/USER/ticketsmith/main

Work through the phases below in order. STOP for my confirmation between
each phase.

═══════════════════════════════════════════════════════════════════════
PHASE 1 — READ THE TARGET FORMAT
═══════════════════════════════════════════════════════════════════════

Read these files from the TicketSmith location:

  docs/TICKET_FORMAT.md
  README.md

Summarize back to me the TicketSmith ticket format briefly, especially:
- Frontmatter fields (id, slug, title, type, priority, status, created, closed)
- Required body sections (Description, Acceptance criteria, Notes)
- Bug-specific sections (Steps to reproduce, Expected vs actual)
- The numbering scheme (sequential, zero-padded 4-digit)

Wait for me to confirm before proceeding.

═══════════════════════════════════════════════════════════════════════
PHASE 2 — DISCOVER THE EXISTING SYSTEM
═══════════════════════════════════════════════════════════════════════

Read-only. Discover what's currently being used for ticketing:

  1. Look for markdown ticket folders:
     - `tickets/`, `issues/`, `tasks/`, `todo/`, `backlog/`
     - Any folder with multiple structured markdown files
  2. Look for GitHub Issues integration:
     - `.github/ISSUE_TEMPLATE/` folder
     - `.github/issue_template.md`
  3. Look for other conventions:
     - TODO files (`TODO.md`, `TASKS.md`)
     - Structured comments in code (`# TODO:`, `# FIXME:`)
       — note these but DO NOT migrate them; they live with the code
     - Custom XML/YAML ticket files
  4. Pick a representative sample (3-5 tickets if available) and read
     them fully. Identify:
     - What fields are present (in frontmatter, in body, or implicit)
     - What conventions exist for naming, numbering, status tracking
     - How "closed" or "done" is represented
     - Whether tickets are deleted or moved when closed

Produce a Migration Discovery Report:

  ## Source system
  [name/description of what's being used]

  ## Source location
  [path or platform]

  ## Ticket count
  [total open, total closed, total]

  ## Source format
  [describe the format, with sample frontmatter or structure if applicable]

  ## Field mapping
  [for each source field, propose the TicketSmith equivalent — or "drop"
   if the field has no TicketSmith equivalent]

  ## Ambiguities
  [anything that doesn't map cleanly, with proposed resolutions]

  ## Removal plan
  [exactly what will be deleted when migration completes — folders,
   files, configs]

Wait for me to review the report and approve the field mapping before
proceeding.

═══════════════════════════════════════════════════════════════════════
PHASE 3 — RESOLVE AMBIGUITIES
═══════════════════════════════════════════════════════════════════════

For each ambiguity in the report, ask me explicitly. Examples of
ambiguities that need resolution:

  - Source has no "priority" field — should I assign all to "med", or
    infer from labels/tags, or leave a placeholder TODO?
  - Source has free-form labels — which ones map to TicketSmith types
    (bug/feature/refactor/docs/chore) and which get dropped?
  - Source has rich descriptions with attachments — should attachment
    references be preserved, dropped, or copied into a notes section?
  - Source has comments/discussions — concatenate into the body, or
    drop?
  - Source closed tickets have no "closed" timestamp — leave omitted,
    or set to file modification time?
  - Renumbering: should existing IDs be preserved (with gaps), or
    renumbered sequentially starting from 0001?

Ask all questions at once; wait for answers before any file writes.

═══════════════════════════════════════════════════════════════════════
PHASE 4 — STAGE THE MIGRATION
═══════════════════════════════════════════════════════════════════════

Do not write any files in the target project yet. Stage the migration
in a temporary working area.

For each source ticket, produce a TicketSmith-format file:

  - Filename: NNNN-slug.md per TicketSmith conventions
  - Frontmatter with all required fields per the spec
  - Body with Description, Acceptance criteria (best-effort if not in
    source), Notes
  - For bugs: Steps to reproduce, Expected vs actual (best-effort)
  - For closed tickets: Resolution section, Operator validation
    section (set to "Migrated from <source>; original validation
    state unknown" if there's no equivalent in source)

If a source ticket's information is too sparse to map cleanly to
TicketSmith's required sections, mark it with a placeholder Notes
entry like "Migrated from <source>; description below preserved
verbatim from original" and include the original content.

Show me a preview of 2-3 migrated tickets — open and closed — before
processing the full batch. Wait for me to confirm the conversion looks
right.

═══════════════════════════════════════════════════════════════════════
PHASE 5 — WRITE THE NEW TICKETS
═══════════════════════════════════════════════════════════════════════

Once the preview is approved:

  1. Create `tickets/open/` and `tickets/closed/` if they don't exist.
  2. Write each migrated ticket to the appropriate folder.
  3. Report progress after every 10 tickets: "Wrote 10/47 tickets."
  4. After all tickets are written, run a verification pass:
     - Every source ticket has a corresponding TicketSmith ticket
     - No filename collisions
     - All ticket numbers are sequential with no gaps (if renumbering
       was chosen)
     - Frontmatter parses cleanly for every file (you can validate
       by reading each file and confirming it has valid YAML
       frontmatter)

Produce a verification report:

  ## Tickets written
  - Open: NN
  - Closed: NN
  - Total: NN

  ## Source tickets accounted for
  [confirm 1-to-1 mapping]

  ## Validation issues found
  [list any tickets that needed fallback handling]

Wait for me to confirm the migration is complete before proceeding to
removal.

═══════════════════════════════════════════════════════════════════════
PHASE 6 — REMOVE THE OLD SYSTEM
═══════════════════════════════════════════════════════════════════════

This phase is DESTRUCTIVE. Confirm explicitly before each step.

Present the removal plan one more time, with exact paths:

  ## To be deleted
  - [path 1]
  - [path 2]
  - ...

  ## To be modified
  - [file]: [what changes]

Wait for me to type "yes, delete" or equivalent explicit consent.

If consent received:

  1. Delete the source ticketing folders/files listed in the plan.
  2. If GitHub Issues are part of the source: DO NOT close them
     programmatically. Tell me they need to be closed manually with
     a comment pointing at the migrated TicketSmith ticket. Provide
     a CSV-style mapping (issue number → ticket number) so I can do
     this efficiently.
  3. Remove any related config files:
     - `.github/ISSUE_TEMPLATE/` (if migrated)
     - Any tooling-specific config (e.g., a tickets.yaml index file)
  4. Search the project for references to the old ticketing system
     in documentation:
     - README.md
     - CONTRIBUTING.md
     - docs/
    Surface findings; do NOT auto-edit these. I'll handle doc updates
    manually.

Confirm what was deleted with `git status`. Show me the diff so I can
review.

═══════════════════════════════════════════════════════════════════════
PHASE 7 — HANDOFF TO INSTALL
═══════════════════════════════════════════════════════════════════════

Migration complete. Produce a final summary:

  - Tickets migrated (open / closed / total)
  - Old system removed (paths deleted)
  - Manual steps remaining (GitHub Issues to close, docs to update,
    references to clean up)
  - GitHub Issues mapping (if applicable)

Recommend committing the migration as a single commit:
  git add . && git commit -m "chore: migrate tickets to TicketSmith format"

Then stop. The next session should run the TicketSmith install prompt
from prompts/INSTALL.md in the TicketSmith location. The install will
not duplicate work that this migration has already done.

═══════════════════════════════════════════════════════════════════════
CONSTRAINTS THROUGHOUT
═══════════════════════════════════════════════════════════════════════

- Source code is never touched.
- Removal happens only after migration is verified complete.
- GitHub Issues are never closed automatically; the operator handles them.
- Documentation references to the old system are flagged, not auto-edited.
- Existing TicketSmith folders (tickets/, docs/capabilities/, etc.) are
  treated as collisions and surfaced for resolution. If TicketSmith
  appears to be partially installed already, STOP and tell me.

Start with Phase 1 now.
```

## After migration

Once migration is complete and committed:

1. Run the TicketSmith install prompt from `prompts/INSTALL.md` in a
   fresh Claude Code session.
2. The install will detect the migrated tickets and skip Branch A
   (existing ticketing system).
3. Continue through the install as normal.

If migration produced a list of GitHub Issues to close manually, do
that before considering the migration "fully complete" — otherwise
contributors will keep filing Issues that should be tickets.
