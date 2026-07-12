# Documents ecosystem integration

- **Date:** 2026-07-09
- **Status:** M6-M7 implemented; review remediations and repository verification complete
- **Package:** `@open-mercato/documents`
- **Module id:** `documents`
- **Baseline:** `2026-07-08-documents-collaborative-editor.md` (M1-M5)

## Goal

Make Documents a first-class Open Mercato work surface instead of a generic rich-text editor. Users must be able to find business records by human-readable labels, link them to documents, create documents from contextual templates, preview content safely, and discover related documents from the records they already use.

The milestone must remain module-owned. It may use existing public Open Mercato contracts and the standard create-app template wiring needed to ship the package, but it must not redesign Core, Search, AI Assistant, Events, storage providers, or unrelated application APIs.

## User outcomes

1. A user can search for and select a person, company, deal, product, catalog offer, quote, or order without typing an ID.
2. Selected records appear as readable links/chips in a document and remain tenant/organization and permission scoped.
3. Existing customer, deal, catalog, quote, and order pages can show related documents through module injection.
4. A user can create a contextual document from a template, preview the filled result, and then add free-form text.
5. A user can preview a document or historical version without entering edit mode.
6. Comments remain anchored through collaborative edits and degrade to a readable fallback when their range is deleted.
7. No user-facing picker, history row, related-record card, presence label, or fallback exposes a raw UUID/GUID.
8. Normal collaboration token rollover does not flash a false unavailable state or interrupt editing for a visible period.
9. PDF exports render the document title, typography, lists, tables, safe embedded raster images, and record chips with A4 print styling; authenticated URL images remain omitted by policy.
10. Edit and preview modes show stable A4-like page boundaries without persisting browser measurements into collaborative content.
11. A user can insert a safe subset of current, authorized peer-record fields into a document without copying IDs or retyping data.
12. A dormant remote caret remains identifiable: hovering or focusing its colored marker reveals the collaborator's safe display name without exposing an identifier.

## Scope

### Entity links

Documents owns `DocumentEntityLink`; it stores typed identifiers and a label snapshot without direct ORM relationships to peer modules. Supported types are:

- `customer-person`
- `customer-company`
- `deal`
- `product`
- `catalog-offer`
- `quote`
- `sales-order`

The registry declares the owning module, required feature, search endpoint, canonical backend href, readable mapping, and template token fields for each type. Missing modules or features make an entry unavailable; they never widen access.

Link creation and deletion use Documents commands, optimistic locking, tenant/organization scoping, and additive Documents events. A link never grants access to either the document or the peer record.

The relation row and an inline chip are intentionally not mirror copies. `DocumentEntityLink` drives related-record discovery and may exist without an inline chip (`related-panel`/template sources); an inline chip is a static content snapshot that may be copied, moved, or deleted like text. Deleting a chip therefore does not unlink the document, and unlinking a relation does not rewrite historical collaborative content. The explicit panel Unlink action is the sole relation-removal command.

### Label-first selectors

All business-record selection is search-based and bounded. Picker results contain an opaque ID for the mutation plus a human label and optional secondary text for display. The UI must not ask users to paste IDs.

Display mapping rejects identifier-shaped labels and has no ID fallback. Results that cannot produce a safe label are omitted or shown with a localized neutral label where omission would make an existing record impossible to manage.

### Related Documents widgets

Documents injects a related-documents panel into supported host record pages using the module extension system. The widget:

- receives typed host context;
- queries only Documents-owned link routes;
- applies the caller's Documents and peer-record permissions;
- renders document titles rather than IDs;
- supports opening an existing document and creating a contextual document;
- degrades cleanly when Documents or the peer module is unavailable.

No peer module imports Documents code and no peer database table is changed.

### Contextual templates

Templates support typed context slots. Preview resolves selected records server-side, renders readable values and chips, and reports missing required slots before creation. Instantiation atomically creates the document aggregate and links using the same resolved snapshot used for preview.

Default templates are seeded idempotently:

- Offer letter
- Meeting notes
- Deal summary
- Customer meeting brief
- Deal proposal
- Quote cover letter
- Order handoff
- Product brief

Template list endpoints are paginated and support summary-only responses so list views do not download every body. Template detail and preview are loaded only when requested.

### Preview and history

The editor exposes an explicit preview/read-only mode. Version history provides sanitized previews and readable author labels. Restores remain protected by document-level authorization and optimistic locking and use the existing collaboration epoch-reset behavior.

