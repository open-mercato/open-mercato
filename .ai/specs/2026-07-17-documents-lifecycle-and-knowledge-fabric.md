# Documents lifecycle and knowledge fabric (M9)

- **Date:** 2026-07-17
- **Status:** Implemented in the staged worktree (three-round council complete); integration runs TC-DOCUMENTS-019..022 pending before merge
- **Package:** `@open-mercato/documents`
- **Module id:** `documents`
- **Baseline:** `2026-07-08-documents-collaborative-editor.md` (M1-M5), `2026-07-09-documents-ecosystem-integration-and-review.md` (M6-M8)

## TLDR

Competitive analysis of Notion, Confluence, Google Docs, Coda, Outline, and Slite against the shipped M1-M8 module shows the remaining highest-value gaps are document lifecycle and knowledge-graph features, not editor features. M9 adds five module-owned, additive capabilities: document-to-document links with a backlinks panel, an archive lifecycle, per-user favorites, document duplication, and per-document watch subscriptions with notifications. Everything stays inside `packages/documents` and reuses the entity-link registry, command/projection, visibility, and notification machinery the module already owns. No new platform seams, no new ACL features, no new production dependencies.

## Competitive evidence

Capability presence across the six competitors (2025-2026 state, verified by web research during drafting), reconciled against what M1-M8 already ships:

| Capability | Notion | Confluence | Google Docs | Coda | Outline | Slite | Our module today |
|---|---|---|---|---|---|---|---|
| Doc-to-doc references | yes (auto backlinks) | partial | no | forward-only | yes (References) | no | **missing** (record links only) |
| Archive lifecycle | trash only | yes | trash only | convention | yes | yes | **missing** |
| Favorites/starred | yes | yes | yes | yes | yes | yes | **missing** |
| Duplicate document | yes | yes | yes | yes | yes | yes | **missing** |
| Doc watch/subscribe | yes | yes | partial (email) | partial | yes | partial | **missing** (mentions only) |
| Version history + restore | yes | yes | yes | partial | yes | yes | shipped (M5/M6) |
| Comments + mention notifications | yes | yes | yes | yes | yes | yes | shipped (M5/M6) |
| PDF/DOCX export | yes | yes | yes | partial | yes | partial | shipped (M5/M7) |
| Real-time collab + presence | yes | yes | yes | yes | yes | yes | shipped (M5/M8) |
| Word/character count | partial | partial | yes | no | yes | partial | shipped (M5, `EditorStatusPresence`) |

Archive, favorites, duplicate, and watch are table stakes (present in nearly all six); doc-to-doc references with backlinks is the ranked top differentiator for an ERP-embedded module because the record-side half (related-documents panels on customers, deals, quotes, orders) already shipped in M6 — this milestone completes the knowledge graph.

## Non-goals

Explicitly not built in M9, per the competitive "do not build" analysis and the module's architecture boundaries:

- **Databases-in-docs / query blocks.** The ERP is the database; entity chips already surface live records. Building an in-document data store would fork tenant data governance.
- **Whiteboards / freeform canvas.** A separate product line; Mermaid/diagram embeds can be a later, cheap addition.
- **Offline-first editing.** A multi-tenant back-office is an online context; offline CRDT merge plus permission revalidation is enormous engineering for a persona this product does not serve.
- **Autonomous AI agents or AI Q&A.** AI Q&A over documents is blocked on the deliberate global-search ACL gap (`search.ts` stays `enabled: false` until record-level result filtering exists); autonomous doc-editing agents are a liability inside an ERP.
- **Public web publishing, share links, or guest access.** The correct external surface is the customer portal; that is a separate security-reviewed milestone, not a side effect of this one.
- **Synced blocks / reusable excerpts.** Requires cross-document content semantics in Yjs; deferred until demanded.
- **Task assignees, approvals/verification workflows, page analytics.** High-value candidates for M10+, each needing its own product decisions (assignee model, approval recording, metrics privacy); deliberately not rushed into this milestone.
- **Auto-versioning.** Interval snapshots remain future work; M9 does not change version-capture behavior.

## Resolved scope decisions

These were resolved from repository evidence during autonomous drafting; each is re-reviewable by the council.

