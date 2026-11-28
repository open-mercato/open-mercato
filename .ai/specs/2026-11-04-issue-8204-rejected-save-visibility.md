# Rejected-save message visibility (#8204)

## TLDR
Bring the actual rejection message into view and give it accessible focus when a save fails in a long CrudForm page, embedded dialog, or staff task drawer. Reuse existing error/alert components and a small shared UI helper. Successful saves do not move focus or scroll.

## Scope
Shared UI rejection visibility, CrudForm errors and the staff TaskDrawer notices already used for claim races and stale changes. Existing conflict UI remains authoritative. No APIs, schema, permission rules, Markdown inputs, DataTable, audit logs, or other module implementations change.

## Resolved assumptions (autonomous defaults)
- One capability spans the shared helper and its real consumers; splitting would leave inconsistent rejection behavior.
- Move immediately to the existing explanatory message, with keyboard focus and alert semantics; do not duplicate messages in floating UI.
- Only explicit rejected attempts trigger visibility. Editing, background refreshes, initial loading errors, and successful saves do not.
- Preserve field validation, mutation guards, optimistic locking, translations, and existing public signatures.

## Implementation Plan
1. Add shared focus/reveal behavior and unit coverage.
2. Integrate CrudForm, shared conflict messages where needed, and TaskDrawer with regression coverage.
3. Add self-contained browser integration coverage for long pages, dialogs, claim rejection, stale status, and success; run validation and review.

## Overview and Problem Statement
An operator saving near the bottom of a long surface can miss the existing rejection above the viewport. In main, CrudForm focuses some field errors and scrolls only injection failures; its generic submit message has no focus target. TaskDrawer renders claim/stale-edit alerts at the top of its scrollable body. #7421 merged on 2026-10-29; the issue asks for a new consistent shared interaction, not changes to server concurrency.

## Proposed Solution and Architecture
Add a small client hook under `packages/ui/src/backend/utils` that receives an error element ref and a rejection identity. After React commits the message, reveal it using native `scrollIntoView` with immediate start alignment (with scroll margin for surrounding chrome) and focus with `preventScroll`. Cancel scheduled work when the surface unmounts or a newer rejection supersedes it. Native ancestor scrolling supports both document and nested modal/body scroll containers without changing primitive APIs.

CrudForm renders the existing ErrorMessage for top-level rejection text, including injection-only messages, and marks a rejected submission with a new identity so identical repeated errors are reachable again. Field validation remains inline and existing collapsed-group expansion is preserved. Reveal the explanatory message after rejection; avoid triggering on ordinary field editing/blur. TaskDrawer attaches the same behavior to its existing Alert and uses each notice object as the rejection identity, including repeated identical claim failures. Retain the shared conflict store/banner, guard callbacks, request headers and server message translation.

## UI / UX
The same translated reason stays rendered in the original form/drawer. On rejection it becomes visible and receives programmatic focus (`tabIndex=-1`, alert semantics). Users can then tab through the nearby controls or return to fields. No new toast/overlay system, no custom scroll-container traversal and no animation (including reduced-motion users). Success does not invoke the helper. Dialog shortcuts and Escape behavior are unchanged. Existing Alert and ErrorMessage styling and semantic tokens are reused.

## Data Models and API Contracts
No entity, migration, request/response, endpoint, permission, event, DI, or persisted data changes. Existing backend failures remain authoritative. New tests exercise existing staff task/claim/status APIs through isolated fixtures or deterministic rejected responses; no production test endpoint is introduced.

## Migration & Backward Compatibility
Existing component props, exports, hook/event signatures, route names, widget spots, error message parsing and mutation guards remain intact. The new helper is additive; any optional ErrorMessage focus support defaults off. Consumers require no migration. The requested interaction change affects only failed submissions/explicit drawer notices; success, mount-time errors, and field editing retain prior behavior.

## Frontend Architecture Contract
Existing server page roots and providers are unchanged. CrudForm and TaskDrawer remain their current client islands (forms and event handlers); the helper uses browser focus/scroll APIs only in an effect. Existing large components gain small call sites instead of a new root/provider or heavy dependency. Budget: zero new client page roots, providers, libraries, API requests, or polling listeners; helper under 80 lines. Verify route load and rejection interaction in Playwright plus scoped Jest and package build. No performance-sensitive data path changes.

## Integration Coverage
| Surface | Scenario | Required evidence |
| --- | --- | --- |
| Long CrudForm page | Required/invalid data and server refusal while scrolled to Save; repeat same refusal | Actual message in viewport, focus/alert semantics; existing field errors retained |
| Embedded CrudForm dialog | Save below fold rejected by server/injection | Actual message visible inside modal and receives focus |
| Staff board/support task drawer | Claim returns already-taken error | Existing specific notice visible and focused from Properties |
| Staff task drawer | Outdated status PATCH rejected | Existing refreshed-version notice visible and focused |
| All surfaces | Successful save | No error reveal/focus/scroll |

Fixtures create their own project/task records and clean them in finally. Assertions measure viewport/container intersection, not merely DOM visibility. Unit coverage also proves repeat failures, cleanup, no mount/success activation, unchanged editing focus, and translated server/injection failures. No affected API implementation changes, so existing API regression suites remain the concurrency authority.

## Risks & Impact Review
| Risk | Severity / affected area | Mitigation | Residual risk |
| --- | --- | --- | --- |
| Focus theft while typing | Medium / all forms | Trigger only rejected attempt identities, not error object churn | Third-party custom fields may manage focus themselves; exercise representative field errors |
| Off-screen message inside nested scroll area | Medium / dialogs and drawers | Native ancestor scrolling after commit; browser bounding-box assertion | Oversized error text may exceed viewport; first explanatory content must be visible; use start alignment even for oversized errors and assert its top is inside the visible region |
| Duplicate conflict surfaces compete for focus | Medium / optimistic locks | Consumer's actual inline rejection remains focus owner; do not change global banner focus | Existing banner remains visible separately |
| Same message does not retrigger | Medium / retries | New rejection/notice identity rather than text-only dependency | Regression tests repeat identical responses |
| Surface closes before scheduled reveal | Low / modal lifecycle | Cancel animation frame on cleanup; check connected node | None known |

## Final Compliance Report
Scope is one capability implemented at existing consumers. Reuses CrudForm, ErrorMessage and Alert; no primitive/governance changes. Tenant isolation, permission checks, encryption, command/undo effects and optimistic-lock headers are unchanged. No new data or service wiring means data-security/DI/cache migrations are not applicable. Accessibility and success behavior have explicit tests. Validation uses local runner because no compose app was running.

## Changelog
- 2026-11-04: Autonomous skeleton, code research and implementation design for #8204. No blocking product unknowns; assumptions recorded above.

### Review — 2026-11-04
- Independent scope review: one cohesive capability; approved after changing centered scrolling to start alignment so oversized error beginnings remain visible.
- Security / performance / cache / commands: unchanged; no new data path or runtime dependencies.
- Risks: explicit attempt identities, cancellation and browser viewport assertions address focus/visibility failures.
- Design references: native scrollIntoView supports ancestor containers (https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollIntoView); alert semantics follow WAI ARIA19 (https://www.w3.org/WAI/WCAG22/Techniques/aria/ARIA19).
- Verdict: Approved for implementation.
- Current-app screenshots unavailable at specification time: fresh worktree has no active app descriptor and immutable dependency installation is still running. Proposed interaction reuses existing message components with no visual redesign; browser evidence is required for the implementation.
