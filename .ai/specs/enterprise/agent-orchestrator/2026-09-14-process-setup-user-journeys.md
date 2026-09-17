# Process setup from user journeys

## TLDR

Help an operator turn an existing workflow or agent into a repeatable business operation. Use one guided page: purpose, starting conditions, visible progress, access, activation, then advanced input settings.

## Overview and evidence

Observed: the operator cannot discover milestones, receives a warning for a newly added empty row, and is asked for permission IDs, cron and event patterns. The existing workflow API exposes step milestone declarations; these are the source for suggestions. A milestone is a reported business event, not an arbitrary step. The assumed primary user is an operations administrator who knows the business task but not its internal identifiers. No usability interviews have been performed.

## User stories

1. **Make work repeatable.** As an operations administrator, I want to find the automation for a business task and give it a recognizable name so colleagues can use it consistently. Search by name or ID; explain agent versus existing workflow in context.
2. **Start at the right moment.** I want colleagues to start work manually, on a familiar schedule, or after a business event so I do not need to remember each run. Offer daily, weekday and weekly schedules with time and timezone; show the next runs; keep custom cron available. Suggest registered events by readable name and ID.
3. **Show meaningful progress.** I want to choose the checkpoints colleagues will see so they know what has happened without reading execution traces. Display available workflow milestones before asking for input. Selecting one adds a complete entry; renaming its display text preserves its event key. Ordering controls establish the presentation order, not execution order.
4. **Recover when a checkpoint is unavailable.** I want to know why a milestone cannot be selected and how to make it available. Distinguish no workflow, no reported milestones, loading, and unavailable definitions. Link to the selected workflow in a new tab. Custom milestones remain an advanced path with an explanation that the workflow must report them. Never warn about a blank draft.
5. **Grant access deliberately.** I want to choose the operations the automation may perform and optionally restrict who starts it. Search permission titles and IDs; distinguish execution permissions from additional caller requirements. Preserve existing grants and wildcard values.
6. **Revise safely.** I want to switch workflows, adjust a schedule, or rename progress labels without losing other work. Preserve authored values, discard stale suggestion responses, and flag only completed milestones absent from the newly selected workflow. Invalid event configuration must block saving rather than silently saving the old value.

## Problem statement and direction

The current form exposes storage concepts before the user can decide what they need. A larger dropdown alone leaves the surrounding task unexplained. A multi-step wizard would conceal related choices during edits. Choose a single grouped page, guided choices, clear defaults, and progressive disclosure. Suggestions are deterministic metadata; AI generation is not needed.

## Interaction and architecture

- Keep CrudForm as the parent for values, validation, save guards and optimistic locking. Keep existing field IDs and persisted payloads.
- Workflow selection reuses core's `WorkflowSelector` drawer: browse cards with names, IDs, versions, enabled status and descriptions; search names, IDs or descriptions; select to update the form and milestone suggestions. Load all catalogue pages in batches of at most 100, cancel stale requests, and expose retry on failure. The selected value remains a workflow ID, and cancelling does not change it. Core selector props and existing exclusions remain compatible.
- Name groups “What should this process do?”, “When should it start?”, “What progress should people see?”, “What can this process access?”, and “Ready to use?”. Use CrudForm's standard non-collapsible section cards, retaining the questions as static titles. Input contract remains the last section. Technical disclosures inside the trigger and milestone editors remain local controls.
- Use the full available page width with CrudForm's existing responsive grouped layout: purpose, triggers and milestones in the main column; access, activation and the last input-contract section in `column: 2`. The built-in 70/30 desktop layout stacks on smaller screens. Do not wrap the form in a fixed maximum-width container.
- MilestoneEditor shows searchable available checkpoints with the source step names. Add one or all; omit already selected keys. Selected rows have a visible display-name label, source explanation, reorder/remove, and an advanced event-key editor. Custom drafts are local until valid and explicitly added.
- No milestones: “This workflow does not report any milestones yet. You can still run it and follow its overall status.” Offer workflow inspection and advanced custom authoring. Request failure: show retry, never claim no milestones. Single-agent mode explains its one completion milestone.
- Resolve suggestions from enabled published workflow versions, choosing the highest version; page through exact-ID matches. Clear old results during workflow changes.
- Reuse ComboboxInput, TagsInput, FormField, Select, Button, Alert and existing editor islands. Local schedule helpers convert familiar choices to existing cron strings; existing custom cron stays intact. Event and permission lookups use the existing authenticated APIs.

## Data models and API contracts

No migrations, API, ACL, event or runtime changes. Read workflow definitions, features and events using apiCall. Existing process create/update payloads and single-agent materialization remain intact. Preserve advanced event config, priority, manual requirements, grants and milestone keys on editing. Existing workflows with no reported checkpoints remain saveable.

### Migration & Backward Compatibility

