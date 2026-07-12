# Pre-Implementation Analysis: Documents ecosystem integration — M7 reliability and fidelity

## Executive Summary

The M7 follow-up is architecturally ready: all production changes remain in `@open-mercato/documents`, add no dependency or schema, and extend only an existing Documents response additively. The load-bearing risks are reconnect state correctness, non-mutating browser pagination, current peer-record authorization, and export fidelity/security; each now has an explicit mitigation and focused test path. The user explicitly waived the unavailable Kimi gate; implementation proceeds with focused verification and a fresh Codex review.

## Backward Compatibility

### Contract Surface Audit

| # | Surface | M7 impact | Verdict / required protection |
|---|---|---|---|
| 1 | Auto-discovery file conventions | New helpers/components/tests only; no discovery file is renamed or removed. | Compatible. |
| 2 | Type definitions and interfaces | Internal connection status gains `reconnecting`; related-record normalization accepts an additive `values` object. | Compatible if existing states/fields remain supported. |
| 3 | Function signatures | Existing exported route/renderer functions retain current required arguments; PDF options widen internally. | Compatible; use optional/additive fields only. |
| 4 | Import paths | No existing file moves and no public re-export is removed. | Compatible. |
| 5 | Event IDs | No event additions, removals, or payload changes. | Compatible. |
| 6 | Widget spot IDs | No spot or widget contract changes. | Compatible. |
| 7 | API route URLs | Existing links/export URLs remain; `GET /api/documents/:id/links` adds `values`. | Compatible only as an additive response field; restricted items must use an empty/omitted object, not expose IDs. |
| 8 | Database schema | No migration or stored-field change. | Compatible. |
| 9 | DI service names | No DI changes. | Compatible. |
| 10 | ACL feature IDs | Existing Documents and peer feature checks are reused. | Compatible; no exact-match shortcut may replace wildcard-aware checks. |
| 11 | Notification type IDs | No change. | Compatible. |
| 12 | CLI commands | No change. | Compatible. |
| 13 | Generated file contracts | No discovery/generator change is required. | Compatible; do not run or commit unrelated generated churn. |

### Violations Found

No breaking contract violation is proposed.

### Migration and Backward Compatibility

No data migration is required. Existing links without `values` continue to normalize and render label/open/unlink actions. Existing stored HTML/Yjs content has no pagination markers, and the new local decoration layer must preserve that invariant.

## Spec Completeness

### Missing Sections

| Section | Impact | Recommendation |
|---|---|---|
| Formal final compliance report | Reviewers need an auditable closeout after implementation. | Append the scoped Documents verification, DS review, preview evidence, and cross-model verdicts to the spec before staging. |

### Incomplete Sections

| Section | Gap | Recommendation |
|---|---|---|
| Realtime error semantics | Hocuspocus reports authentication failure for both a rejected token and a token callback exception. | Track the last token-fetch result locally so definitive 401/403 enters fallback while transport/5xx retains the Y.Doc and retries. Test both paths. |
| Pagination oversized blocks | A table/image/paragraph taller than one printable page cannot be split safely by a boundary-only decoration. | Keep it as an explicit best-effort editor limitation; never loop decorations inside one node. Chromium remains export authority. |
| Record snapshot disclosure | Field extraction can copy contact or commercial data into a document shared more broadly than its source. | Require explicit field selection and explanatory copy; never preselect unavailable/empty values and revalidate immediately before opening. |

## AGENTS.md Compliance

### Compliance Review

| Rule | Result | Implementation requirement |
|---|---|---|
| Module independence | Pass | Reuse authenticated peer HTTP verification and typed IDs; do not import peer entities/services or add ORM relationships. |
| Own UI uses direct composition | Pass | Field insertion and pagination belong directly in Documents editor/panel, not self-injected widgets. |
| Backend HTTP and mutation guards | Pass | Links remain `apiCall`/`apiCallOrThrow`; no new write route is required. |
| Optimistic locking | Pass | No new persisted mutation. Existing link create/delete protections remain unchanged. |
| Dialog UX | Pass with implementation check | Field dialog must support Escape and Cmd/Ctrl+Enter and use shared primitives. |
| i18n | Pass with implementation check | Add every new status/action/help/error key to en/de/es/pl and use `useT()`. |
| Design system | Pass with implementation check | Use semantic status tokens, shared Button/Dialog/Checkbox primitives, Lucide icons, and no arbitrary Tailwind values. A4 millimetre geometry belongs in module CSS, not arbitrary utility classes. |
| Realtime authorization | Pass | Preserve tenant/org scope, room invalidation, active 15-second reauthorization, short token TTL, and fatal revocation. |
| Integration testing | Pass with implementation check | Use Documents-local fixtures and cleanup; run only affected Documents scenarios per explicit user scope. |