1. **One milestone spec, five phased features.** Each phase is independently shippable (test: each functions without the others), matching the M6-M8 multi-capability milestone precedent on this branch. Watch/subscribe (Phase 5) is the designated cut if review finds the milestone too large.
2. **Doc-to-doc links extend `DocumentEntityLink`**, not a new table: the table's design (one nullable FK per target type, `num_nonnulls(...) = 1` CHECK, per-target partial uniques and reverse indexes) exists precisely to absorb new target types, and reusing it gives picker, verification, redaction, related-panel, and undo behavior for free.
3. **Registry verification for the `document` type uses the same HTTP self-lookup** as every other type (`entityRegistry.server.ts` forwards the caller's credentials to the entry's `searchPath`). This requires one additive list-route filter: `id=<uuid>`. Per-document sharing is therefore enforced by definition — the list route only returns documents visible to the caller.
4. **Archived documents are read-only.** `deriveDocumentCapabilities` gains an `archived` input clamping `canComment`/`canEdit`/`canShare` to `false`; every mutation route already consults these capabilities server-side, and the collaboration sidecar's live re-authorization (15 s refresh + room invalidation) downgrades open sessions through the existing machinery. Archive/unarchive requires `canArchive` (formula below) — no new ACL feature.
5. **Duplicate byte-copies attachments** through the already-approved narrow attachment seam (`readScoped` → `createScoped` with `persistLink`), rewriting embedded `src` URLs to the new document. Attachments are single-owner (`expectedOwner` binds to one document), so sharing rows is not an option. Explicit fallback if implementation review finds the atomicity unacceptable: strip embedded images and say so in the dialog — recorded here so de-scoping is a documented decision, not drift.
6. **Chips are content; relation rows are relations** (M6 doctrine). Duplicate copies content verbatim (chips included) but copies relation rows only for targets the acting user can currently access (per-target re-verification, inaccessible targets dropped). A chip whose relation row was dropped behaves exactly like today's chip-without-relation.
7. **No per-keystroke watch notifications.** Collaborative content edits bypass the command bus by design (sidecar persistence), so watch notifications fire on command-backed activity only: comment created, comment resolved, version restored, document archived/unarchived. This is documented user-facing behavior, not a bug.
8. **Favorites and watches are per-user junction rows** (soft-deleted, partial-unique, tenant/org-scoped), toggled through audit-logged but **non-undoable** commands (`isUndoable: false`, like `documents.content.replace`) — an idempotent one-click toggle needs no undo affordance, and revived soft-deleted rows carry no version for a safe assert-unchanged undo. As junction/assignment tables they are exempt from the `updated_at` editable-entity guard (`optimistic-lock-editable-entities.test.ts` exemption class), and their toggle routes intentionally omit the optimistic-lock header — a concurrent content edit must not 409 a star toggle. Archive/unarchive/restore-style document state transitions keep the optimistic-lock header.
9. **Existing links to a document that later gets archived remain fully resolvable** (the exact-`id` verification lookup is archived-inclusive); at the API level a new link to an archived target is also accepted, but the picker's search excludes archived documents by its default filter, so in the UI users unarchive first — referenceability is preserved, discovery noise is not reintroduced. Duplicating an archived document is allowed (the copy starts unarchived — "revive an archived SOP as a working copy"), as are favoriting and watching one (view-tier actions on a viewable document).
10. **Favorite, watch, and duplicate routes reject API-key principals** with 403, following the collab-token route precedent: per-user preference rows and watcher notifications are meaningless for machine principals, and the copy-ownership question for a tenant-wide key has no good answer.

## Problem statement

The 2025-2026 capability floor for collaborative document tools (verified across all six competitors) includes archive lifecycle, favorites, duplication, doc-to-doc references, and doc-level subscriptions. The module has none of these, while already exceeding the floor elsewhere (real-time collab, comments/mentions with notifications, version restore, styled PDF/DOCX export, record-side related-documents panels, word count). The single highest-leverage differentiator identified for an ERP-embedded module — linking documents into a navigable knowledge graph anchored on business records — is half-built: record→document discovery shipped in M6, document→document references do not exist.

## User outcomes

1. A user can insert a reference to another document from the same `@` picker used for business records; it renders as a chip that opens the referenced document, with the same fail-closed label redaction as every other entity type.
2. A document's related-records rail shows "Referenced by": the visible documents that link to the current one. A user with no access to a referencing document never sees its title or existence.
3. A user with `canArchive` can archive a document. Archived documents disappear from the default list, related panels, and pickers, show a banner with an Unarchive action when opened, and reject every content, comment, share, link, attachment, and version mutation server-side.
4. Any user with view access can star a document and filter the list to favorites; stars are private to the user.
5. A user with create+edit features can duplicate a visible document. The copy carries a localized copy title, full content, byte-copied attachments with rewritten URLs, and re-verified entity links; it never carries shares, comments, versions, watchers, favorites, or the archived state. The actor becomes the owner.
6. Any user with view access can watch a document (bounded per document) and receives in-app notifications for new comments, resolved comments, version restores, and archive state changes made by others — never for their own actions, and never duplicating a mention notification for the same comment.
7. No new UI surface exposes a raw UUID; all labels flow through the existing safe-label pipeline.

## Scope

### Phase 1 — Doc-to-doc links and backlinks

**Data.** `document_entity_links.linked_document_id uuid NULL` with a real FK to `documents(id)` ON DELETE CASCADE (same-module relationships use FKs per M8), included in the extended `num_nonnulls(..., linked_document_id) = 1` CHECK, a new CHECK `document_id <> linked_document_id`, a partial unique `(document_id, linked_document_id) WHERE deleted_at IS NULL`, and a reverse-lookup index on `linked_document_id` — mirroring the six existing target columns. The reverse index is what makes the backlinks query a bounded index scan.

**Validators.** `documentEntityTypeSchema` gains `'document'`.

