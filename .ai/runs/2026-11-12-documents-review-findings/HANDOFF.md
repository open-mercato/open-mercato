# Handoff

## Done

### Phase 1 — findings core
- 1.1 `523b1ddce3` entity, validators, caps, migration. 1.2 `dca9ac331b` review content + anchoring libs. 1.3 `9c555d1e8f` commands, events, summary, undo. 1.4 `930f64b722` routes `api/[id]/findings/**`. 1.5 `3ec9c8063e` TC-DOC-FIND-001..006.

### Phase 2 — editor UI
- `374dfff616` apply rejects `anchor_status = unlocated` with 422 `documents.findings.unlocated` (unit test in `__tests__/findingCommands.test.ts`); quote normalizer moved to pure `lib/findingTextNormalization.ts` (re-exported from `lib/findingAnchors.ts`, used by the editor).
- `18c423fc40` (steps 2.1 + 2.2 in one commit; the hook dynamically imports the decorations module, so they do not build separately):
  - `backend/documents/[id]/findingModel.ts` (pure: zod normalizers, grouping, range resolution, outline counts, severity dots), `useDocumentFindings.ts`, `FindingsPanel.tsx` (exports `DocumentReviewRail` + `FindingsPanel`), `FindingCard.tsx`, `findingDecorations.ts` (plugin + editor helpers + styles).
  - `DocumentPageClient.tsx`: editors (canEdit or tier owner/editor) get `DocumentReviewRail` (tabs Changes | Comments); others keep the plain `CommentsRail`.
  - `useDocumentEditor.ts` registers `DocumentFindingDecorations`; `DocumentCanvas.tsx` injects `FINDING_DECORATION_STYLES`; `OutlinePane.tsx` severity dots.
  - i18n `documents.findings.*` in en/pl/de/es/ko. Unit tests: `__tests__/findingEditorUi.test.ts`.
- `a839f2534b` TC-DOC-FIND-007..010 + `__integration__/helpers/findingsUi.ts`.

### Phase 3 — review playbooks
- `e67509452c` (3.1, plus the server half of 3.2): entities `DocumentReviewPlaybook`, `DocumentReviewRule`, `DocumentReviewPlaybookReference`; `document_findings.playbook_id / playbook_version / rule_id` (FK set null); migration `Migration20261111234535_documents.ts` (generated, `down()` hand-fixed to drop the three tables) + snapshot. Commands `commands/reviewPlaybooks.ts` (8 commands, snapshot undo, redo by id revival). Routes: `api/review-playbooks/route.ts`, `api/review-rules/route.ts` (makeCrudRoute, query engine list, indexer, `updatedAt`), `api/review-playbooks/[id]/references/route.ts` (custom, `resolveDocumentsContext`, view tier else 404). ACL `documents.review_playbooks.manage` (admin covered by `documents.*`; `setup.ts` unchanged). Events `documents.review_playbook.*`, `documents.review_rule.*`, `documents.review_playbook_reference.created|deleted`. Ingest resolves `playbookCode` + `ruleCode` (`resolveIngestPlaybook` in `commands/findings.ts`); list + summary responses carry `playbook {id, code, name, version}` and items carry `playbookId / playbookVersion / ruleId`.
- `3b86637c0a` (3.2): admin pages `backend/documents/review-playbooks/**` (list DataTable, create + detail CrudForm, `RulesEditor.tsx` inline rule editor with Cmd/Ctrl+Enter and Escape plus the conflict bar, `GuidanceDocuments.tsx` search-and-link picker), nav entry under Documents (pageOrder 120, gated on the manage feature), Changes panel review header shows "Playbook: {name} · v{version}". i18n `documents.reviewPlaybooks.*` + `documents.audit.review*` in en/pl/de/es/ko.
- 3.3: TC-DOC-PLAY-001..004 + `__integration__/helpers/reviewPlaybookFixtures.ts`; unit tests `__tests__/reviewPlaybookCommands.test.ts` (version bump, uniqueness, caps, undo, ingest resolution) and `__tests__/reviewPlaybookUi.test.ts`.

### Phase 4 — agent and workflow integration
- `f7dc18c3b4` (4.1): `@open-mercato/core` peer dependency (lockfile: one line under the documents workspace); `workflows.ts` registers `documents.finding.ingest` (`documents.edit`, label `documents.workflows.commands.finding.ingest` in en/pl/de/es/ko, no `defaultEnabled`); `ai-tools.ts` with `documents.get_document_for_review` + `documents.get_review_playbook` (read-only, `documents.view`, tier via `loadScopedDocument` + `resolveLoadedDocumentUserAccess`, caps `DOCUMENTS_REVIEW_TOOL_MAX_DOCUMENT_CHARS` 200 000 / `DOCUMENTS_REVIEW_TOOL_MAX_GUIDANCE_CHARS` 20 000 in `lib/resourceLimits.ts`); `lib/reviewAgentContract.ts` (`documentReviewOutcomeSchema` = `{ kind: 'researcher', data: { findings, summary } }` strict, findings = `findingIngestSchema.shape.findings` by reference; `DOCUMENT_REVIEW_TOOL_IDS`; `buildDocumentReviewInstructions`). Importable via the existing `./*/*/*/*` exports pattern. Tests: `__tests__/reviewAgentContract.test.ts`, `reviewAiTools.test.ts`, `workflowsRegistration.test.ts` (workflow-shaped ctx — `auth.sub` only — reaches `assertDocumentCommandCapability(..., 'canEdit')`; denial propagates). `yarn generate` puts the module into `ai-tools.generated.ts` and `workflows.generated.ts`.
- 4.2 spike: **array preserved, no `findingsJson`.** `interpolateVariables` in `packages/core/src/modules/workflows/lib/activity-executor.ts` returns the typed value when the string is exactly one `{{…}}` token; UPDATE_ENTITY configs pass through `interpolateActivityConfig` (inline `executeActivityByType` and queued enqueue path) before `executeUpdateEntity`. Caveat: text around the token stringifies. Docs `apps/docs/docs/user-guide/documents-review.mdx` + sidebar entry; spec updated (phase status, R11 outcome, Consumer Guidance, changelog).
- 4.3: `__integration__/TC-DOC-AGENT-001.spec.ts` (stubbed agent outcome in `initialContext.review`, tenant enablement through `PUT /api/workflows/command-settings` with restore in `finally`, UPDATE_ENTITY ingest, keep → audit log shows `documents.review.cleared`, test sends `documents_review_cleared` by correlation key, run completes).