### Violations

No planned AGENTS.md violation remains. A CSS-only fake page background would violate the functional acceptance criteria because text could cross a painted gutter; the chosen decoration approach avoids that false implementation.

## Risk Assessment

### High Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Token rollover/fetch classification destroys a live Y.Doc on a transient failure | Queued edits can disappear into read-only fallback or collaboration remains unavailable. | Explicit transient/fatal state, fake-timer/provider-event tests, and two-client testing over two rollover cycles plus sidecar restart. |
| Pagination plugin writes measurements into shared state or dispatches a loop | Cross-client divergence, undo pollution, cursor jumps, or high CPU. | Decoration-only plugin, metadata-only/coalesced recompute, `addToHistory: false`, ResizeObserver cleanup, pure break calculator, and serialization/Yjs assertions. |
| Record fields bypass current peer authorization | Cross-tenant/organization or revoked-data disclosure. | Reuse `verifyEntityRegistryTargetAccess` on refreshed GET, return only declared token fields, and expose no values/ID/href on any denial. |

### Medium Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Rich PDF CSS weakens the inert renderer boundary | Authored HTML could regain active/network behavior. | Constant server-owned CSS only; keep sanitization, CSP, JavaScript disablement, interception, raster bounds, timeout, concurrency, and byte cap unchanged. |
| Visual page layout differs slightly from Chromium | Editor gutters and exported page breaks do not match exactly. | Share A4 width/margins, document the block-boundary approximation, and visually inspect mixed multi-page output. |
| Additive link values increase response cost | Related panel loads become slower across many links. | Existing bounded link count and four-worker verification remain; return only small allowlisted strings, never raw records. |
| Snapshot insertion copies PII/commercial data into a wider document audience | Authorized copying can outlive peer access. | Explicit subset selection and disclosure text; static snapshot semantics documented and tested. |

### Low Risks

| Risk | Impact | Mitigation |
|---|---|---|
| New translated labels are incomplete or low quality | Mixed-language or hardcoded UI. | Locale completeness/value tests for all four locale files. |
| PDF title changes output pagination | Existing PDF page count changes. | Expected intentional fidelity change; URLs/MIME/errors remain stable and tests assert semantics, not old byte/page count. |

## Gap Analysis

### Critical Gaps (Block Implementation)

None. The user explicitly waived the unavailable Kimi gate for this continuation.

### Important Gaps (Should Address)

- Define exact provider reconnect constants and state-transition timing in code next to the pure status reducer so tests do not depend on magic numbers.
- Keep the PDF HTML builder exported for focused semantic/CSP tests without exporting it as a package public API.
- Refresh a related record before field selection rather than trusting values already present in React state.
- Keep page calculations bounded and stable when a single node is taller than the printable area.

### Nice-to-Have Gaps

- A future explicit manual page-break node may be useful, but it is not required for M7 and should not be mixed into automatic measurement.
- Live-bound record fields are intentionally deferred; snapshot insertion is safer and deterministic for sharing, versions, DOCX, and PDF.
- Authenticated attachment-image export is intentionally deferred. The current inert PDF boundary strips every URL-backed image and never forwards credentials; M7 must not weaken that policy while fixing typography and tables.
- Relation rows and inline entity chips intentionally have independent lifecycles. Chip edits are collaborative content edits; only the explicit related-panel Unlink command removes discovery metadata.

## Remediation Plan

### Before Implementation (Must Do)

1. Record the exact reconnect timing constants and fatal/transient token-fetch decision in the implementation checklist.

### During Implementation (Add to Spec)

1. Realtime: add a pure tested status controller, fast bounded provider retry, and cleanup-safe timers without changing server authorization.
2. PDF: add the inert A4 builder and visual render gate while retaining every existing resource/security boundary.
3. Pagination: add a local decoration plugin and prove it cannot serialize or enter undo/Yjs state.
4. Record fields: add the verified response projection, refreshed explicit-selection dialog, and native ProseMirror snapshot insertion.

### Post-Implementation (Follow Up)

1. Run only Documents package typecheck/unit/build, affected Documents integrations, two-browser rollover/outage QA, and `pdftoppm` page inspection.
2. Run a fresh Codex review; stage only Documents/spec files. The unavailable Kimi gate remains explicitly waived by the user.
3. Append final compliance/verdict evidence to the spec.

## Recommendation

Ready to implement under the user's explicit Kimi waiver. There is no architecture, backward-compatibility, dependency, migration, or cross-module blocker in the M7 design itself.