### Durable comment anchors

New comments store Yjs relative positions alongside the historical absolute offsets. Relative positions are resolved against the current collaborative document, while old comments remain readable through the legacy fallback. A deleted range produces an explicit unavailable-anchor state rather than navigating to an unrelated offset.

### Collaboration and deployment

The standalone collaboration sidecar is compiled as part of the Documents package and exported as a production entry. The create-app template:

- installs and enables `@open-mercato/documents`;
- exposes `yarn documents:collab`;
- includes the Documents environment variables;
- includes a separate sidecar service in development and production Compose templates;
- externalizes the package's server-only export dependencies in Next.js.

The v2 collaboration token uses a dedicated secret of at least 32 UTF-8 bytes. Production requires an exact trusted browser origin and a browser-reachable WebSocket URL.

## Architecture boundaries

- All persistence, API routes, commands, widgets, registry adapters, templates, and UI live in `packages/documents`.
- The only non-module source changes are the app and create-app template files required to install, enable, configure, and run Documents.
- Cross-module records are referenced by typed IDs and label snapshots, never ORM relationships.
- Peer reads use existing authenticated APIs or existing module services; credentials and storage details never cross into Documents.
- Global document search remains disabled until the platform provides record-level result ACL filtering.
- Existing M1-M5 attachment behavior is preserved. This milestone does not add generic attachment policies, provider namespace rules, storage migrations, or Core attachment commands.
- This milestone does not change AI Assistant pending actions, audit-log identity contracts, Search presentation, S3 behavior, generic API body handling, or shared event definitions.

## Data changes

Additive Documents-owned schema only:

- `document_entity_links` for typed peer links and readable snapshots;
- template seed identity and context-slot support;
- relative comment-anchor fields and migration/backfill support;
- supporting indexes and optimistic-lock timestamps.

Migrations must have a reversible down path for Documents-owned schema. No migration may update a Core-owned table.

## API additions and changes

- `GET/POST /api/documents/:id/links`
- `DELETE /api/documents/:id/links/:linkId`
- `GET /api/documents/:id/principals`
- `POST /api/documents/instantiate`
- `GET /api/documents/templates/:templateId`
- `POST /api/documents/templates/:templateId/preview`
- `GET /api/documents/:id/versions/:versionId`
- capability projections on document and collection responses
- bounded template list filters and summary mode
- additive `values` snapshots on accessible `GET /api/documents/:id/links` items, restricted to the selected entity type's declared `tokenFields`

All routes are authenticated, tenant/organization scoped, feature checked, per-document capability checked where applicable, and use optimistic locking for mutations.

## Migration & Backward Compatibility

- Existing M1-M5 routes and response fields remain available.
- Existing templates and comments remain readable.
- Existing absolute comment anchors remain supported.
- New fields and routes are additive.
- Persisted entity type strings, event IDs, widget spot IDs, and ACL feature IDs are not renamed.
- Ownership remains a relationship; action features still gate edit/share/delete operations.
- The links response extension is additive; existing fields, URLs, stored HTML, and Yjs schema remain unchanged.
- Pagination is presentation-only and never enters Yjs state, versions, exports, comments, undo history, or event payloads.
- The reviewed attachment remediation adds the `attachmentService` DI key and
  public `AttachmentService` type additively. Existing attachment APIs, entity
  shapes, driver registrations, routes, ACL IDs, and storage layouts are
  unchanged; existing consumers may continue using their current contracts.
- Documents resolves the new service fail-closed. No data migration or stored
  attachment backfill is required.
- The Auth, API Keys, and Directory modules expose additive, request-scoped DI
  read services for principal and organization-scope resolution. Existing
  entities, RBAC methods, routes, ACL identifiers, and authentication payloads
  remain unchanged.
- Trusted event emit options add optional tenant and organization fields. This
  is source- and runtime-compatible with existing emitters; Documents requires
  those fields only for its own projections.
- Operational upgrade path: all documents env vars are OPTIONAL with `:-`
  defaults in every compose file (`APP_URL` keeps its `http://localhost:3000`
  default; a regression test forbids `:?` interpolation, which would break
  every `docker compose` command for unconfigured users). Unset collab vars
  degrade gracefully: the editor works, collaboration falls back to
  single-user mode, and the collab-token route returns `url: null` instead of
  erroring. Production Docker builds accept an unset collab URL and reject
  only set-but-loopback values. PDF export requires Chromium in the runtime
  image; the `INSTALL_CHROMIUM=1` build arg (default on) allows slim builds
  where export returns a graceful 503. The `documents-collab` sidecar receives
  `TENANT_DATA_ENCRYPTION_KEY` and `REDIS_URL` passthrough. All of this is
  recorded in `UPGRADE_NOTES.md`.