**Registry.** New `DOCUMENT_ENTITY_REGISTRY` entry: `type: 'document'`, `searchPath: '/api/documents'`, `href: /backend/documents/:id`, `requiredModule/requiredFeatureModule: 'documents'`, `requiredFeature: 'documents.view'`, `mapItem` = safe title label (subtitle omitted), `tokenFields: [title]`. The picker, link create/delete commands, redaction, template slots, and related-panel flows pick the type up from the registry with no special-casing.

**List route.** Additive `id: z.string().uuid().optional()` filter on `GET /api/documents`; when present, visibility resolution narrows to that exact document. The `id` lookup ignores the `archived` filter entirely — an exact-record fetch is always archived-inclusive so archived documents remain resolvable link targets (decision 9); visibility rules still apply unchanged. `visibility.ts` maps `document → linked_document_id` in the relation-column table.

**Self-reference.** The link-create command rejects `entityType: 'document'` with `entityId === documentId` (400) in addition to the DB CHECK; the picker filters the current document out client-side.

**Backlinks UI.** `RelatedRecordsPanel` gains a "Referenced by" section backed by `GET /api/documents?entityType=document&entityId=<currentDocId>` — `entityType`/`entityId` are the M6-shipped relation filters, not new API surface; the new `document` type simply becomes a valid value, so visibility filtering, pagination, and safe labels are inherited. An archived document opened read-only still renders its rails, including backlinks.

**Archived-filter surfaces, precisely.** The `archived=exclude` default applies to: (a) the documents list, (b) the related-documents injection widget, (c) the "Referenced by" backlinks section (all three consume the list route). It does not apply to: the exact-`id` verification lookup, or the outgoing links rail on a document (`GET /:id/links`), where a link row to an archived target resolves with its normal label plus a localized "Archived" badge (the document-type verification response additively carries `archivedAt`, so the rail can annotate without a second lookup). Chips in content stay plain — they are static content, not live relation state.

### Phase 2 — Archive lifecycle

**Data.** `documents.archived_at timestamptz NULL`.

**Commands.** `documents.document.archive` / `documents.document.unarchive`, both undoable, optimistic-locked against the document `updated_at`, gated by `canArchive` (formula below). Events `documents.document.archived` / `documents.document.unarchived` declared with `crossProcessBroadcast: true` and delivered through the same private cross-process room-invalidation subscription the sidecar already uses for share revocations (M8: exact document/tenant/organization room invalidation), so live collaborative sessions on an archived document reconnect read-only without a page refresh.

**Capabilities.** `deriveDocumentCapabilities` gains optional `archived: boolean`; when true, `canComment`/`canEdit`/`canShare` are false. New additive `canArchive` capability with the explicit formula `canArchive = (relationshipTier === 'owner' || managerOverride) && hasFeature('documents.edit')` — the `managerOverride` term is the existing `documents.manage` path, so managers retain archive rights exactly as they do for delete/share. Every existing mutation route keeps working unchanged because each already consults the derived capabilities server-side; routes whose feature check precedes the capability check (link create/delete, attachments, version create/restore, content PUT, comments, shares) additionally reject archived documents with `403 documents.errors.documentArchived` — deliberately not 409, so the optimistic-lock conflict bar is never triggered by archive state.

**Live collaboration authorization, explicitly.** Both places that derive edit rights for realtime sessions feed the archived flag into the same derivation: the collab-token mint route (`GET /:id/collab-token`) loads `archived_at` with the document and mints a read-only token for an archived document, and the sidecar's 15-second live-authorization refresh receives the same clamped capabilities, so an in-flight session downgrades to read-only even without the invalidation event. The `crossProcessBroadcast` archive events additionally close the room immediately (share-revocation parity). Archive is **not linearized** against an in-flight sidecar save: a store racing the archive commit may durably persist edits composed before archival landed (they were composed with valid edit rights); the invalidation then closes the room, and no post-archival edit can be composed or persisted — the same window semantics as a live share revocation today.

**Undo side effects.** Undoing archive or unarchive replays the inverse projections through the existing `projectionsAfterUndo` machinery: the inverse `crossProcessBroadcast` event (room invalidation) and the inverse `documents.watch.changed` watcher notification both fire, so realtime sessions and watchers observe undo exactly as they would the corrective command. Undo of any **other** pre-archive operation (share, comment, link) on a document that is currently archived is refused with the same `403 documents.errors.documentArchived` — read-only means the undo path too; unarchive first.

**List and detail.** `archived: z.enum(['exclude','include','only']).default('exclude')` list filter; `archivedAt` on list/detail items. Editor shows a persistent banner with Unarchive (when `canArchive`). Document delete of an archived document remains allowed.

### Phase 3 — Favorites

**Data.** `document_favorites`: `id uuid` PK, `document_id uuid` FK→documents CASCADE, `user_id uuid`, `organization_id uuid`, `tenant_id uuid`, `created_at timestamptz`, `deleted_at timestamptz NULL`; partial unique `(document_id, user_id) WHERE deleted_at IS NULL`; index `(tenant_id, organization_id, user_id)`.

