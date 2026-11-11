# Handoff

## Done (Phase 1 — findings core)

- 1.1 `523b1ddce3` `DocumentFinding` entity (`document_findings`, no playbook/rule FK columns yet), validators (`findingIngestSchema`, `findingIngestCommandSchema`, apply/keep/reopen/list schemas), caps in `lib/resourceLimits.ts`, migration `Migration20261111231158_documents.ts` + snapshot.
- 1.2 `dca9ac331b` `lib/reviewContent.ts` (Yjs state -> ordered blocks with section labels) and `lib/findingAnchors.ts` (normalized quote match, occurrence, section-first search, one parse per batch). Unit tests: `__tests__/findingAnchors.test.ts`.
- 1.3 `9c555d1e8f` `commands/findings.ts` (`documents.finding.ingest|apply|keep|reopen`, undo + redo), events in `events.ts`, `lib/findingSummary.ts`, projection + archived-undo interceptors, i18n keys (en/pl/de/es/ko). Unit tests: `__tests__/findingCommands.test.ts`.
- 1.4 `930f64b722` Routes `api/[id]/findings/**` + shared helper `api/_findings.ts`; unit test `__tests__/findingsRouteAccess.test.ts`.
- 1.5 `3ec9c8063e` Integration tests `__integration__/TC-DOC-FIND-001..006.spec.ts` + `helpers/findingsFixtures.ts`.

## Next

- Run TC-DOC-FIND-001..006 in a healthy ephemeral env: `OM_OPTIMISTIC_LOCK=all yarn mercato test:integration TC-DOC-FIND`.
- Phase 2 (step 2.1): editor UI (Changes tab, cards, `useDocumentFindings`).

## Gotchas

- Integration run was blocked locally: `yarn run initialize` failed inside the ephemeral runner (first a stale `packages/*/dist`, then after `yarn build:packages` an esbuild crash with a Go goroutine dump). Port 5001 is held by another checkout's dev server; the runner falls back to a random port.
- Anchoring uses `@tiptap/y-tiptap` (what the editor's Collaboration extension and `CommentAnchorNavigation.ts` use), not `y-prosemirror`, so positions share the editor's ProseMirror instance. Same API (`initProseMirrorDoc`, `absolutePositionToRelativePosition`).
- `documents.review.cleared` observability: decision/ingest commands record `context.emittedEvents` in the action log; TC-DOC-FIND-004 asserts through `/api/audit_logs/audit-logs/actions`.
- Undo of a decision/ingest never emits `documents.review.cleared` (projections are precomputed at execute time); consumers must confirm with `/findings/summary`.
- Ingest command accepts optional `tenantId`/`organizationId`/`findingIds` (resolved from ctx when absent) so the Phase 4 workflow can call it with `findingIngestCommandSchema` shape.
- Below-editor tier returns 404 on findings routes (rest of the module returns 403 for tier denials).