## Security and privacy

- Never trust a client-provided label, href, template value, capability, tenant, or organization.
- Resolve peer records within the authenticated scope before preview or instantiation.
- Redact or omit links when the peer module, feature, or record is unavailable.
- Sanitize template and version previews before rendering.
- Keep Yjs state, HTML bodies, encrypted values, and raw IDs out of event and audit payloads.
- Bound picker pages, templates, links, versions, comments, and collaboration frames.
- Treat UUIDs as internal mutation identifiers only; never use them as display fallbacks.
- Revalidate a linked peer record immediately before offering field insertion. A restricted or unavailable target returns no values.
- Inserted peer values are deliberate static snapshots. Later source-record changes or revocation prevent future extraction but cannot retract text already copied into a shared document.

## M7 follow-up — reliability, print fidelity, paginated canvas, and record fields

### Confirmed problems and causes

1. **Periodic realtime interruption.** The collaboration sidecar retires a socket at the approximately 60-second handshake-token expiry. Hocuspocus then reconnects with a fresh token, but its default exponential retry can keep the client disconnected for seconds. The client maps every raw status other than `connected`, including the normal `connecting` transition, directly to `offline`, producing the observed `Live -> Realtime unavailable -> Live` cycle.
2. **Unstyled PDF.** The export route passes sanitized content to Chromium in an otherwise bare HTML body. The title exists only as `<title>` metadata, and the Tailwind selectors that style headings, lists, tables, and entity chips in the editor are not present in the isolated renderer.
3. **Unbounded editor surface.** `DocumentCanvas` renders one continuously growing article. There is no page geometry or local pagination layer.
4. **Authorized record values are discarded.** The entity registry and picker already produce allowlisted `tokenFields`, and server verification already returns current authorized `values`. Editor insertion ignores picker values, while the related-links response reduces server verification to ID, label, and href.

### Realtime design

- Preserve the short-lived handshake token, server-side expiry retirement, 15-second active authorization refresh, and fatal authentication fallback.
- Configure the module-owned Hocuspocus provider for a fast bounded reconnect after deliberate rollover while retaining unlimited retries for genuine network recovery.
- Add an internal `reconnecting` UI state. A sub-second disconnect keeps the last stable Live presentation; a longer retry shows `Reconnecting`; only a sustained outage becomes `Offline`/unavailable.
- Treat initial timeout and definitive authentication rejection as read-only fallback. A transient transport or token-endpoint failure must retain the Y.Doc and queued local edits so a later reconnect can recover.
- Clear every reconnect/offline timer on `connected`, `synced`, unmount, document change, or fatal fallback. Permission downgrade still updates `serverReadOnly` from a freshly minted token and active server authorization remains fail-closed.
- Keep remote caret labels available after the collaborator stops typing. The compact colored marker exposes the same sanitized collaborator name on hover or keyboard focus; it never falls back to an internal identifier.

### PDF design

- Add a Documents-owned PDF HTML builder with inert inline CSS, system fonts, visible escaped title, A4 `@page` size/margins, and selectors for every supported editor node.
- Tables use collapsed borders, padded cells, header background, repeated header groups, row break avoidance, and safe wrapping. Lists, task lists, headings, blockquotes, code, links, safe embedded raster images, highlights, alignment, and entity references retain readable semantics.
- Chromium uses `preferCSSPageSize: true` with the existing `format: 'A4'`, JavaScript-disabled runtime, request interception, embedded-image validation, concurrency limits, timeout, and output-size limit.
- Existing security policy remains explicit: URL-backed/authenticated images are stripped before Chromium and the renderer never receives cookies, bearer tokens, presigned URLs, or network access. M7 does not add authenticated attachment export; doing that safely requires a separate design that reads a Documents-owned attachment server-side, enforces the document scope, applies raster bounds, and inlines bytes before rendering.
- DOCX behavior remains unchanged unless its existing focused tests prove that a shared helper is byte-for-byte compatible.

### Editor pagination design