## Validation (local runner)
- Phase 3: `yarn workspace @open-mercato/documents typecheck` pass; `cd packages/documents && npx jest --config jest.config.cjs` 167 suites passed (1 skipped), 1177 tests passed (5 skipped); eslint on touched files 0 errors (2 pre-existing-style `import/no-anonymous-default-export` warnings); DS grep on new UI: no hardcoded status colours, arbitrary values or `dark:` overrides; severity badges carry icon + text; icon-only buttons have `aria-label`.
- Phase 3 integration: one attempt `yarn mercato test:integration TC-DOC-PLAY` failed in `yarn run initialize` with an esbuild Go runtime crash (environment, unrelated to documents). TC-DOC-PLAY-001..004 are written but not executed.
- `yarn workspace @open-mercato/documents typecheck` — pass.
- `cd packages/documents && npx jest --config jest.config.cjs` — 165 suites passed (1 skipped), 1151 tests passed (5 skipped).
- eslint on touched files — 0 errors (1 pre-existing warning in `useDocumentEditor.ts`).
- DS guardian review on touched UI files — no hardcoded status colours, arbitrary values, `dark:` overrides or inline `<svg>`; icon-only Locate button has `aria-label`; revert notice uses `Alert`, Keep note uses `FormField`.

## Next
- Run TC-DOC-FIND-001..010 in a healthy env: `OM_OPTIMISTIC_LOCK=all yarn mercato test:integration TC-DOC-FIND` (UI specs need the collab sidecar; they call `ensureManagedCollabSidecar`).
- Spec `.ai/specs/2026-11-11-documents-ai-review-findings.md` UI details need aligning (out of this run's file scope): see Deviations.
- Run TC-DOC-AGENT-001 in a healthy env (`yarn mercato test:integration TC-DOC-AGENT`).
- Phase 5: full validation gate, draft PR.
- Run TC-DOC-PLAY-001..004 in a healthy env (`yarn mercato test:integration TC-DOC-PLAY`).
- Align the spec with the Phase 3 deviations below (spec file is outside this run's file scope).

## Deviations from the spec (Phase 2)
- Side rail: tabs are Changes | Comments only; Versions stays the existing header toggle panel (unchanged behavior). Comments tab shows no count (count lives inside `CommentsRail`).
- Summary is fetched on page mount for editors (open count + default tab); the findings list is fetched only when the Changes tab first opens, and the panel stays mounted afterwards so decorations persist.
- Review header: "Reviewed by {source} · Sections flagged: {n} · {time}" — no agent/playbook until Phase 3/4; workflow instance links to `/backend/instances/{id}`, agent run id is plain text.
- `OutlinePane` takes an optional `findingCountsByHeading`; by default it derives counts from the decoration plugin state (avoids threading props through the editor island).
- Anchors resolve only with the collaboration transport; in single-user fallback located findings show "Text changed since the review" and Apply is disabled.

## Gotchas
- Integration run blocked (one attempt): `yarn mercato test:integration` failed in initialize — `Cannot find package '@open-mercato/gateway-autopay' imported from apps/mercato/.mercato/generated/di.generated.mjs` (environment/generated registry, unrelated to documents). Phase 1 attempt hit an esbuild crash.
- Anchoring uses `@tiptap/y-tiptap`, same ProseMirror binding as the editor.
- Below-editor tier gets 404 on findings routes.
- Undo of a decision/ingest never emits `documents.review.cleared`.

## Deviations from the spec (Phase 4)
- Guidance items from `documents.get_review_playbook` carry `truncated` (additive); the tool returns only an active playbook and active rules.
- A document without collaboration state is returned as one paragraph block from its stored plain text (findings on it stay unlocated until the document is opened in the editor).
- A clean review (no blocking findings) emits `documents.review.cleared` at ingest, before a consumer run reaches its wait step — documented in the user guide and Consumer Guidance.

## Deviations from the spec (Phase 3)
- Rule and guidance-reference changes bump the playbook `version` through a native update that leaves the playbook `updated_at` untouched, so a rule edit never invalidates an open playbook form (playbook field edits still bump both). Guidance link/unlink also bumps the version (it changes what the reviewer reads); the spec only names rule changes.
- Undo never decrements `version` (monotonic; undo is itself a change and bumps it).
- Reference POST for a document the caller cannot view answers 404 (not 403), matching the findings non-disclosure choice.
- Duplicate codes answer 409, caps answer 422; error bodies carry `code` = the i18n key and a translated `error`.
- Admin menu entry sits in the Documents nav group next to Templates (the module has no separate settings section).
- `setup.ts` unchanged: admin already holds `documents.*`; employees do not get the manage feature by default.