**Commands/API.** `documents.favorite.create` / `documents.favorite.delete` (non-undoable, no events, no optimistic-lock header — decision 8). `POST /api/documents/:id/favorite`, `DELETE /api/documents/:id/favorite` — `documents.view` + per-document view visibility, human principals only (API keys 403, decision 10), mutation-guard wired. Toggles are idempotent and race-safe: create treats an existing active row (partial-unique violation or pre-check hit) as success and revives a soft-deleted row instead of inserting a duplicate; delete treats an already-absent row as success. Favoriting never grants or extends access; a favorite of a document the user later loses access to simply never surfaces (list joins are visibility-filtered).

**List.** `favorite` filter parsed with `parseBooleanWithDefault` from `@open-mercato/shared/lib/boolean` (never `z.coerce.boolean()`, which treats `"false"` as true); `isFavorite` on items resolved by one batched `IN (pageIds)` query against the partial-unique index — no per-row lookups. Filters compose conjunctively: `favorite=true` with the default `archived=exclude` hides archived favorites unless `archived=include|only` is passed. Star toggle in the documents table and in the editor header; a "Favorites" filter control beside the existing search/filters.

### Phase 4 — Duplicate document

**Command.** `documents.document.duplicate` (undoable with exactly the `instantiate` undo contract: undo runs the same assert-unchanged guards — `assertInstantiateEntityUnchanged`-style version/dependent checks — and **refuses with 409 when the copy was edited, commented on, shared, or otherwise touched after duplication**; an untouched copy is soft-deleted and its copied attachments released through the existing release path). `POST /api/documents/:id/duplicate` with optional `{ title }` validated by `documentTitleSchema` (512 max), gated by `documents.create` + `documents.edit` + view visibility of the source (human principals only, decision 10). The actor becomes owner of the copy. The route sends no optimistic-lock header (the source is only read; the operation is a create); its UI call site is recorded in the coverage allowlist with that reason. Duplicating an archived source is allowed; the copy starts unarchived.