- Use the already-installed `@tiptap/pm` decoration API; do not add a dependency or schema node.
- Render a fixed A4-width paper surface with consistent print-like margins. Narrow viewports scroll horizontally instead of changing page geometry.
- A local plugin measures top-level block boxes and inserts `aria-hidden`, non-editable widget decorations only at safe block boundaries. Each widget supplies the remaining bottom space, inter-page gutter, and next-page top margin.
- Recalculate through a coalesced animation-frame pass after document transactions, remote updates, editor resize, image load, or mode change. Metadata-only pagination transactions are excluded from undo history.
- Page decorations and measurements never serialize to ProseMirror JSON/HTML or Yjs. Oversized indivisible blocks may overflow one visual sheet; Chromium remains authoritative for exact export fragmentation.

### Related-record field insertion design

- Extend each accessible links response item with current `values` from `verifyEntityRegistryTargetAccess`. Only registry-declared `tokenFields` are returned. Restricted, deleted, disabled-module, feature-denied, or cross-scope targets expose no ID, href, or values.
- Add an `Insert data` action to accessible related-record cards and reuse the same flow immediately after toolbar record selection. Opening the field dialog refreshes the link/target so extraction never relies on a stale page-load snapshot.
- The dialog renders localized field labels and safe non-empty display values, supports explicit subset selection, `Escape`, and `Cmd/Ctrl+Enter`, and explains that inserted content becomes a document snapshot governed by document sharing.
- Insert native ProseMirror JSON, never interpolated HTML: either one selected `Label: value` paragraph or a two-column table for multiple fields, optionally adjacent to the existing entity chip. Hide insertion in preview, fallback, viewer, and revoked states.

### Acceptance criteria

- Two browser clients remain bidirectionally editable across at least two token rollovers with no `Realtime unavailable` flash during a successful fast reconnect.
- A sustained sidecar outage progresses predictably from Live to Reconnecting to Offline, queues local Yjs edits, and returns to Live after restart; fatal/revoked access becomes read-only.
- A mixed-format document exports a PDF whose rendered PNG pages visibly include the title, margins, heading hierarchy, list markers, table borders/header styling, and readable record chips. URL-backed images remain intentionally omitted under the existing inert-export policy.
- Adding and deleting enough content creates/removes visual A4 gutters in edit and preview without adding pagination markup to stored HTML or Yjs state.
- An authorized user can select some fields from a linked company, product/offer, deal, quote, or order and insert them at the current cursor. Restricted targets reveal neither values nor GUIDs.
- Hovering or focusing a remote collaborator's dormant caret reveals that collaborator's safe display name.

### Focused M7 coverage

- Unit/component: reconnect grace and cleanup; transient versus fatal token failures; collaborator caret hover/focus identity; PDF HTML/CSP/table selectors; Chromium CSS-page-size option; pure page-break calculation and non-serialization; link-value redaction; safe ProseMirror field/table insertion; dialog keyboard/read-only behavior; locale completeness and GUID regressions.
- `TC-DOCUMENTS-006`: render and inspect a styled multi-page PDF with a table and rich text.
- `TC-DOCUMENTS-013`: edit/preview A4 geometry parity and absence of persisted pagination markers.
- `TC-DOCUMENTS-016`: picker-time and related-panel insertion of authorized record field subsets.
- `TC-DOCUMENTS-017`: two-client token rollover, sustained sidecar interruption/recovery, and revocation behavior.
- Verification remains Documents-only: package typecheck, unit/component suite, package build, affected Documents integration specs, two-browser preview, and `pdftoppm` visual inspection. No repository-wide suite.

### Plan-fusion decision

Two independent Codex plans and a DeepSeek proposal agreed on a Documents-local status state machine, styled A4 PDF builder, presentation-only ProseMirror decorations, and static authorized record snapshots. The synthesized plan keeps server expiry retirement rather than weakening an existing security control, but adds fast reconnect and honest staged status. A CSS-only repeating background was rejected because text can cross a painted gutter; persisted page-break nodes were rejected because browser measurement would make shared Yjs content client-dependent. Live-bound record fields were rejected because exports would become nondeterministic and later peer-record changes could leak into more broadly shared documents.

## Test coverage

### Unit and component