No persisted data migration is required. Shared UI additions are optional: `CrudFormGroup.defaultCollapsed`, `collapsibleGroups.showFieldCount`, and `TagsInput.commitOnBlur`. Existing callers keep expanded groups, field counts and commit-on-blur defaults. The process form explicitly opts out of committing permission searches on blur. Collapsed groups retain their mounted values but are inert and hidden from assistive technology until expanded. Existing milestone-editor exports remain available.

## Risks and impact review

| Risk | Severity | Mitigation |
|---|---|---|
| Invented milestone suggests progress that can never happen | High | Suggest only declared emissions; custom path explains required workflow change |
| Old request overwrites suggestions after switching workflow | Medium | Cancel stale effects and associate loaded data with workflow ID |
| Changing labels breaks event binding or focus | Medium | Preserve keys; stable row identity while editing |
| Hiding advanced settings drops stored configuration | High | Disclosure affects visibility only; retain complete values |
| Invalid JSON saves prior event configuration | High | Wire child validity to parent save validation |
| Operator misunderstands permissions | Medium | Human-readable catalog labels, raw ID available, separate caller/execution wording |

## Validation and acceptance criteria

- Component tests cover selecting actual milestones, label/key independence, deduplication, ordering, blank drafts, network failure/retry and workflow switching.
- Schedule tests cover daily/weekday/weekly conversion, custom-cron preservation and timezone preview.
- Self-contained integration coverage exercises workflow fixture creation, process creation with suggested milestone, saved milestone/trigger payload, and cleanup. Additional UI failure states may use intercepted responses.
- Run enterprise typecheck/build, affected tests, locale parity and targeted lint. Inspect the rendered form in a browser when a local server is available.
- Usability follow-up: ask an operator to create a weekday process with two checkpoints without naming an internal identifier. Success means a saved intended schedule and milestone keys without help; any invented checkpoint or unintended permission change fails the exercise. This remains an untested usability assumption until observed.

## Final compliance report

Implemented. The UX-shaping, backend-UI and design-system skills informed the user journeys, grouped-page choice, recovery states and shared-component reuse. No `.uxproof` contract is present. AI checks are not applicable: suggestions use existing workflow metadata.

Verification uses the **local runner** and the existing app at `http://localhost:3000` (no compose app container was running):

- 76 affected enterprise unit tests and 26 shared UI tests pass. Coverage includes milestone selection, empty capabilities, duplicate emissions, highest published version, stale request cancellation, local custom drafts, event retry, permission search, trigger-draft preservation, timezone preview, and collapsed-group accessibility.
- Enterprise and UI typechecks and package builds pass. Full monorepo CI was not run.
- `TC-AGENT-PROCDEF-005` passes against the real app: creates its own workflow, searches/selects it, chooses and renames a reported milestone, selects a weekday schedule, saves a disabled process, verifies persisted milestone and trigger data, and deletes both fixtures. The same journey checks a 390px viewport for horizontal overflow. No process is executed.
- Desktop and mobile screenshots inspected; artifacts are under `.ai/qa/test-results/artifacts/` (local, not committed). The initial test-preview assertion selected the heading span rather than the complete preview; the corrected locator passes.
- Width follow-up: browser assertions at 1920px confirm main/sidebar sections sit alongside each other and use over 1400px of horizontal space; at 390px they stack without horizontal overflow. Enterprise typecheck/build and page-scoped DS lint pass after this layout-only change.
- Locale parity passes for English, Polish, German, Spanish and Korean. Existing identical-value and repository hardcoded-string advisories remain outside this change.
- Targeted DS lint has no errors; one advisory flags the non-rendering milestone lookup helper for missing a loading state, which is handled by `MilestoneEditor`. Repository health scan and token parity completed; the generated global report was restored to avoid unrelated report churn.

Usability is not claimed as proven: representative-operator validation of the story-based task remains a follow-up. Workflows without declared emissions correctly offer no milestone suggestions and point to workflow configuration.

## Changelog

- 2026-09-15: Reused the workflow card drawer in process setup, removed its 50-item catalogue cap, added localized search/empty states and safe pagination/retry, and covered selection through the save journey.
- 2026-09-15: Verified 11 picker/milestone unit tests, the real-browser save journey, desktop/mobile screenshots (390px drawer spans the viewport), both affected package builds/typechecks, targeted DS lint, and all five picker locales. Manually selecting checkout displayed its three declared milestone suggestions. No workflow was executed.

- 2026-09-14: User-story-driven design and acceptance criteria recorded before implementation.
- 2026-09-14: Implemented guided process setup and reusable input behaviors; verified unit, build, localization and real-browser save paths.
- 2026-09-14: Removed the narrow page wrapper and adopted CrudForm's built-in responsive group columns after desktop-width feedback.
- 2026-09-14: Replaced page-level accordions with standard section cards while retaining question titles. Updated save-path assertions to prevent accordion regressions. Fixed shared permission-suggestion rows to size to their wrapped label and description, with a bounded scrollable list.