**Copy semantics.**
- Title: provided title, or the source title rendered through the localized template key `documents.duplicate.copyTitle` (`"{title} (copy)"` per locale — interpolation, not concatenation), clamped to 512.
- Content: source `content_html`/`content_text` fed through the same prepared-content pipeline templates use (fresh Yjs state built server-side, `collaboration_generation` starts at 1) — CRDT lineage is never shared between documents.
- Attachments: for each active source `DocumentAttachment`, `readScoped` (authorized against the source, acting user's auth) → `createScoped` for the copy with `persistLink` writing the new `DocumentAttachment` row; embedded `src="/api/documents/<src>/attachments/<oldId>"` URLs rewritten to the copy's ids (old→new id map built as copies land, applied in one rewrite pass). Quota and upload validation apply per copied attachment. Duplicate refuses up front with a localized 422 when the source exceeds **50 active attachments or 100 active links** (resource-limit philosophy; bounds the copy fanout).
- **Duplicate is not one DB transaction** — it is a compensated sequence with a visibility gate: (1) create the document aggregate (doc + content + verified links) atomically but **hidden** (`deleted_at` set), (2) copy attachments one by one (each `createScoped` commits its own scoped attachment transaction, exactly like the shipped upload command), (3) write the rewritten content and **reveal** the copy (clear `deleted_at`) as the final step. A crash or process termination mid-copy therefore never leaves a visible half-created document — only a hidden soft-deleted row plus possibly orphaned provider bytes, logged for operations. On a step-2/3 exception the command compensates by running the existing document-delete path on the hidden copy (releasing already-copied attachments and provider bytes) and surfaces one localized error.
- Duplicate copies the source's **last-materialized content** (`content_html`/`content_text`) and the attachment/link sets as read at command start; collaborative edits still buffered in the live Yjs room or landing mid-copy are not reflected — point-in-time semantics, documented user-facing behavior.
- Entity links: each active source link is re-verified with `verifyEntityRegistryTargetAccess` under the acting user's credentials; verified targets get fresh link rows (`source` preserved), unverifiable targets are dropped. Chips in content are copied verbatim either way (decision 6).
- Never copied: shares, comments, versions, favorites, watchers, `archived_at`.

**UI.** Duplicate action in the documents table row actions and the editor header menu; navigates to the copy on success.

### Phase 5 — Watch and notifications

**Data.** `document_watchers`: same shape as `document_favorites` (soft delete, partial unique per document+user, tenant/org scope).

**Commands/API.** `documents.watch.create` / `documents.watch.delete` (non-undoable, no events, no lock header, idempotent toggles as in Phase 3). `POST /api/documents/:id/watch` requires `documents.view` + per-document view visibility; `DELETE /api/documents/:id/watch` requires only authentication + the `documents.view` feature — **not** per-document visibility — so a watcher who lost access can still remove their own subscription (removing your own row reveals nothing and frees the cap; the row's existence is the caller's own data). Both are human-principal-only (decision 10) and guard-wired. Active watchers are capped at **100 per document**, enforced race-free by running the count-and-insert inside the existing document aggregate pessimistic lock (`lockDocumentAggregateRoot`) so concurrent subscribes cannot exceed the cap; subscribe beyond it returns a localized 422. Lost-access watcher rows do keep counting toward the cap until removed — a documented v1 limitation. `isWatching` added to the detail response; bell toggle in the editor header.

**Notifications.** Two additive types in `notifications.ts`, following the module's three-segment id shape:
- `documents.watch.commented` — fired from the `comment.create` and `comment.resolve` projections (resolve uses a resolve-specific `bodyKey`; no mention interplay exists on resolve, so recipients are simply watchers minus the actor);
- `documents.watch.changed` — fired from the `version.restore`, `archive`, and `unarchive` projections with per-change `bodyKey` overrides (the mention projection already passes explicit keys).

Recipient resolution and delivery happen at one point: the post-commit projection builds the recipient set — active watchers in scope (≤ 100 by the cap), minus the acting user, minus (for comment creation) users already receiving a mention notification for the same comment — and checks each remaining watcher's current view access with the existing per-user `resolveUserAccess` loop (the same mechanism the mention access-check uses; bounded by the cap, so worst case is 100 resolutions on one command), immediately followed by `notificationService.create` for those who pass. Creating the notification row **is** the delivery act for in-app notifications, so there is no separate check-then-deliver gap; a notification already delivered survives later revocation exactly as mention notifications do today (title-only exposure, accepted in M6). Notifications carry an explicit document-scoped `linkHref` (comment-anchored for comment activity), mirroring the mention pattern. The fanout loop runs in the post-command projection interceptor, which is fail-open by design (a notification failure logs and never rolls back the write). Worst-case in-request latency at the cap is ~100 access resolutions plus ~100 notification inserts on one command — accepted for v1 given typical watcher counts are single-digit; if real-world p95 command latency regresses, the designated scaling path is moving the fanout to a queued module worker (a future spec change, not this milestone). `PROJECTED_COMMAND_IDS` gains the two archive commands; `documents.version.restore` is already a projected command today — its descriptor set is extended, no new interceptor registration.

## Architecture boundaries

- Every runtime change lives in `packages/documents` (module code, sidecar, migrations, i18n, tests). No Core, Shared, Events, UI-package, or create-app runtime change of any kind. The sidecar change for archive room invalidation is inside `packages/documents/server/documents-collab-server.ts`, which the module owns.
- Optimistic-lock coverage guard: the new toggle mutations prefer the guard's module-owned exemption mechanics (the guard is file-level; call sites structured so the exemption lives inside `packages/documents`, verified against the guard test's actual matching rules during implementation). Only if the guard's central allowlist proves to be the sole mechanism does that single repo-level test-config file gain entries (each with its recorded reason) — a declared, bounded exception; test config, never a runtime seam.
- All new UI mutations go through the module's existing guarded write path (`useGuardedMutation`/`apiCall` + mutation-guard headers), like every shipped Documents mutation.
- No new cache surfaces: favorites and watches are read fresh per request; document metadata changes (archive/unarchive, duplicate reveal) invalidate through the standard command side effects that already bump and re-index the document.
- No new DI keys, no new platform seams, no new ACL features, no new production dependencies, no new event flags.
- The entity-link registry remains the single integration contract for typed references; `document` is a new entry, not a new mechanism.
- Global document search stays disabled; archive filtering applies to the module's own list/lookup paths only.
- All new routes: authenticated, feature-checked, tenant/organization scoped, capability-checked per document, mutation-guard wired, `openApi` exported.
- `yarn generate` runs after the entity/event/notification declarations change (auto-discovery).

## Data changes

One migration file authored in Phase 1 covering the complete M9 schema (all parts are known up front; the milestone ships as one branch), with the module snapshot updated in the same change and a reversible down path:

- `documents.archived_at timestamptz NULL`;
- `document_entity_links.linked_document_id uuid NULL` + FK + widened `num_nonnulls` CHECK + self-link CHECK + partial unique + reverse index;
- `document_favorites` and `document_watchers` tables with FKs, partial uniques, and scope indexes.

The `num_nonnulls` CHECK widening is mechanically a drop-and-recreate of the constraint in one transaction; it is semantically additive because every existing row (whose `linked_document_id` is NULL) satisfies both definitions. Re-validation scans `document_entity_links` under an exclusive lock — a small table, but the migration notes it for operators of large installations. `document_favorites`/`document_watchers` FK CASCADE fires only on a hard document delete (ORM cascade paths); soft delete leaves the rows in place and visibility filtering hides them, matching every other dependent table. No Core-owned table is touched. Down path drops the new tables/columns and restores the previous CHECK definition; the module's existing `migrationReversibility` test extends to this migration, including the CHECK round-trip. If Phase 5 is cut, the `document_watchers` portion is removed from the migration before the milestone ships (one branch, one edit).

## API additions and changes

- `GET /api/documents` — additive `id`, `archived`, `favorite` filters; `isFavorite`, `archivedAt`, `canArchive` on items.
- `GET /api/documents/:id` — additive `archivedAt`, `isFavorite`, `isWatching`, `canArchive`.
- `POST /api/documents/:id/archive`, `POST /api/documents/:id/unarchive` (optimistic-locked).
- `POST|DELETE /api/documents/:id/favorite`.
- `POST|DELETE /api/documents/:id/watch`.
- `POST /api/documents/:id/duplicate`.
- `GET/POST /api/documents/:id/links` and template slots accept `entityType: 'document'`.