- capability projections and owner/action-feature separation;
- entity registry availability, canonical links, safe labels, and type switching;
- picker keyboard, stale-response, pagination, and accessibility behavior;
- link command atomicity, optimistic locking, redaction, and undo/redo;
- template preview determinism, slot validation, bounded listings, and atomic instantiation;
- document/version preview sanitization and readable history labels;
- CRDT relative anchor encode/decode and legacy fallback;
- related-document widget context and readable labels;
- collaboration v2 token, origin, resource-limit, and room invalidation behavior;
- locale completeness and rendered UUID/GUID regression checks.

### Documents integration/preview

- `TC-DOCUMENTS-009`: capability, folder, token, and readiness behavior.
- `TC-DOCUMENTS-010`: typed links, redaction, reverse visibility, and undo.
- `TC-DOCUMENTS-011`: deterministic preview and atomic instantiation.
- `TC-DOCUMENTS-012`: safe version preview and restore.
- `TC-DOCUMENTS-013`: preview mode and capability-aware editor chrome.
- `TC-DOCUMENTS-014`: related Documents widgets on host records.
- `TC-DOCUMENTS-015`: durable anchors under concurrent edits and deletion.
- `TC-DOCUMENTS-016`: all seven label-first selectors and contextual templates.
- `TC-DOCUMENTS-017`: token rollover/recovery, paginated canvas, styled PDF, and authorized record-field insertion.

Integration fixtures must be created by the tests and cleaned up afterward. The feature gate is the Documents package build, typecheck, unit suite, and Documents integration directory only; repository-wide repair is explicitly out of scope.

## Expected change manifest

- `.ai/specs/2026-07-08-documents-collaborative-editor.md`
- `.ai/specs/2026-07-09-documents-ecosystem-integration-and-review.md`
- `.ai/specs/analysis/ANALYSIS-2026-07-09-documents-ecosystem-integration-and-review.md`
- `Dockerfile`
- `docker-compose.fullapp*.yml`
- `package.json`
- `apps/mercato/next.config.ts`
- `apps/mercato/package.json`
- `apps/mercato/src/modules.ts`
- `apps/mercato/types/html-to-docx/index.d.ts`
- `packages/documents/**`
- `packages/core/src/modules/attachments/{AGENTS.md,di.ts,index.ts,lib/attachment-service.ts}`
- `packages/core/src/modules/attachments/lib/__tests__/attachment-service.test.ts`
- `packages/core/src/modules/{auth,api_keys,directory}/{di.ts,services/**}`
- `packages/core/src/modules/directory/utils/organizationScope.ts`
- `packages/shared/src/lib/auth/principal-service.ts`
- `packages/shared/src/modules/events/types.ts`
- `packages/create-app/src/lib/apply-starter-preset.test.ts`
- `packages/create-app/template/.env.example`
- `packages/create-app/template/Dockerfile`
- `packages/create-app/template/docker-compose.fullapp*.yml`
- `packages/create-app/template/next.config.ts`
- `packages/create-app/template/package.json.template`
- `packages/create-app/template/src/modules.ts`
- `packages/create-app/template/types/html-to-docx/index.d.ts`
- `scripts/__tests__/{dockerfile-runtime-copy,fullapp-compose-app-allowed-origins}.test.mjs`
- `yarn.lock` (required workspace and direct/transitive dependency resolution for the new package)

Any further Core, Shared, Events, Search, AI Assistant, storage provider, apps/docs, or generic app API change requires an explicit reviewed seam. The user approved the narrowly scoped Auth, Directory, and Attachments public contracts on 2026-07-12; this spec records their additive compatibility requirements.

## Resolved architecture blocker

The user approved narrow public platform seams on 2026-07-12. Auth, API Keys,
Directory, and Attachments now own request-scoped DI services whose contracts
live in Shared or are consumed structurally. Documents no longer imports peer
module implementation code, and all missing-service paths fail closed. The
Notifications dependency continues to use its existing DI service.

## Verification status

- [x] Unrelated platform remediation removed from the working tree.
- [x] Documents typecheck passes against the unchanged platform.
- [x] Documents unit/component suite passes (101 suites / 629 tests).
- [x] Documents package and compiled collaboration sidecar build pass.
- [x] Create-app Documents template wiring test passes (12 tests).
- [x] Documents integration/preview scenarios pass (22/22, one worker, zero retries, live v2 sidecar).
- [x] Final diff contains only the expected manifest.
- [x] Direct Core-module imports are removed and replaced by explicitly approved public platform seams.
- [x] M7 causes reproduced in a running preview (60-second realtime rollover and rendered PDF fidelity).
- [x] M7 architecture fused from independent plans without adding a dependency, schema change, or cross-module import.
- [x] Cross-model gate explicitly waived by the user because Kimi is unavailable; Codex implementation and fresh Codex review remain required.
- [x] M7 implementation and focused verification pass.
- [x] Review remediation passes generation, package builds, repository tests,
  package/app typechecks, app production build, i18n sync, Documents-related create-app parity,
  deployment tests, and diff whitespace validation.

