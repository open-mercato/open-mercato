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

## Validation (local runner)
- `yarn workspace @open-mercato/documents typecheck` — pass.
- `cd packages/documents && npx jest --config jest.config.cjs` — 165 suites passed (1 skipped), 1151 tests passed (5 skipped).
- eslint on touched files — 0 errors (1 pre-existing warning in `useDocumentEditor.ts`).
- DS guardian review on touched UI files — no hardcoded status colours, arbitrary values, `dark:` overrides or inline `<svg>`; icon-only Locate button has `aria-label`; revert notice uses `Alert`, Keep note uses `FormField`.

## Next
- Run TC-DOC-FIND-001..010 in a healthy env: `OM_OPTIMISTIC_LOCK=all yarn mercato test:integration TC-DOC-FIND` (UI specs need the collab sidecar; they call `ensureManagedCollabSidecar`).
- Spec `.ai/specs/2026-11-11-documents-ai-review-findings.md` UI details need aligning (out of this run's file scope): see Deviations.
- Phase 3 (step 3.1): playbooks.

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