All mutation responses carry the standard undo operation metadata where the command is undoable.

## Migration & Backward Compatibility

- Every M1-M8 route, response field, event id, widget spot id, ACL feature, and persisted entity type string is unchanged; all additions are additive fields, filters, routes, event ids, and notification types.
- `documentEntityTypeSchema` widening is additive for readers; existing stored links are untouched.
- The `capabilities` projection gains `canArchive`; existing consumers reading the seven current flags are unaffected.
- `deriveDocumentCapabilities` gains an optional input with a false default — existing call sites compile and behave identically.
- New user-facing strings ship in all four locales (en/de/es/pl); the existing locale-completeness test extends to them.
- No data backfill. Rollback = down migration; no stored content or Yjs state is rewritten by any M9 feature.

## Security and privacy

- Doc-to-doc verification runs under the caller's forwarded credentials against the visibility-filtered list route; missing and restricted targets share the same 403 redaction so link rows cannot become an existence oracle for unshared documents.
- Backlinks are computed through the same visibility resolution as the list; a referencing document the caller cannot view is absent, not redacted-but-present.
- Archive enforcement is server-side capability clamping; the client banner is presentation only. Live sessions are downgraded through the existing re-authorization plus room-invalidation paths — never trusted client state.
- Duplicate re-verifies every attachment read (`expectedOwner` = source document) and every link target under the acting user before any copy lands; nothing copied ever widens access, and copied attachments live under the copy's own private partition scope.
- Favorites and watches reveal nothing to other users; watcher lists are never exposed in any response, and watcher notification recipients are filtered fail-closed at creation time (which is delivery time for in-app notifications).
- No notification payload, event payload, or audit entry contains HTML bodies, Yjs state, or raw identifier-shaped labels.

## Edge cases & failure scenarios

- **Archived while a collab session is open:** invalidation event closes the room; clients reconnect with a read-only token within the existing renewal flow. Local Yjs edits composed before the archive event that had not yet synced are preserved client-side and, when the document is later unarchived and the client reconnects writable, merge through standard CRDT semantics — the same behavior the shipped permission-downgrade/regrant path has today. No new edits can be composed while archived (editor is read-only from the clamped capabilities).
- **Archive/unarchive optimistic-lock conflict:** 409 through the shared conflict bar (`surfaceRecordConflict`), like version restore.
- **Duplicate with a mid-copy attachment failure (quota, provider error):** the compensating delete removes the partial copy and releases already-copied attachments; the client sees one localized error. A compensation failure leaves a soft-deleted partial copy plus orphaned provider bytes, logged for operations (shipped upload-failure residual-risk class).
- **Duplicate of a document whose links point at records the actor cannot access:** those relation rows are dropped; chips remain as inert content, exactly like today's chip-without-relation state.
- **Undo of a duplicate after the copy was touched (edited, commented, shared):** the undo refuses with 409 through the assert-unchanged guards, matching `instantiate` undo; an untouched copy is soft-deleted with attachments released.
- **Concurrent watch subscribes at the cap:** the aggregate pessimistic lock serializes count-and-insert; the loser gets the localized 422.
- **Watcher lost access before the triggering write:** filtered out at notification creation; no notification, no oracle.
- **Watcher notification service outage:** the projection interceptor logs and continues (post-command by design); the underlying write is never rolled back.
- **Link target document archived later:** the link row survives; the target resolves (id-lookup is archived-inclusive) and renders with its normal label; backlinks and related panels exclude it by their default filter.
- **Favorite/watch toggle races:** the partial unique makes double-create idempotent at the DB; commands treat "already in desired state" as success.
- **Watcher cap reached:** subscribe returns a localized 422; existing watchers are unaffected.
- **Self-link attempts:** rejected at picker, command, and CHECK layers.

## Test coverage

Every failure contract above maps to a named regression below.

### Unit and component

- capability clamping for archived documents, `canArchive` derivation (owner and manager paths), and route-level 403s on every archived mutation path (content, comments, shares, links, attachments, versions);
- registry entry for `document`: mapItem safe-label behavior, id-filter lookup (archived-inclusive, visibility-scoped), self-link rejection at command and picker layers, redaction of invisible targets;
- visibility relation filter for `linked_document_id` (backlinks) and the `id`/`archived`/`favorite` list filters, including `favorite=false` parsing through the shared boolean helper and the id/archived interaction;
- duplicate command: content pipeline reuse, attachment byte-copy with URL rewrite, compensating delete on mid-copy failure, link re-verification and drop, never-copied surfaces, undo 409 on a touched copy vs soft-delete on an untouched one, API-key 403, localized copy-title key;
- favorite/watch commands: idempotent toggles, soft-delete revive under the partial unique, non-undoable command registration, watcher cap 422 under the aggregate lock (concurrent-subscribe race test), API-key 403, `optimistic-lock-ui-coverage` allowlist entries;
- watcher recipient resolution: actor exclusion, mention dedup on comment create, resolve-path recipients, per-recipient fail-closed visibility filter at creation time, per-change bodyKeys;
- archive/unarchive events reach the sidecar room-invalidation path (wiring test mirroring the share-invalidation test);
- locale completeness for every new key in all four locales; UUID regression checks on all new surfaces.