## Changelog

- **2026-07-09:** Scope and implementation started from the M1-M5 collaborative editor baseline.
- **2026-07-11:** Recovered the interrupted implementation, removed the runaway platform-wide hardening cascade, restored existing attachment/event/auth contracts, and narrowed the milestone to Documents plus required create-app wiring.
- **2026-07-11:** Scoped verification passed: Documents typecheck/build, 93 unit suites, focused create-app wiring, and all 22 production-preview scenarios. A live sidecar run exposed and then removed the final dependency on an unshipped Events helper; the clean rerun processed bridge traffic without cross-process listener errors.
- **2026-07-12:** Added the M7 reliability/fidelity follow-up after reproducing periodic token-rollover downtime, unstyled PDF tables/title, the unbounded canvas, and discarded verified record values. The design remains Documents-only and adds no dependency or schema change.
- **2026-07-12:** Resolved the first DeepSeek spec-jury findings by documenting the inert renderer's intentional URL-image omission and the deliberate independence of relation rows from editable inline chip snapshots. Kimi remained unavailable, so the mandatory multi-model gate is still blocked.
- **2026-07-12:** User explicitly waived the unavailable Kimi gate and added hover/focus identity for dormant collaborator carets to the M7 acceptance criteria.
- **2026-07-12:** Completed M7 with immediate logical-close transport renewal, staged realtime status, hover/focus collaborator identity, non-persistent A4 page decorations, styled inert PDF HTML, and verified record-field snapshots. Documents typecheck, 101 suites/629 tests, package/sidecar builds, create-app wiring, a 1.3-minute TC-DOCUMENTS-017 browser run, and manual preview/PDF inspection passed.
- **2026-07-12:** Removed Documents' direct Notifications implementation import in favor of the existing `notificationService` DI contract. The remaining Auth/Directory/Attachments imports still require reviewed platform seams; existing attachment upload cannot be safely proxied because it has broader authorization and different selected-organization/atomicity semantics.
- **2026-07-12:** Completed the approved review remediation: introduced narrow
  principal, organization-scope, and scoped-attachment DI services; serialized
  tenant attachment quota reservation; enforced attachment ownership and
  assignment checks; added trusted event scope; hardened production sidecar,
  origin, Chromium, and manifest wiring; synchronized the create-app template;
  and completed the Documents UI accessibility/error-state fixes.
- **2026-07-12:** Full-branch om-code-review (5-agent fan-out + full CI gate)
  found no Critical issues; remediated all findings. Operational: removed all
  `:?`-required compose interpolation (restored `APP_URL` default, added a
  no-`:?` regression test), template/monorepo Dockerfiles accept unset collab
  URLs (reject only set-but-loopback), `INSTALL_CHROMIUM` opt-out build arg,
  sidecar `TENANT_DATA_ENCRYPTION_KEY`/`REDIS_URL` passthrough, and a new
  `UPGRADE_NOTES.md` entry. Concurrency: entity-registry HTTP verification
  moved before the `PESSIMISTIC_WRITE` transactions for link create, link
  undo, and template instantiation — in-lock freshness is preserved by digest,
  monotonic-version, and template-revision CAS checks (identical error
  contracts), removing network I/O from lock scope. Platform: attachments
  partition lookups switched to `findOneWithDecryption`; the duplicated
  `OrganizationScope` type unified with shared as canonical and a core
  re-export bridge. Documents fixes: declarative `requireFeatures` on the
  principals route, escaped LIKE wildcards in title search, `readBody` in the
  export route (malformed JSON now 400), dead notification href template
  removed, `features` ACL gate on the related-documents injection widget,
  nine 409 double-feedback catch sites gated behind `surfaceRecordConflict`,
  yjs removed from the eager page chunk, translated entity-ref fallback
  labels (4 locales), comments `pageSize` clamped to 100, idempotent
  migration `down()` + reversibility test over all five migrations, new
  partial list-sort index, share-count aggregation extracted to
  `lib/shareCounts.ts`, and the package version aligned to 0.6.5.