### Documents integration (`__integration__`)

- `TC-DOCUMENTS-019`: archive lifecycle — archive, default-list exclusion, `only` filter, read-only enforcement across content/comment/share/link/attachment/version routes, unarchive, undo, live-session downgrade (when the collab gate is enabled).
- `TC-DOCUMENTS-020`: doc-to-doc links — picker-driven link create, chip navigation, backlinks panel visibility filtering (owner sees, unshared user does not), self-link rejection, archived-target resolution.
- `TC-DOCUMENTS-021`: favorites and duplicate — star/unstar with list filter, duplicate with content + attachment + link verification, dropped-link behavior, ownership of the copy.
- `TC-DOCUMENTS-022`: watch — subscribe, comment by another user delivers exactly one watched notification (mention dedup proven), resolve/restore/archive deliver, unwatch stops delivery, revoked-access watcher receives nothing.

Fixtures are created and cleaned by each test; no seeded-data reliance. The feature gate is the Documents package build, typecheck, unit suite, and Documents integration directory, followed by the repository's ordered CI-mirroring validation gate.

## Verification status

- [x] M9 implementation passes the Documents package build, typecheck, and unit suite (137 suites passed / 1 default-skipped Redis multi-instance suite; 876 tests, incl. the m9Foundation/ReadSurface/Lifecycle/Watchers/Duplicate/DuplicateExecution/Ui regressions).
- [x] `TC-DOCUMENTS-019`..`022` pass against a live app (`4 passed`, `2026-07-18`, `BASE_URL=http://localhost:3000` on the dev DB after applying the M9 migration). Two assertion fixes were required: TC-019 and TC-020 originally asserted the raw i18n error **key** in the response body, but the documents API resolves error keys to localized strings via `api/_shared.ts` (`resolveTranslations`), so they now assert the resolved message. TC-020's link/backlink assertions also depend on a fresh `packages/documents` build — a stale worktree `dist` (predating the `entityLinks.ts` `linked_document_id` branch) had mapped doc links onto `sales_order_id`; `yarn build:packages` resolves it.
- [x] The full ordered CI-mirroring validation gate passes in order (`Runner: local`): build:packages, generate, build:packages, i18n:check-sync, i18n:check-usage (0 missing keys), typecheck, test (24/24 turbo tasks), build:app.
- [x] Design-system compliance sweep on every touched UI line (no hardcoded status colors, no arbitrary values, no `dark:` overrides on status tokens, no raw form elements; DS primitives + status tokens only). The full `om-ds-guardian` skill run remains available as an extra pass.
- [x] Final implementation council ran three rounds (fresh Claude + codex/deepseek/kimi/mimo completing every round). Round-3 fresh-Claude verdict: **approve** (0 blockers/majors). The `all-required` provider policy was never formally satisfied because the GLM binding returned HTTP 503 in all three implementation rounds (4 retries each); all other advisors completed and every blocker/major they raised was fixed or refuted with recorded evidence. Surviving recorded findings: unexecuted integration specs (above); duplicate redo returns an error on primary-key reuse (matching the instantiate redo shape); duplicate undo tolerates post-duplication deletions of copied dependents (laxer than instantiate's strict count check); minor advisor observations logged in `.ai/qa/artifacts_om_implement_feature_documents_2026-07-17/council/impl-round-3/review-summary.md`.

## Implementation plan

### Phase 1 — Doc-to-doc links and backlinks
1. Migration + snapshot: the complete M9 schema (linked_document_id + CHECKs + partial unique + reverse index, `archived_at`, `document_favorites`, `document_watchers`), reversible down. Entities updated; `yarn generate`.
2. Validators (`'document'` type), visibility relation-column map, list-route `id` filter (archived-inclusive exact lookup).
3. Registry entry + picker filter for current doc + link-command self-link rejection.
4. "Referenced by" section in `RelatedRecordsPanel`; i18n keys ×4 locales.
5. Unit tests + `TC-DOCUMENTS-020`.

### Phase 2 — Archive
1. Commands archive/unarchive + events + optimistic lock + undo; sidecar invalidation wiring.
2. Capability clamp + `canArchive` + route-level archived rejection on every mutation path.
3. List filter/response fields, banner UI, header/table actions; i18n ×4.
4. Unit tests + `TC-DOCUMENTS-019`.

### Phase 3 — Favorites
1. Commands + routes + guards (idempotent toggles).
2. List `favorite` filter (shared boolean parser) + `isFavorite` batch projection; star UI in table and header; i18n ×4.
3. Unit tests + `TC-DOCUMENTS-021` (favorites half).

### Phase 4 — Duplicate
1. Command (content pipeline reuse, attachment byte-copy + URL rewrite, link re-verification, undo) + route + guards.
2. Table/header actions + navigation + i18n ×4.
3. Unit tests + `TC-DOCUMENTS-021` (duplicate half).

### Phase 5 — Watch
1. Commands + routes + guards + cap + `isWatching`.
2. Notification types, projection descriptors on comment/resolve/restore/archive/unarchive, recipient resolution with dedup and batched visibility filter; bell UI; i18n ×4.
3. Unit tests + `TC-DOCUMENTS-022`.

Phase 1 step 1 authors the single M9 migration; every later phase consumes it. Each phase leaves the module building, tested, and shippable.

## Changelog

- **2026-07-17:** Initial M9 draft from competitive analysis (Notion, Confluence, Google Docs, Coda, Outline, Slite) reconciled against the shipped M1-M8 inventory; scope decisions resolved from repository evidence pending council review.
- **2026-07-17:** Applied council round 3 (all six reviewers completed; fresh Claude verdict: approve with 0 majors; provider majors were worker-family self-checks, all adopted). Duplicate hardened: hidden-until-finalized reveal (no visible half-created copy after a crash), point-in-time content semantics documented, 50-attachment/100-link fanout bounds. Archive: in-flight save race documented (share-revocation parity), undo replays inverse invalidation + watcher projections, undo of other operations on an archived document is refused. Watch: unwatch no longer requires per-document visibility (lost-access watchers can free their own row), fanout latency worst case + queued-worker scaling path recorded. Boundaries: guard exemption preferred module-owned with the central-allowlist edit as a bounded fallback; guarded-UI-mutation and no-new-cache statements added. Clarified backlinks reuse of M6 relation filters, `version.restore` already-projected status, picker-vs-API reachability for archived link targets, Phase-5-cut migration handling, CASCADE/soft-delete interaction, and CHECK re-validation lock note with reversibility-test coverage.
- **2026-07-17:** Applied council round 2 (fresh Claude + codex/deepseek/kimi/mimo completed; glm 503 → no formal verdict, findings preserved). Corrected the duplicate-undo contract to the real assert-unchanged behavior (409 on a touched copy — the draft misstated `instantiate` undo). Redesigned duplicate as a compensated sequence (per-attachment scoped transactions + compensating delete), matching the actual attachment seam. Made favorite/watch commands non-undoable (revived rows carry no safe undo version). Enforced the watcher cap under the document aggregate lock (concurrent-subscribe race). Rejected API-key principals on favorite/watch/duplicate. Renamed notification types to the three-segment shape (`documents.watch.commented|changed`). Stated live-collab authorization reads the archived flag at token mint and refresh. Replaced the false "batched tier-resolution" claim with the real per-user `resolveUserAccess` loop bounded by the cap. Declared the repo-level lock-coverage allowlist entries as a named test-config exception. Added archived badges on outgoing link rows, favorite+archived filter composition, archived-source duplicate/favorite/watch semantics, and the Verification status section.
- **2026-07-17:** Applied council round 1 (fresh Claude + codex/deepseek/kimi/glm/mimo, 40 findings). Removed the word-count item (already shipped in M5 — the draft misstated the code). Added the explicit Non-goals section and competitive-evidence table. Fixed the `favorite` filter to the shared boolean parser. Bounded watcher fanout (cap 100, batched fail-closed visibility at creation-time delivery). Clarified: canArchive formula incl. manager override, archived-filter surface list, id/archived filter interaction, CHECK drop-and-recreate honesty, single Phase-1 migration, duplicate undo of edited copies, localized copy-title key, provider-cleanup failure behavior, pre-archive Yjs edit replay as intended CRDT semantics, lock-guard allowlist entries for junction toggles, linking-to-archived allowed, resolve-path recipients, archived-doc rails. Mapped every failure contract to a named regression.
- **2026-07-17:** Implemented M9 end-to-end in the staged worktree (codex worker packets + host integration): migration + snapshot, doc-to-doc links with backlinks, archive lifecycle with live-session downgrade and undo/redo guards, favorites, duplicate (hidden-until-finalized compensated sequence with Yjs re-materialization), watch subscriptions with delivery-time fanout, full UI, i18n ×4, unit/component regressions, and TC-DOCUMENTS-019..022. Three implementation-council rounds fixed two blockers (link write-mapping, stale undo fanout recipients) and every confirmed major (archived undo/redo enforcement at the command seam, assert ordering after authorization, compensation isolation, toggle races, API-key rejection, execution-level duplicate tests); dispositions and surviving findings are recorded under Verification status.
- **2026-07-18:** Executed the four integration specs live against the app (dev DB, post-migration) and closed the open Verification-status gate. Fixed TC-019/TC-020: they asserted the raw i18n error key, but the documents API resolves error keys to localized strings, so they now assert the resolved message. Confirmed the doc-to-doc link `linked_document_id` mapping requires a fresh `packages/documents` build (a stale worktree `dist` had mis-mapped doc links onto `sales_order_id`; CI's `build:packages` rebuilds it). Bumped `@open-mercato/documents` 0.6.5 → 0.6.6 to satisfy `check-version-alignment` against the 0.6.6 monorepo. Result: `TC-DOCUMENTS-019..022` all pass (`4 passed`).
