# Documents — Collaborative Internal Docs Module

- **Date:** 2026-07-08
- **Status:** Implemented (M1–M9)
- **Scope:** OSS (`.ai/specs/`)
- **Package:** `@open-mercato/documents` (workspace package) · module id `documents`
- **Author:** Platform team

## TLDR

A tenant/organization-scoped backoffice module where staff author rich-text documents together in **real time**. Word-like editing (headings, bold/italic, lists, tables, links, images, alignment, highlight, colour) on a **TipTap v3** surface, backed by a **Yjs** CRDT synced over a **Hocuspocus** WebSocket sidecar with **live-cursor presence**. Documents live in **folders**, are shared **per document** (owner / editor / commenter / viewer), carry **inline comments + @mentions** that fire Open Mercato notifications, keep **version history**, and export to **.docx** and **PDF**.

Beyond the editor, the module is a first-class ERP work surface: documents **link to business records** (people, companies, deals, products, catalog offers, quotes, sales orders, and other documents) through a typed registry with label snapshots, inject a **related-documents panel** into host record pages, instantiate from **contextual templates** with server-resolved entity autofill, and support an **archive lifecycle, per-user favorites, duplication, and watch subscriptions**.

Every layer is MIT/permissive-licensed and self-hosted. The sidecar's `onAuthenticate` hook is the security chokepoint that enforces session, organization/tenant scope, and per-document tier before a client may join a document room.

## Overview

Open Mercato had no collaborative document editor. The closest primitives were single-user rich editors (`packages/ui/src/primitives/rich-editor.tsx`, the Lexical/MDXEditor markdown field), an SSE-only broadcast bridge (no bidirectional transport), enterprise **pessimistic** record locking (designed to *prevent* concurrent edits), and a blob-storage attachments module. None provided concurrent multi-user editing.

This module adds that capability as a self-contained package, following the `packages/checkout/` workspace-package pattern and the `customers` module CRUD conventions. It introduces the platform's **first bidirectional real-time transport** — a Hocuspocus WebSocket sidecar — an architectural addition approved during design, satisfying the AGENTS.md "Ask First: provider-specific infra" gate.

### Goals

- Real-time multi-user co-editing with live cursors and selections showing who is editing where.
- Per-document explicit sharing with viewer / commenter / editor tiers plus an owner.
- Folder organization (tree) and content search that stays fresh after realtime edits.
- Inline comments and @mentions that notify mentioned users through the notification system.
- Version history with named snapshots and safe restore.
- Export to `.docx` and PDF, both real server-produced artifacts.
- Typed links between documents and business records, with related-documents discovery from those records.
- Contextual templates that resolve entity data server-side and instantiate a document atomically.
- Document lifecycle: archive, favorites, duplication, and watch subscriptions.
- Strict tenant/organization isolation everywhere, including on the WebSocket transport and on embedded images.

### Non-goals

- Not a customer-portal feature (backoffice only; portal is a future, separately security-reviewed milestone).
- No public link sharing, guest access, or external anonymous collaborators.
- No pixel-perfect Word round-trip fidelity — export is good-fidelity, not byte-identical.
- No client-side end-to-end encryption of document bodies (see Encryption & Search Field Policy).
- No offline-first client; no real-time on serverless (the sidecar is a long-lived process).
- No spreadsheet or presentation formats.
- No databases-in-docs / query blocks — the ERP is the database, and entity chips already surface live records.
- No whiteboards, synced blocks, or reusable excerpts.
- No autonomous AI agents or AI Q&A over documents (blocked on the deliberate global-search ACL gap).
- No task assignees, approval workflows, page analytics, or interval auto-versioning.

## Problem Statement

Backoffice teams need to co-author internal documents (SOPs, meeting notes, proposals, internal wikis) without leaving Open Mercato for Google Docs or Word Online. The requirement is a Word-equivalent editor, per-document sharing, simultaneous multi-user editing, and presence. The two hard prerequisites — a bidirectional low-latency transport and a conflict-free document model (CRDT) — were both absent from the platform.

A second problem emerged once the editor existed: a generic rich-text editor inside an ERP is an island. Users needed to reference business records without typing IDs, discover documents from the records they already work with, start from contextual templates, and manage document lifecycle (archive, favorites, duplication, subscriptions) at the capability floor set by Notion, Confluence, Google Docs, Coda, Outline, and Slite.

## Proposed Solution

The module ships in nine milestones. Milestones are a build-order and risk sequencing, not a scope cut — all nine are implemented.

| Milestone | Delivers | Infra impact |
|---|---|---|
| **M1 — Shared-docs core** | Package and module scaffold; entities and migrations; per-document sharing (shares table, tier resolution, ACL); folders; CRUD APIs; document-scoped image proxy; docs list and folder tree; TipTap editor (single-user, async save); `DocumentContentService`; comments and versions APIs; search config. | None. |
| **M2 — Realtime + presence** | Collab-token mint route; Hocuspocus sidecar with `onAuthenticate`/`onLoadDocument`/`onStoreDocument`, read-only write enforcement, tenant-scoped queries, room close on revoke; Yjs binding on the shared editor config; live cursors via Awareness; dev and prod deploy wiring. | New WebSocket sidecar process. |
| **M3 — Comments + version history** | Inline comment anchors and right-rail UI; @mention to notification; version snapshot timeline and safe restore through the authoritative Y.Doc. | None. |
| **M4 — Export** | `.docx` export (`html-to-docx`) and PDF export (headless Chromium), both real server endpoints. | None. |
| **M5 — Deep integration + Google-Docs UX** | Human-readable labels everywhere (no naked UUIDs); alignment, highlight, text colour, undo/redo, outline, word count, inline rename; embeddable business-entity chips; document templates with entity autofill. | None. |
| **M6 — Ecosystem integration** | `DocumentEntityLink` typed peer links with label snapshots; label-first selectors; related-documents injection widget on host record pages; contextual templates with server-side preview and atomic instantiation; explicit preview/read-only mode; durable Yjs relative comment anchors. | None. |
| **M7 — Reliability + print fidelity** | Staged realtime status with fast bounded reconnect; styled inert A4 PDF builder; presentation-only paginated canvas; authorized record-field insertion. | None. |
| **M8 — Multi-instance + hardening** | Redis fanout with persistence ownership and deployment namespacing; interaction-triggered reconnect; notification DI correction; intra-module foreign keys; frontend bundle budgets. | Optional Redis for multi-replica sidecars. |
| **M9 — Lifecycle + knowledge fabric** | Document-to-document links with a backlinks panel; archive lifecycle; per-user favorites; document duplication; per-document watch subscriptions with notifications. | None. |

## Architecture

```
apps/mercato (Next.js, backoffice)
  @open-mercato/documents (workspace package)
    src/modules/documents/
      backend/  → docs list · folder tree · editor page · templates page
      api/      → 26 route files under /api/documents/*
      commands/ → command-pattern writes (create/update/delete, content, comments,
                  versions, links, templates, instantiate, archive, favorite,
                  watch, duplicate, attachments)
      data/     → entities.ts (11 entities) · validators.ts (zod)
      lib/      → constants.ts · permissions.ts · capabilities.ts · contentService.ts
                  · editorConfig.ts (SHARED TipTap extension set — client AND sidecar)
                  · entityRegistry.ts / .server.ts · collabToken.ts · collabMaterializer.ts
                  · pdfHtml.ts / pdfRenderer.ts · docxRenderer.ts · visibility.ts
                  · templateFill.ts / templateInstantiation.ts · userLabels.ts
                  · duplicateContent.ts · favorites.ts · watchers.ts · resourceLimits.ts
      widgets/  → injection/related-documents (spot widget for host record pages)
      migrations/ → 8 migration files
      di.ts acl.ts events.ts setup.ts search.ts encryption.ts notifications.ts i18n/
    server/     → documents-collab-server.ts (Hocuspocus sidecar entry)

  Browser editor (TipTap v3 + Collaboration/CollaborationCaret, editorConfig.ts)
        │  1) GET /api/documents/[id]/collab-token → short-lived per-doc token (tier baked in)
        │  2) Yjs updates + Awareness over WebSocket (token in connection payload, not URL)
        ▼
  Hocuspocus sidecar  ──►  Postgres (via createRequestContainer + scoped EM)
     onAuthenticate  → verify v2 token · assert documentId==room · org/tenant · Origin · tier
                       editor/owner ⇒ readOnly=false ; viewer/commenter ⇒ readOnly=true
     onLoadDocument  → DocumentContentService.load(docId, scope) → yjs_state → Y.applyUpdate
     onStoreDocument → DocumentContentService.persist(...)  (yjs_state + html + text + REINDEX)
     cross-process events (deleted / unshared / shared-downgrade / version.restored /
       archived / unarchived) → force-close affected rooms
        ▲
        └── optional Redis fanout between sidecar replicas (transport only)
```

- **Document body** is a Yjs document; its authoritative binary state lives in `document_contents.yjs_state` (`bytea`). A human-readable `content_html` and plain `content_text` are **materialized on store** for search, non-realtime render, and export.
- **Concurrency, two models by design:** the body uses Yjs (character-level CRDT merge, no optimistic lock). Document **metadata** (title, folder, sharing, archive state) is edited through command-backed routes and uses the standard `updated_at` optimistic lock. These are deliberately separate.
- **Presence** is Yjs Awareness (user id, display name, colour, cursor/selection) rendered by the TipTap collaboration caret extension. It is ephemeral and never persisted. A dormant remote caret reveals its collaborator's safe display name on hover or keyboard focus, never an identifier.
- **Single source of editor truth:** the TipTap extension set lives in `lib/editorConfig.ts` and is imported by **both** the browser editor and the sidecar materializer, so server-rendered HTML can never drift from client editing. The config is partitioned: **shared** schema/mark definitions (`entityRef` node, TextAlign, Highlight, TextStyle + Color) are DOM-free and safe in Node; **client-only** extensions (the `@tiptap/suggestion` `@`-trigger plugin, CharacterCount, Placeholder, Collaboration/CollaborationCaret) never enter the Node sidecar.

### Real-time transport

A **Hocuspocus** server runs as a separate long-lived Node process (`packages/documents/server/documents-collab-server.ts`). It is **not** a Next.js route (App Router route handlers cannot hold long-lived sockets). It boots the app's module registry and ORM via `bootstrapFromAppRoot()` — the same path the queue worker fleet uses — then opens a fresh request-scoped container per operation.

- **Room** = document id (`documentName`).
- **`onLoadDocument` / `onStoreDocument`** go through `DocumentContentService`, whose every query is scoped by the authenticated `{ tenantId, organizationId }` (defense in depth beyond `onAuthenticate`), and whose `persist` writes `yjs_state`/`content_html`/`content_text` **and** reindexes the document through the search indexer, so content search stays fresh with no raw-SQL bypass.
- **Materialization hardening:** on a materialization failure the sidecar **skips persisting** html/text and keeps the last materialized values rather than writing empty strings, so a stale sidecar dist cannot transiently blank search and export while the Yjs state stays intact.
- **Resource limits** are enforced per inbound frame, per store attempt, and per Redis-merged aggregate; an oversized merged aggregate retires the room instead of persisting.
- **Health check:** `GET /healthz` returns 200 `{ status: 'ok', capabilityTokenVersion: 2 }` once the v2 capability-token secret is usable, and 503 otherwise — so an unconfigured or misconfigured sidecar fails its readiness probe rather than accepting connections it cannot authenticate.
- **Graceful shutdown:** SIGTERM/SIGINT destroy the server, unloading every document so Hocuspocus flushes debounced stores; the Redis extension then stops new fanout, flushes pending publishes under a bounded deadline, and force-disconnects its clients rather than waiting on a potentially hanging Redlock quit. The process exits non-zero on failure.
- **Degrade:** when the sidecar is unreachable or `NEXT_PUBLIC_DOCUMENTS_COLLAB_URL` is unset, a user who still holds edit capability gets an **editable single-user fallback** persisted through the bounded content `PUT` path with the content row's optimistic-lock token, an explicit save control, and unsaved-navigation protection. A definitive collaboration authorization rejection, revoked capability, viewer, or commenter remains read-only and fail-closed. PostgreSQL is authoritative in both modes.

### Multi-instance collaboration (Redis fanout)

The Hocuspocus Redis extension activates only when `DOCUMENTS_COLLAB_REDIS_URL` (or `REDIS_URL`) is configured; without it the sidecar runs single-node with a startup warning. Redis replication is **transport only** — PostgreSQL remains the durable authority:

- The **authenticated source replica owns persistence** and publishes its exact Yjs state only after that store succeeds. A Redis-origin transaction never competes for the durable store lock with an empty authorization context. The fanout deliberately skips the stock extension's state-vector handshake, which could leak pre-durable edits, and instead publishes one complete Yjs update per confirmed store over a dedicated fail-fast publisher connection separate from the Redlock client.
- A dedicated command-bounded publisher **releases the store lock before fanout**; if Redis never acknowledges the release, the sidecar resumes after the lock's expiry rather than retaining Hocuspocus's save mutex indefinitely.
- Delivery failures retain and retry only the **latest** durable state per room with capped backoff, so post-store Redis recovery never blocks later PostgreSQL persistence.
- Every durable frame is wrapped in a generation envelope — `[identifier][magic 'OMDF1'][8-byte big-endian collaboration generation][sync message]` — carrying the content row's `collaboration_generation`. A receiver applies an update only when it matches its room's loaded generation, buffering it while the room is still loading and rejecting it as stale otherwise, so pre-restore or pre-reset edits can never merge into a replacement room. The `OMDF1` envelope predates the module's first release, so any future wire-version change requires a coordinated, non-overlapping sidecar rollout (drain and restart every replica) — mixed wire versions are intentionally rejected.
- A receiving replica **subscribes before** reading its scoped PostgreSQL snapshot and retains the loading Y.Doc until registration, closing the snapshot/subscription gap.
- `DOCUMENTS_COLLAB_REDIS_PREFIX` is a validated **deployment namespace**: all replicas of one deployment share it, and deployments sharing a Redis database must use different values so collaboration traffic cannot cross environments.

### Security and auth design — the sidecar chokepoint

Staff auth is an `httpOnly`, host-bound cookie; browser JS cannot read it and it will not auto-send to a cross-origin WebSocket. The client therefore never handles the raw session token.

1. **Collab-token mint** — `GET /api/documents/[id]/collab-token` (Next route, auth via the httpOnly cookie, `requireFeatures: ['documents.view']`). It verifies the session server-side, computes the caller's **effective per-document capabilities** (including the archived clamp), and returns a **60-second** signed token (`COLLAB_TOKEN_TTL_SECONDS = 60`) scoped to `{ userId, tenantId, organizationId, documentId, tier, readOnly, exp }` on a dedicated collaboration audience (`documents-collab-v2`), signed with `DOCUMENTS_COLLAB_JWT_SECRET_V2`. The client passes this token in the Hocuspocus connection payload — never the URL — and re-mints on expiry or reconnect. When the secret is missing or shorter than 32 bytes the route short-circuits to a graceful non-collaborative response (`url: null`) instead of a 500 retry loop.
2. **Sidecar verify** — `onAuthenticate({ token, documentName })` verifies signature, expiry, audience, room binding (`token.documentId === documentName`), tenant/organization scope, and the browser `Origin`, then sets `context = { userId, tenantId, organizationId, tier }` and `connection.readOnly` for viewer/commenter. Because the tier is baked into a short-TTL per-document token, a share **downgrade or revocation propagates within one TTL**; a downgraded user can only re-mint a lower tier.
3. **Write enforcement (not just UI)** — Hocuspocus's native `connection.readOnly` is the message-level write rejection: it drops the connection's `syncStep2`/`update` messages while still serving reads and awareness, so a read-only client stays connected but cannot mutate. Authorization is then re-checked continuously rather than trusted from the handshake: `beforeSync` revalidates the exact writer before an inbound frame is applied, `onStoreDocument` re-checks ACL, scope, tier, and edit capability before every persistence attempt including CAS retries, a scheduled task closes the connection at the token's `exp`, and a 15-second active re-authorization loop re-resolves the caller's rights on a live socket. A throwing `beforeHandleMessage` guard is deliberately not used — that hook fires on every inbound message and a throw closes the socket, which would sever a legitimate viewer on their first sync.
4. **Revocation belt-and-suspenders** — the `crossProcessBroadcast: true` events reach the sidecar over the cross-process Postgres bridge, which ignores own-process envelopes and trusts only envelopes emitted by the `documents` module carrying tenant/organization scope. The sidecar classifies each into one of two actions rather than one blunt close:
   - **Invalidate** (`documents.document.deleted`, `documents.version.restored`, and `documents.document.updated` carrying a content-epoch reset) discards pending Redis fanout for the room, permanently bars the old in-memory `Y.Doc` from re-authorization or storage, and force-closes every live socket. The room can only return through a fresh `onLoadDocument` after Hocuspocus unloads the old doc.
   - **Re-authorize** (`documents.document.shared`, `.unshared`, `.archived`, `.unarchived`) uses a one-shot final-drain registry instead of hard invalidation: it marks the room, waits for every already-connected socket's pending-message queue to drain, then grants exactly one subsequent `onStoreDocument` a final persist. This avoids dropping edits accepted just before a share or archive change closed the sockets, while still forcing every client to reconnect under the new ACL.

   Either way the change propagates immediately rather than waiting out the token TTL. These events are deliberately **not** `clientBroadcast` events, because organization-scoped browser SSE cannot enforce per-document visibility — private invalidation must not leak document metadata to unauthorized same-organization browsers.
5. **Origin and transport** — allowed-origins check on the handshake (`DOCUMENTS_COLLAB_ALLOWED_ORIGINS`, defaulting to `APP_URL`/`NEXT_PUBLIC_APP_URL`; production requires an exact trusted origin); token in the connection payload; no session material in query strings or JS-readable storage. WebSocket payloads are bounded (`DOCUMENTS_COLLAB_MAX_PAYLOAD_BYTES`).

### Realtime status model

The client keeps a Documents-local status state machine so normal token rollover does not flash a false outage:

- The 60-second handshake token expires by design and the server retires the socket; the provider reconnects with a fresh token using a fast bounded retry, while retaining unlimited retries for genuine network recovery.
- An internal `reconnecting` state absorbs sub-second disconnects (the last stable **Live** presentation holds), a longer retry shows **Reconnecting**, and only a sustained outage becomes **Offline**.
- A definitive authentication rejection (401/403 on the token endpoint) enters fail-closed read-only fallback; a transient transport or 5xx failure **retains the Y.Doc and queued local edits** so a later reconnect recovers them.
- All reconnect and offline timers are cleared on `connected`, `synced`, unmount, document change, or fatal fallback. Sharing, commenting, tab-visibility resume, deliberate rollover, and transient transport loss all reconnect with a fresh token without a page refresh.

### Export design

- **DOCX** via `html-to-docx` (MIT) from the materialized `content_html`.
- **PDF** via headless Chromium (`puppeteer-core`) against a Documents-owned **inert HTML builder** (`lib/pdfHtml.ts`): constant server-owned inline CSS, system fonts, a visible escaped title, A4 `@page` size and margins, and selectors for every supported editor node. Tables use collapsed borders, padded cells, header background, repeated header groups, row-break avoidance, and safe wrapping. Chromium runs with `preferCSSPageSize: true`, JavaScript disabled, request interception, embedded-image validation, concurrency limits, a timeout, and an output-size cap.
- **Export egress policy:** request interception aborts every non-`data:` subresource fetch. URL-backed and authenticated images are stripped before Chromium, and the renderer never receives cookies, bearer tokens, presigned URLs, or network access. Authenticated attachment export is deliberately deferred — doing it safely requires a separate design that reads a Documents-owned attachment server-side, enforces document scope, applies raster bounds, and inlines bytes before rendering.
- Without Chromium in the runtime image the endpoint returns a graceful **503**; Chromium is opt-in through `INSTALL_CHROMIUM=1`. The default image omits it because the measured Alpine runtime-image delta is 236 MB → 1.26 GB (+1.02 GB).

### Paginated canvas

The editor renders a fixed A4-width paper surface with print-like margins; narrow viewports scroll horizontally instead of changing page geometry. A local ProseMirror plugin (using the already-installed `@tiptap/pm` decoration API — no new dependency, no schema node) measures top-level block boxes and inserts `aria-hidden`, non-editable widget decorations only at safe block boundaries, each supplying the remaining bottom space, inter-page gutter, and next-page top margin. Recalculation is a coalesced animation-frame pass after transactions, remote updates, resize, image load, or mode change; metadata-only pagination transactions are excluded from undo history.

**Page decorations and measurements never serialize** to ProseMirror JSON/HTML or Yjs, so browser measurement can never make shared collaborative content client-dependent. Oversized indivisible blocks may overflow one visual sheet; Chromium remains authoritative for exact export fragmentation. A CSS-only repeating background was rejected because text can cross a painted gutter; persisted page-break nodes were rejected because they would make shared Yjs content depend on one client's measurements.

### Deployment topology

The sidecar is compiled as part of the package and exported as a production entry.

| Concern | Behavior |
|---|---|
| Dev | `yarn workspace @open-mercato/documents collab` (`tsx server/documents-collab-server.ts`) alongside `yarn dev`. |
| Production package entry | `yarn workspace @open-mercato/documents collab:prod` (`node dist/server/documents-collab-server.js`). |
| Scaffolded app | `yarn documents:collab`, wired by the create-app template. |
| Compose | An opt-in `documents-collab` profile provides the sidecar on port 4101 in the app and create-app Compose templates, with a liveness healthcheck and restart policy. A normal `docker compose up` neither starts it nor binds the port. |
| Entity identity | The sidecar consumes the package **dist**, not `src`, so MikroORM v7 legacy decorators transpile correctly and entity-class identity matches the ORM registration. |

The create-app template installs and enables `@open-mercato/documents`, exposes `yarn documents:collab`, includes the Documents environment variables, ships the sidecar Compose service, and externalizes the package's server-only export dependencies in Next.js.

**Environment variables** (all optional; unset values degrade gracefully — no `:?` required interpolation in any Compose file):

| Var | Where | Default | Purpose |
|---|---|---|---|
| `DOCUMENTS_COLLAB_PORT` | sidecar | `4101` | WebSocket listen port |
| `NEXT_PUBLIC_DOCUMENTS_COLLAB_URL` | app (client) | unset | `ws(s)://` endpoint the browser connects to, embedded at **build time**. Unset disables collaboration; malformed and loopback production values are logged and ignored at runtime so image builds remain available |
| `DOCUMENTS_COLLAB_JWT_SECRET_V2` | app + sidecar | unset (fails closed) | Shared secret for v2 capability tokens; ≥32 UTF-8 bytes required |
| `DOCUMENTS_COLLAB_JWT_SECRET` | app + sidecar | unset | Optional legacy v1 rollout secret; v1 tokens are accepted **only** while this is explicitly set to a ≥32-byte value that differs from the v2 secret |
| `DOCUMENTS_COLLAB_ALLOWED_ORIGINS` | sidecar | `APP_URL` / `NEXT_PUBLIC_APP_URL` | Comma-separated exact browser origins allowed at handshake; production requires one |
| `DOCUMENTS_COLLAB_REDIS_URL` | sidecar | unset (or `REDIS_URL`) | Redis for multi-replica Yjs/awareness sync; unset ⇒ single-node mode with a startup warning |
| `DOCUMENTS_COLLAB_REDIS_PREFIX` | sidecar | dev-only local namespace | Deployment-scoped Redis key prefix; required with Redis in production |
| `DOCUMENTS_COLLAB_APP_ROOT` | sidecar | auto-resolved | App root for `bootstrapFromAppRoot` |
| `DOCUMENTS_COLLAB_START` | sidecar | on | Set `off` to import the module without auto-starting (tests) |
| `DATABASE_URL` | sidecar | — | Required for the cross-process event bridge |
| `DOCUMENTS_PDF_CHROMIUM_PATH` | app | auto-probe | Chromium executable for PDF export |

The sidecar also receives `TENANT_DATA_ENCRYPTION_KEY` (it decrypts the same tenant data as the app) and `REDIS_URL` passthrough in the bundled Compose files.

### Frontend architecture and bundle budgets

- Page roots stay server components. `DocumentPageClient` is the detail shell; the editor and template editor are client islands loaded through **literal, statically analyzable dynamic imports** (`ssr: false`).
- List, detail-shell, and injection-widget initial chunks must not eagerly include TipTap, ProseMirror, Yjs, or Hocuspocus runtime modules. Package-local resilience tests enforce the import boundary.
- Accepted budgets: no editor runtime in the list route; detail-shell route-specific initial **≤350 KiB gzip** excluding shared app-shell chunks; each editor/template dynamic entry **≤750 KiB gzip**. A budget breach requires an explicit spec update rather than relying on `ssr: false` alone.
- **How each budget is actually checked.** The package-local resilience tests (`documentsUiResilience.test.ts`, `platformImportBoundary.test.ts`) enforce the *import boundary* only — that the editor sits behind a statically analyzable dynamic import and never enters the list route's graph. They cannot see built chunk sizes. `yarn documents:check-bundles` (`scripts/check-documents-bundle-budgets.mjs`) measures the real gzipped output after `yarn build:app`, matches exact editor package paths, and fails on a breach; the CI prepare job runs it immediately after the app build.
- **Resolved measurement false positive:** the initial analyzer used a broad `yjs` substring marker and classified the existing MDX/Lexical chunk as Documents because Lexical contains an internal `yjsDocMap` identifier. Exact `node_modules/@tiptap`, `@hocuspocus`, `prosemirror-*`, `y-prosemirror`, and `yjs` path markers remove that false positive. The final review build's largest actual Documents runtime chunk measures **224.2 KiB gzip**, within the 750 KiB budget.
- Loading, error, and retry UI stays local to the dynamic island so a chunk or initialization failure does not remove document metadata, navigation, or recovery actions.

### Architecture boundaries

- Documents owns all Documents persistence and schema, API routes, commands, widgets, registry adapters, templates, and UI in `packages/documents`.
- Approved platform seams are limited to additive or defensive changes in Shared and Events plus the Core Auth, API Keys, Directory, Attachments, Notifications, Progress, and Workflows modules required for trusted cross-process events, scoped authorization and principal lookup, bounded attachment lifecycle, notification delivery, progress projection, and private workflow-event enforcement. Documents imports no peer module implementation code; every missing-service path fails closed.
- Approved deployment and distribution seams are limited to CI, app registration and configuration, Docker/Compose wiring, and matching create-app template changes.
- Cross-module records are referenced by typed IDs and label snapshots, never ORM relationships. Peer reads use existing authenticated APIs or existing module services; credentials and storage details never cross into Documents.
- Global document search remains disabled until the platform provides record-level result ACL filtering.
- Documents is intentionally **non-ejectable** (`ejectable: false`) while its separately deployed sidecar loads package-owned entities and services. Module metadata declares its hard runtime dependencies (`requires: ['auth', 'directory', 'attachments']`) so generation rejects configurations that omit them instead of producing an all-403 module.
- Any source change outside those approved seams, or any expansion of their responsibility, requires fresh architecture review and spec approval.

## Data Models

Eleven tables under the `documents` module (MikroORM v7, decorators from `@mikro-orm/decorators/legacy`). All FKs are **within the module**; user, role, attachment, and peer-record references are stored as plain id columns with no cross-module ORM relations. Entity ids are referenced through a local constants module (`lib/constants.ts`, colon format e.g. `documents:document`), mirroring the `checkout` package pattern. All tenant-scoped tables carry `organization_id` and `tenant_id`.

### `documents`
| column | type | notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `organization_id` / `tenant_id` | uuid | scope |
| `title` | varchar(512) | |
| `folder_id` | uuid nullable | FK → `document_folders.id` (set null on delete) |
| `owner_user_id` | uuid | cross-module id |
| `created_by_user_id` | uuid | |
| `is_active` | boolean default true | |
| `archived_at` | timestamptz nullable | archive lifecycle |
| `created_at` / `updated_at` / `deleted_at` | timestamptz | `updated_at` monotonic, drives the optimistic lock; `deleted_at` soft delete |

Indexes: scope `(organization_id, tenant_id, deleted_at)`, `folder_id`, `owner_user_id`, and a partial list-sort index `(organization_id, tenant_id, updated_at) WHERE deleted_at IS NULL`.

### `document_contents` (1:1 with `documents`)
| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `document_id` | uuid UNIQUE | FK → `documents.id` (cascade) |
| `organization_id` / `tenant_id` | uuid | scope |
| `yjs_state` | bytea nullable | authoritative CRDT binary — **plaintext** (see field policy) |
| `content_html` | text nullable | materialized on store — **plaintext** |
| `content_text` | text nullable | materialized on store, search source — **plaintext** |
| `collaboration_generation` | integer default 1 | server-owned identity for the current collaborative content lineage; normal Yjs stores preserve it, authoritative replacements and lifecycle resets advance it under the content-row lock. Load-bearing for Redis fanout staleness rejection |
| `created_at` / `updated_at` / `deleted_at` | timestamptz | |

### `document_folders`
| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `organization_id` / `tenant_id` | uuid | scope |
| `name` | varchar(256) | |
| `parent_folder_id` | uuid nullable | FK → self (tree) |
| `owner_user_id` | uuid | |
| `created_at` / `updated_at` / `deleted_at` | timestamptz | |

### `document_shares`
| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `organization_id` / `tenant_id` | uuid | scope |
| `document_id` | uuid | FK → `documents.id` |
| `principal_type` | varchar(16) | `'user'` \| `'role'` |
| `principal_id` | uuid | user or role id (cross-module id) |
| `permission` | varchar(16) | `'viewer'` \| `'commenter'` \| `'editor'` |
| `created_by_user_id` | uuid | |
| `created_at` / `updated_at` / `deleted_at` | timestamptz | |
| UNIQUE | partial `(document_id, principal_type, principal_id) WHERE deleted_at IS NULL` | **re-share revives the soft-deleted row** (upsert), never blind-inserts, avoiding the soft-delete + unique race |

### `document_comments`
| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `organization_id` / `tenant_id` | uuid | scope |
| `document_id` | uuid | FK → `documents.id` |
| `parent_comment_id` | uuid nullable | FK → self (threads) |
| `author_user_id` | uuid | |
| `body` | text | **plaintext** (see field policy) |
| `anchor` | json nullable | legacy absolute range `{ from, to }` |
| `relative_anchor` | json nullable | Yjs relative positions, resolved against the live document |
| `mentions` | json nullable | out-of-band mentioned user ids |
| `resolved_at` / `resolved_by_user_id` | timestamptz / uuid nullable | |
| `created_at` / `updated_at` / `deleted_at` | timestamptz | |

New comments store Yjs relative positions alongside the historical absolute offsets; old comments remain readable through the legacy fallback, and a deleted range produces an explicit unavailable-anchor state rather than navigating to an unrelated offset.

### `document_versions`
| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `organization_id` / `tenant_id` | uuid | scope |
| `document_id` | uuid | FK → `documents.id` |
| `label` | varchar(256) nullable | |
| `yjs_snapshot` | bytea | immutable CRDT snapshot |
| `content_html` | text nullable | rendered at snapshot time (preview) |
| `created_by_user_id` | uuid | |
| `created_at` | timestamptz | immutable — no `updated_at` |

### `document_attachments`
| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `organization_id` / `tenant_id` | uuid | scope |
| `document_id` | uuid | FK → `documents.id` |
| `attachment_id` | uuid | id of the row in the attachments module (no ORM relation) |
| `created_by_user_id` | uuid | |
| `created_at` / `updated_at` / `deleted_at` | timestamptz | `updated_at` is the optimistic-lock token for permanent detach |

### `document_templates`
| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `organization_id` / `tenant_id` | uuid | scope |
| `name` | varchar(256) | |
| `description` | text nullable | |
| `body_html` | text | TipTap-compatible HTML with `{{slot.field}}` tokens and optional `entityRef` chips |
| `context_slots` | json | `[{ slot, entityType, required }]` |
| `created_by_user_id` | uuid | |
| `is_active` | boolean | |
| `created_at` / `updated_at` / `deleted_at` | timestamptz | |

### `document_entity_links`
Typed peer links with readable label snapshots. One nullable FK column per target type plus a `num_nonnulls(...) = 1` CHECK, per-target partial uniques, and reverse indexes — the shape that lets new target types be absorbed without a new table.

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `organization_id` / `tenant_id` | uuid | scope |
| `document_id` | uuid | FK → `documents.id` |
| one target column per type | uuid nullable | including `linked_document_id` → `documents.id` (cascade) for document-to-document links |
| `customer_kind` | varchar nullable | `'person'` \| `'company'`, CHECK-constrained |
| `label_snapshot` | text | **encrypted at rest** (denormalized peer label) |
| `source` | varchar | `'chip'` \| `'template'` \| `'related-panel'` |
| `created_at` / `updated_at` / `deleted_at` | timestamptz | |

CHECKs: exactly one target (`document_entity_links_exactly_one_target_chk`), customer kind (`_customer_kind_chk`), and no self-link (`_no_self_link_chk`, `document_id <> linked_document_id`). A reverse-lookup index on `linked_document_id` makes the backlinks query a bounded index scan.

### `document_favorites` and `document_watchers`
Per-user junction rows, identical shape: `id` uuid PK, `document_id` uuid FK → `documents.id` (cascade), `user_id` uuid, `organization_id`, `tenant_id`, `created_at`, `deleted_at` nullable; partial unique `(document_id, user_id) WHERE deleted_at IS NULL`; user-lookup index `(tenant_id, organization_id, user_id)`.

As junction/assignment tables they are exempt from the `updated_at` editable-entity guard, and their toggle routes intentionally omit the optimistic-lock header — a concurrent content edit must not 409 a star toggle. FK CASCADE fires only on a hard document delete; soft delete leaves the rows in place and visibility filtering hides them, matching every other dependent table.

### Migrations

Eight migration files under `src/modules/documents/migrations/`, each with a reversible `down()`:

| Migration | Content |
|---|---|
| `Migration20260708163836_documents` | M1 core: `documents`, `document_contents`, `document_folders`, `document_shares`, `document_comments`, `document_versions`, `document_attachments` |
| `Migration20260709164720_documents` | `document_templates` + `document_comments.mentions` |
| `Migration20260710002318_documents` | `document_entity_links` + target/customer-kind CHECKs |
| `Migration20260710071003_documents` | `document_contents.collaboration_generation` + relative comment anchors |
| `Migration20260712120000_documents` | partial `documents_list_sort_idx` |
| `Migration20260712183000_documents` | `document_attachments.updated_at` |
| `Migration20260713092156_documents` | intra-module foreign keys across every Documents-owned relationship |
| `Migration20260717000000_documents` | M9: `documents.archived_at`, `document_entity_links.linked_document_id` + widened CHECK + self-link CHECK + reverse index, `document_favorites`, `document_watchers` |

The `num_nonnulls` CHECK widening is mechanically a drop-and-recreate in one transaction; it is semantically additive because every existing row (whose `linked_document_id` is NULL) satisfies both definitions. Re-validation scans `document_entity_links` under an exclusive lock — a small table, but operators of large installations should note it. The module's `migrationReversibility` test covers all eight, including the CHECK round-trip. No migration updates a Core-owned table.

## Access Control

- **Module ACL features** (`acl.ts`, ids immutable, each `dependsOn: ['documents.view']` except `documents.view` itself): `documents.view`, `documents.create`, `documents.edit`, `documents.delete`, `documents.share`, `documents.templates.manage`, `documents.manage`.
- **Default role features** (`setup.ts`): `admin` → `documents.*`; `employee` → `documents.view`, `documents.create`, `documents.edit`, `documents.share` (they still only reach documents they own or are shared).
- **Per-document tiers**: owner (full) > editor (read/write body, comment, snapshot/restore) > commenter (read + comment) > viewer (read). `documents.manage` is an organization-admin override granting owner-equivalent access to all documents in the organization.
- **`resolvePermission(documentId, ctx)`**: effective tier = max of (owner, direct user share, role shares matching the caller's roles, `documents.manage` override). Enforced in every HTTP route **and** in the sidecar `onAuthenticate`. Deny by default; `documentName` and route params are never trusted without a scope and tier check.
- **`deriveDocumentCapabilities`** projects the tier plus the caller's features into `canView`, `canComment`, `canEdit`, `canShare`, `canDelete`, `canCreate`, `canArchive`, `canDuplicate`, `canManageTemplates`. When `archived` is true it clamps `canComment`, `canEdit`, and `canShare` to false. `canArchive = (relationshipTier === 'owner' || managerOverride) && hasFeature('documents.edit')`.
- **API-key principals** are rejected with 403 on `favorite`, `watch`, `duplicate`, and `collab-token`: per-user preference rows, watcher notifications, and copy ownership are meaningless for machine principals.
- API-key organization access is the intersection of the key binding and its role grants; tenant-scoped keys retain role organization restrictions, and a role-level super-admin grant cannot bypass a restricted key.

## Events & Search

**Event ids** (`events.ts`, `createModuleEvents`, grammar `module.entity.action`, past tense) — fifteen, the complete set:

| Event id | Category | Cross-process |
|---|---|---|
| `documents.document.created` | crud | |
| `documents.document.updated` | crud | ✓ |
| `documents.document.deleted` | crud | ✓ |
| `documents.document.archived` | lifecycle | ✓ |
| `documents.document.unarchived` | lifecycle | ✓ |
| `documents.document.duplicated` | lifecycle | |
| `documents.document.shared` | lifecycle | ✓ |
| `documents.document.unshared` | lifecycle | ✓ |
| `documents.comment.created` | crud | |
| `documents.comment.mentioned` | lifecycle | |
| `documents.comment.resolved` | lifecycle | |
| `documents.version.created` | crud | |
| `documents.version.restored` | lifecycle | ✓ |
| `documents.link.created` | crud | |
| `documents.link.deleted` | crud | |

The seven `crossProcessBroadcast: true` events are consumed by the sidecar over the cross-process Postgres bridge to reauthorize or force-close rooms. They are deliberately **not** `clientBroadcast` events because organization-scoped browser SSE cannot enforce per-document visibility. DOM-event audiences prefer trusted emit-option tenant/organization scope for both local and cross-process delivery, so payload-authored scope cannot widen a browser audience. Event definitions and generated event configuration share a process-global, HMR-safe registry across duplicated package instances.

**Notification types** (`notifications.ts`): `documents.comment.mentioned` (mention), `documents.watch.commented` (comment created or resolved on a watched document), `documents.watch.changed` (version restored, archived, or unarchived) with per-change body keys.

**Search** (`search.ts`) — search entity `documents:document`, priority 9; `buildSource` joins `documents.title` with the 1:1 `document_contents.content_text` (decrypted through `findOneWithDecryption` when not already on the record) as the fulltext body, returning `null` when both are empty. `resolveUrl` is `/backend/documents/<id>`, and the presenter falls back to a localized generic "Document" label rather than a raw id when the title is missing. `DocumentContentService.persist` reindexes on every materialization (both the bounded content `PUT` and the sidecar store), so realtime edits never leave the index stale.

> **Global search is disabled by design.** The platform's cross-entity search is only feature-gated (`search.view`) and has **no per-record ACL hook**, so indexing per-document-private titles and content would expose them to any organization user holding `documents.view`, bypassing per-document sharing. The `documents:document` search entity therefore ships `enabled: false`; reindex calls safely no-op and the `buildSource`/`fieldPolicy` config is retained, ready to re-enable. Document discovery is via the **permission-filtered list route** (`GET /api/documents?search=`, title match, with LIKE wildcards escaped). Secure per-document-filtered content search is deferred until the search layer gains a per-record visibility hook.

## API Contracts

All routes are authenticated, tenant/organization scoped, feature-checked, validated with zod, and per-document capability-checked via `resolvePermission` / `deriveDocumentCapabilities` in addition to the module ACL feature. Mutations use optimistic locking except where noted. Route files live under `api/`; the module id is auto-prefixed, so `api/route.ts` serves `/api/documents` and `api/folders/route.ts` serves `/api/documents/folders`. JSON mutations reject oversized streamed bodies before buffering or parsing; malformed JSON returns 400.

Two evaluation details matter when reading the table. First, `resolveDocumentsContext` evaluates a route's `requireFeatures` array with **OR** semantics (`hasAnyDocumentsFeature`), so a two-feature declaration is a set of accepted features rather than a conjunction; `/api/documents/instantiate` compensates by explicitly re-checking both `documents.create` **and** `documents.edit` in its handler. Second, the three creation routes with no existing row to check against — `POST /api/documents`, `POST /api/documents/folders`, `POST /api/documents/templates` — carry no per-document gate by construction.

| Route | Methods | ACL feature(s) | Per-document gate |
|---|---|---|---|
| `/api/documents` | GET, POST | `documents.view` / `documents.create` | list returns only visible documents (owner ∪ shares ∪ `documents.manage`); create ⇒ caller is owner. Additive filters: `search`, `id`, `archived` (`exclude` default \| `include` \| `only`), `favorite`, `entityType`/`entityId` relation filters. Items carry `ownerLabel`, `sharedWithCount`, `isFavorite`, `archivedAt`, capabilities |
| `/api/documents/[id]` | GET, PUT, DELETE | `documents.view` / `documents.edit` / `documents.delete` | GET viewer+; PUT title/folder editor+; DELETE owner or `documents.manage`. Returns `archivedAt`, `isFavorite`, `isWatching`, capabilities. Optimistic lock on PUT/DELETE |
| `/api/documents/[id]/content` | GET, PUT | `documents.view` / `documents.edit` | GET viewer+; PUT editor+. PUT persists via `DocumentContentService` (html + text + reindex) with the content row's optimistic-lock token. After M2 the sidecar owns live writes; this is the read path and the degrade-fallback save |
| `/api/documents/[id]/collab-token` | GET | `documents.view` | viewer+ (tier and archived clamp baked into the 60 s token). Returns `url: null` when collaboration is unconfigured. Rejects API-key principals |
| `/api/documents/[id]/archive` | POST | `documents.edit` | `canArchive`. Optimistic-locked, undoable |
| `/api/documents/[id]/unarchive` | POST | `documents.edit` | `canArchive`. Optimistic-locked, undoable |
| `/api/documents/[id]/favorite` | POST, DELETE | `documents.view` | The gate lives in the command, not the route: `documents.favorite.create`/`.delete` enforce `canView` and reject API-key principals via `assertHumanActor`. Idempotent toggle, non-undoable, no lock header |
| `/api/documents/[id]/watch` | POST, DELETE | `documents.view` | Gated in the command. `documents.watch.create` requires `canView` and returns 422 past the 100-watcher cap (count-and-insert under the aggregate lock); `documents.watch.delete` checks only the tenant-wide `documents.view` feature, deliberately **not** per-document visibility, so a watcher who lost access can still remove their own row. Both reject API-key principals |
| `/api/documents/[id]/duplicate` | POST | `documents.create`, `documents.edit` | viewer tier on the source; archived sources are duplicable. Bounded by the attachment and link caps (422 past either). Undoable with assert-unchanged guards. Rejects API-key principals at the route, and the command re-asserts it fail-closed |
| `/api/documents/folders` | GET, POST, PUT, DELETE | `documents.view` / `documents.edit` | folder-level (owner or `documents.manage`); tree via `parent_folder_id` |
| `/api/documents/[id]/shares` | GET, POST, PUT, DELETE | `documents.share` | owner or `documents.manage`. Re-share revives a soft-deleted row; writes validate the principal exists in the caller's tenant/organization (cross-organization or invalid ⇒ 400). GET reads at most `DOCUMENTS_MAX_LISTED_SHARES + 1` rows and returns `truncated`, so neither the listing nor its principal-label fan-out is unbounded |
| `/api/documents/[id]/principals` | GET | `documents.view` declared; `documents.share` effective for `mode=share` | User/role picker. The handler re-invokes the auth gate with `mode === 'mention' ? 'documents.view' : 'documents.share'`, so share-mode calls require `documents.share` despite the static declaration, and additionally gates on `canComment` (mention) or `canShare` (share). Bounded, Auth-owned database page applying organization eligibility before limit/offset. Non-superadmin callers never see superadmin users; viewer-only users cannot enumerate mention candidates or email-like principal metadata |
| `/api/documents/[id]/comments` | GET, POST, PATCH | `documents.view` | GET viewer+; POST commenter+; resolve commenter+ or author. Optional out-of-band `mentions: [{ userId }]` and `grantAccessTo`; GET returns `userLabels`. `pageSize` clamped to 100 |
| `/api/documents/[id]/comments/access-check` | POST | `documents.view` | commenter+. Returns only `{ withoutAccess: string[] }` — minimal ids for mentioned users lacking effective access (ownership, direct share, active role share, or live manager override), with no principal labels or email-like metadata |
| `/api/documents/[id]/versions` | GET, POST | `documents.view` / `documents.edit` | GET viewer+; snapshot editor+. Returns `createdByLabel` |
| `/api/documents/[id]/versions/[versionId]` | GET | `documents.view` | viewer+. Sanitized version preview with readable author labels |
| `/api/documents/[id]/versions/[versionId]/restore` | POST | `documents.edit` | `canEdit`, rejects archived. Epoch-reset protocol (below). The optimistic-lock header is checked against the **document content row's** `updatedAt`, not the version being restored |
| `/api/documents/[id]/links` | GET, POST | `documents.view` / `documents.edit` | GET viewer+; POST editor+. Items carry current `values` restricted to the target type's declared `tokenFields`; restricted, deleted, disabled-module, feature-denied, or cross-scope targets expose no id, href, or values |
| `/api/documents/[id]/links/[linkId]` | DELETE | `documents.edit` | editor+. The explicit panel Unlink action is the sole relation-removal command |
| `/api/documents/[id]/attachments` | POST | `documents.edit` | editor+. Command-backed upload through the scoped attachment service; the command re-locks the document and rechecks live edit capability inside the attachment transaction, records `document_attachments`, and writes a redacted action-log entry without upload bytes. The service bounds the raw multipart stream before `FormData` decoding, including missing, invalid, or chunked `Content-Length` |
| `/api/documents/[id]/attachments/[attachmentId]` | GET, DELETE | `documents.view` / `documents.edit` | GET viewer+ — a **document-tier-gated proxy** that checks `resolvePermission` before streaming, so embedded images are gated by document tier, not merely organization scope, and private bytes are not browser-cacheable after revocation. DELETE editor+, command-backed, checks the link `updatedAt`, transactionally removes the exactly-owned attachment row and quota usage; provider cleanup runs only after the DB transaction commits, so rollback never deletes bytes and one provider failure does not stop later cleanup. 409 when metadata shows another assignment; intentionally non-undoable because bytes are removed |
| `/api/documents/[id]/export` | GET, POST | `documents.view` | viewer+. GET `?format=docx\|pdf` exports the stored document; POST is the paginated-snapshot path, taking a client-supplied rendered snapshot body (auth resolved before buffering or validating). Both return a real file artifact; PDF returns 503 without Chromium |
| `/api/documents/instantiate` | POST | `documents.create` + `documents.edit` | Atomically creates the document aggregate and its links from the same resolved snapshot used for preview |
| `/api/documents/templates` | GET, POST, PUT, DELETE | `documents.view` / `documents.templates.manage` | List requires `documents.view` and omits `bodyHtml` for view-only callers; create/edit/delete require `documents.templates.manage`. Paginated with a summary-only mode |
| `/api/documents/templates/[templateId]` | GET | `documents.templates.manage` | Template detail including `bodyHtml` |
| `/api/documents/templates/[templateId]/preview` | POST | `documents.create` | Resolves selected records server-side, renders readable values and chips, and reports missing required slots before creation, without persisting. 404 unless the template is active; 409 when the supplied `templateUpdatedAt` disagrees with the stored row (revision race) |

### Commands and projections

Every write goes through the command bus: **29 registered commands** under the `documents.` prefix, covering document CRUD and instantiate/duplicate, folders, shares, comments, versions, content replace, entity links, templates, attachments, archive/unarchive, favorites, and watches. Most are undoable; the deliberate exceptions are `documents.version.create` and `.restore`, `documents.document.delete`, `documents.content.replace`, `documents.attachment.create` and `.delete`, and the four favorite/watch toggles — an idempotent one-click toggle needs no undo affordance, and revived soft-deleted rows carry no version for a safe assert-unchanged undo.

Ten commands are **projected**: a command interceptor reads `result.projections` after execution and `projectionsAfterUndo` after an undo, dispatching each projection by kind — `event` (module event emission), `mention-notification` / `watch-notification` / `watch-notification-fanout` (notification creation), `mention-notification-delete`, and `document-index` (search reindex). This is the single point at which events, notifications, and reindexing fire, so undo re-projects the inverse rather than leaving side effects stranded: undoing a share re-projects `shared`/`unshared` for the reverted state, undoing a comment deletes its mention notifications, and undoing archive/unarchive replays both the inverse room invalidation and a freshly resolved watcher fanout.

A second interceptor family guards undo against archive state: undoing `document.update`, any `share.*`, `comment.create`/`.resolve`, `link.create`/`.delete`, or `version.restore` on a document that is **currently archived** throws 403 `documents.errors.documentArchived`. Read-only includes the undo path; unarchive first.

### Archived-document rejection surface

`assertDocumentNotArchived` (403 `documents.errors.documentArchived`) gates document `PUT`, attachment create and delete, comment create and resolve, content `PUT`, link create and delete, share create/update/delete, version create, and version restore. It deliberately does **not** gate document `DELETE` (archived documents remain deletable), pure reads, `export`, `duplicate`, version preview, or the attachment `GET` proxy. Archive and unarchive themselves are gated by `canArchive` rather than archive state, since the same capability must drive both directions.

### Collaboration sidecar protocol

Hocuspocus over WebSocket at `NEXT_PUBLIC_DOCUMENTS_COLLAB_URL`. Not an HTTP route. Auth via the short-lived v2 collab token; `onAuthenticate` enforces scope, origin, and tier; read-only is enforced at the message level. The message protocol is the standard Yjs sync + awareness protocol (opaque binary), bounded by `DOCUMENTS_COLLAB_MAX_PAYLOAD_BYTES`.

### Version restore protocol

Restore must not be a raw DB overwrite that a live room merges over: `Y.applyUpdate(liveDoc, oldSnapshot)` **merges** rather than reverts, and a live room's final `onStoreDocument` would clobber a DB-only write. Restore is therefore an **epoch reset**:

1. The restore endpoint records a **pre-restore snapshot** (making the operation reversible), writes the target `yjs_snapshot` to `document_contents.yjs_state` with materialized html/text and reindex via `DocumentContentService`, advances `collaboration_generation`, and emits `documents.version.restored` (`crossProcessBroadcast: true`; the payload carries `documentId`, `tenantId`, `organizationId` and is never delivered to browser SSE clients).
2. The sidecar consumes the event over the cross-process bridge, marks the room **closing** — suppressing its pending or final `onStoreDocument` so it cannot overwrite the restored state — and force-disconnects every connection in that room. Hocuspocus then unloads the cached in-memory `Y.Doc`.
3. Clients reconnect (the provider re-mints a token) and `onLoadDocument` seeds a fresh `Y.Doc` from the restored `yjs_state`. In-flight pre-restore edits are dropped by design; the pre-restore snapshot makes the whole operation reversible. Restore awaits a successful content refresh before closing or reporting success.

Residual race (Low, documented): between the endpoint's DB write and the sidecar receiving the event a live room could store once. Store suppression on the closing flag, generation tagging, and short event latency bound the window, and the pre-restore snapshot makes any such case recoverable.

### Resource limits

| Limit | Value |
|---|---|
| `content_html` / `content_text` | 2 MiB UTF-8 each |
| `yjs_state` | 8 MiB |
| Collaboration WebSocket payload | `yjs_state` cap + 64 KiB envelope |
| Entity links per document | 100 |
| Active watchers per document | 100 |
| Attachments copied by duplicate | 50 |
| Comments / list `pageSize` | 100 |

## Ecosystem Integration

### Entity links and the typed registry

Documents owns `DocumentEntityLink`, storing typed identifiers and a label snapshot with no direct ORM relationships to peer modules. The registry (`lib/entityRegistry.ts`) declares, per type, the owning module, required feature, search endpoint, canonical backend href, readable item mapping, and template token fields. **Eight embeddable types** ship:

| Type | Search endpoint | Backoffice href |
|---|---|---|
| `customer-person` | `/api/customers/people` | `/backend/customers/people/[id]` |
| `customer-company` | `/api/customers/companies` | `/backend/customers/companies/[id]` |
| `deal` | `/api/customers/deals` | `/backend/customers/deals/[id]` |
| `product` | `/api/catalog/products` | `/backend/catalog/products/[id]` |
| `catalog-offer` | catalog offers list | catalog offer detail |
| `quote` | `/api/sales/quotes` | `/backend/sales/quotes/[id]` |
| `sales-order` | sales orders list | sales order detail |
| `document` | `/api/documents` | `/backend/documents/[id]` |

Missing modules or features make an entry unavailable; they never widen access. Coupling is **client-side HTTP plus server-side verification under the caller's own credentials** — the module never imports peer module code or entities, so ACL enforcement is inherited (a user without the peer feature gets 403 and that type is hidden from the picker: graceful degrade).

Link creation and deletion use Documents commands with optimistic locking, tenant/organization scoping, and additive events. **A link never grants access to either the document or the peer record.**

**Relation rows and inline chips are deliberately independent.** `DocumentEntityLink` drives related-record discovery and may exist without an inline chip (`related-panel` and `template` sources); an inline chip is a static content snapshot that may be copied, moved, or deleted like any text. Deleting a chip does not unlink the document, and unlinking does not rewrite historical collaborative content.

**Chips** are an inline atom node `entityRef` in the **shared** editor config, attrs `{ entityType, entityId, label, href }` (label and href are insert-time snapshots — the sanctioned FK-id + snapshot pattern). `renderHTML` emits `<span data-entity-ref data-entity-type data-entity-id data-href class="om-entity-ref">label</span>` with a matching `parseHTML` rule, so template seeding, clipboard round-trips, materialization, and export all preserve chips. `data-href` is restricted to same-origin paths. Plain HTML render, no React node view — identical output client-side, in sidecar materialization, and in export. Insertion is via an `@`-trigger (client-only `@tiptap/suggestion` plugin) or a toolbar "Insert record" button, both opening the same searchable EntityPicker.

### Label-first selectors

All business-record selection is search-based and bounded. Picker results carry an opaque id for the mutation plus a human label and optional secondary text for display. **The UI never asks users to paste ids.** Display mapping rejects identifier-shaped labels and has no id fallback; results that cannot produce a safe label are omitted, or shown with a localized neutral label where omission would make an existing record unmanageable. A shared `lib/userLabels.ts` resolver (`resolveUserLabels`) returns a localized "unknown user" fallback whenever a lookup misses, applied uniformly by the list owner column, comment authors, mentions, versions, and access checks — so no code path falls back to a raw id.

### Related-documents widget

The module injects a related-documents panel (widget id `documents.injection.related-documents`, `features: ['documents.view']`, `requiredModules: ['documents']`, kind `stack`, priority 80) into supported host record pages via the widget injection system. `widgets/injection-table.ts` targets **eight spot ids**:

`detail:customers.person:footer` · `customers.person.detail:details` · `detail:customers.company:footer` · `customers.company.detail:details` · `detail:customers.deal:footer` · `sales.document.detail.quote:details` · `sales.document.detail.order:details` · `crud-form:catalog.product`

The widget receives typed host context, queries only Documents-owned link routes, applies the caller's Documents **and** peer-record permissions, renders document titles rather than ids, offers Link and Create actions gated by resolved capabilities, and renders nothing when there is no target or the caller is unauthorized. No peer module imports Documents code and no peer database table changes.

### Contextual templates

Templates support typed context slots. Preview resolves selected records server-side, renders readable values and chips, and reports missing required slots before creation. Instantiation atomically creates the document aggregate and links from the same resolved snapshot used for preview. **Every substituted value is HTML-escaped** before insertion — entity data must never inject markup into a document body or an exported artifact. Unresolved tokens for unfilled optional slots are stripped.

Eight default templates seed idempotently through `onTenantCreated` (new tenants) and `seedDefaults` (init/backfill): offer letter, meeting notes, deal summary, customer meeting brief, deal proposal, quote cover letter, order handoff, product brief. Seeding uses a synthetic `TEMPLATE_SEED_ACTOR_ID` (`created_by_user_id` carries no FK), so it succeeds even for a tenant with no users. Bodies seed in English — templates are user-editable *content*, not chrome, and the setup context carries no locale.

### Record-field insertion

Accessible link responses carry current `values` from `verifyEntityRegistryTargetAccess`, restricted to registry-declared `tokenFields`. An "Insert data" action on accessible related-record cards (and immediately after toolbar record selection) opens a dialog that **refreshes the link and target first**, so extraction never relies on a stale page-load snapshot. The dialog renders localized field labels and safe non-empty values, supports explicit subset selection, `Escape`, and `Cmd/Ctrl+Enter`, and explains that inserted content becomes a document snapshot governed by document sharing. Insertion emits native ProseMirror JSON — never interpolated HTML — as one `Label: value` paragraph or a two-column table. Insertion is hidden in preview, fallback, viewer, and revoked states.

Inserted peer values are **deliberate static snapshots**: later source-record changes or revocation prevent future extraction but cannot retract text already copied into a shared document. Live-bound record fields were rejected because exports would become nondeterministic and later peer changes could leak into more broadly shared documents.

## Lifecycle & Knowledge Fabric

### Document-to-document links and backlinks

`document` is a registry entry, not a new mechanism: `document_entity_links.linked_document_id` reuses the table's per-target-column design, and verification uses the same HTTP self-lookup every other type uses, forwarding the caller's credentials to `GET /api/documents?id=<uuid>`. Per-document sharing is therefore enforced by definition — the list route only returns documents visible to the caller. Self-links are rejected at the picker, the link-create command, and the DB CHECK.

The related-records rail gains a **"Referenced by"** section backed by the M6-shipped `entityType`/`entityId` relation filters, so visibility filtering, pagination, and safe labels are inherited. A user with no access to a referencing document never sees its title or existence — it is absent, not redacted-but-present.

The `archived=exclude` default applies to the documents list, the related-documents injection widget, and the backlinks section (all three consume the list route). It does **not** apply to the exact-`id` verification lookup or the outgoing links rail, where a link to an archived target resolves with its normal label plus a localized "Archived" badge (the verification response additively carries `archivedAt`). Chips in content stay plain — they are static content, not live relation state.

### Archive lifecycle

Archiving sets `documents.archived_at` through optimistic-locked, undoable commands gated by `canArchive`. Archived documents disappear from the default list, related panels, and pickers; opening one shows a banner with an Unarchive action; and every content, comment, share, link, attachment, and version mutation is rejected server-side.

- Capability clamping is the enforcement: `deriveDocumentCapabilities` zeroes `canComment`/`canEdit`/`canShare`, and every mutation route already consults capabilities server-side. Routes whose feature check precedes the capability check additionally reject archived documents with **403** `documents.errors.documentArchived` — deliberately not 409, so the optimistic-lock conflict bar is never triggered by archive state.
- **Live collaboration** reads the archived flag in both places that derive edit rights: the collab-token mint route mints a read-only token for an archived document (its `readOnly` derives from `!canEdit`, which reflects real archived state), and the sidecar's 15-second live-authorization refresh receives the same clamped capabilities. The `crossProcessBroadcast` archive events additionally drive the sidecar's **re-authorize** path — final-drain then reconnect under the new ACL — exactly as a share revocation does.
- Archive is **not linearized** against an in-flight sidecar save: a store racing the archive commit may durably persist edits composed *before* archival took effect, since they were composed with valid edit rights. This is exactly what the re-authorize final drain is for — it lets those already-accepted edits land once, then forces reconnect, after which no post-archival edit can be composed or persisted. Same window semantics as a live share revocation.
- Undoing archive or unarchive replays the inverse projections (room invalidation and watcher notification). Undo of any **other** pre-archive operation on a currently archived document is refused with the same 403 — read-only includes the undo path.
- Document delete of an archived document remains allowed.

### Favorites

`document_favorites` rows are private per user. `POST`/`DELETE /api/documents/[id]/favorite` are idempotent and race-safe: create treats an existing active row (partial-unique violation or pre-check hit) as success and revives a soft-deleted row rather than inserting a duplicate; delete treats an absent row as success. The list `favorite` filter is parsed with `parseBooleanWithDefault` from `@open-mercato/shared/lib/boolean` (never `z.coerce.boolean()`, which treats `"false"` as true), and `isFavorite` resolves through one batched `IN (pageIds)` query against the partial-unique index. Filters compose conjunctively: `favorite=true` with the default `archived=exclude` hides archived favorites unless `archived=include|only` is passed. Favoriting never grants or extends access.

### Duplication

`POST /api/documents/[id]/duplicate` creates a copy owned by the actor.

- **Title**: the provided title, or the source title rendered through the localized key `documents.duplicate.copyTitle` (interpolation, not concatenation), clamped to 512.
- **Content**: source `content_html`/`content_text` fed through the same prepared-content pipeline templates use, with fresh server-built Yjs state and `collaboration_generation` starting at 1 — CRDT lineage is never shared between documents.
- **Attachments**: byte-copied through the narrow attachment seam (`readScoped` authorized against the source → `createScoped` with `persistLink`), with embedded `src` URLs rewritten to the copy's ids via an old→new map applied in one rewrite pass. Quota and upload validation apply per copied attachment.
- **Entity links**: each active source link is re-verified with `verifyEntityRegistryTargetAccess` under the acting user's credentials; verified targets get fresh link rows (`source` preserved), unverifiable targets are dropped. Chips in content are copied verbatim either way.
- **Never copied**: shares, comments, versions, favorites, watchers, `archived_at`. Duplicating an archived source is allowed; the copy starts unarchived.
- **Bounds**: refuses up front with a localized 422 when the source exceeds 50 active attachments or 100 active links.
- **Duplicate is not one DB transaction** — it is a compensated sequence with a visibility gate: (1) create the document aggregate atomically but **hidden** (`deleted_at` set), (2) copy attachments one by one (each `createScoped` commits its own scoped attachment transaction, exactly like the shipped upload command), (3) write the rewritten content and **reveal** the copy as the final step. A crash mid-copy therefore never leaves a visible half-created document — only a hidden soft-deleted row plus possibly orphaned provider bytes, logged for operations. On a step-2/3 exception the command compensates by running the existing document-delete path on the hidden copy and surfaces one localized error.
- **Point-in-time semantics**: the copy reflects the source's last-materialized content and the attachment/link sets read at command start; collaborative edits still buffered in a live Yjs room are not reflected. This is documented user-facing behavior.
- **Undo** uses the `instantiate` contract: assert-unchanged guards refuse with 409 when the copy was edited, commented on, shared, or otherwise touched after duplication; an untouched copy is soft-deleted and its copied attachments released.

### Watch subscriptions

`document_watchers` rows are per user, capped at **100 active watchers per document**, enforced race-free by running count-and-insert inside the document aggregate pessimistic lock; subscribing beyond the cap returns a localized 422. `POST /api/documents/[id]/watch` requires view visibility; `DELETE` requires only authentication and the feature, so a watcher who lost access can still remove their own subscription — removing your own row reveals nothing and frees the cap. Lost-access watcher rows do keep counting toward the cap until removed, a documented v1 limitation.

Notifications fire on **command-backed activity only** — comment created, comment resolved, version restored, document archived, document unarchived. Collaborative content edits bypass the command bus by design (sidecar persistence), so there are no per-keystroke watch notifications; this is documented user-facing behavior, not a bug.

Recipient resolution and delivery happen at one point, in the post-commit projection: the recipient set is active watchers in scope (≤100 by the cap), **minus the acting user**, minus (for comment creation) users already receiving a mention notification for the same comment. Each remaining watcher's current view access is checked with the existing per-user `resolveUserAccess` loop, immediately followed by `notificationService.create` for those who pass. Creating the notification row **is** the delivery act for in-app notifications, so there is no check-then-deliver gap; a notification already delivered survives later revocation exactly as mention notifications do (title-only exposure). Notifications carry an explicit document-scoped `linkHref`, comment-anchored for comment activity. The fanout loop runs in the post-command projection interceptor, which is fail-open by design — a notification failure logs and never rolls back the write. Worst-case in-request latency at the cap is ~100 access resolutions plus ~100 inserts on one command; the designated scaling path if p95 regresses is moving the fanout to a queued module worker.

## Encryption & Search Field Policy

**Posture (deliberate, documented trade-off):** document bodies (`yjs_state`, `content_html`, `content_text`), comment `body`, and version snapshots are stored **plaintext at rest**, and `content_text`/`title` are fulltext-indexed. Server-side CRDT merge (the sidecar operates on plaintext Yjs state) **and** full-text search both structurally require plaintext; field-level encryption of the CRDT is incompatible with the approved realtime design. True confidentiality would require client-side end-to-end encryption, which eliminates server materialization and search — explicitly out of scope.

- **Confidentiality mechanism = access control:** per-document tiers on every HTTP route and on the WebSocket transport, tenant/organization scoping on all queries including the sidecar's, and the document-tier-gated image proxy.
- **`encryption.ts` encrypts exactly one field**: `documents:document_entity_link.label_snapshot`. It is a denormalized copy of another module's record label, so it is encrypted at rest. CRDT state, rendered content, searchable text, comments, and version snapshots are left plaintext with an explicit in-file comment recording the trade-off.
- **Search `fieldPolicy`:** `searchable: ['title', 'content_text']`, `excluded: ['yjs_state', 'content_html']`; comments are searchable through the parent document, not separately indexed; vector and token search are off.
- **GDPR:** this plaintext-at-rest posture was surfaced for conscious acceptance. The architecture forces it for the approved feature set; the alternative is a future end-to-end-encrypted variant that sacrifices search and server materialization.

## Security & Privacy

- Never trust a client-provided label, href, template value, capability, tenant, or organization.
- Resolve peer records within the authenticated scope before preview or instantiation; redact or omit links when the peer module, feature, or record is unavailable. Missing and restricted targets share the same 403 redaction so link rows cannot become an existence oracle.
- Sanitize template and version previews before rendering.
- Keep Yjs state, HTML bodies, encrypted values, and raw ids out of event, notification, and audit payloads. Upload bytes stay request-local and never reach a command payload or audit log.
- Bound picker pages, templates, links, versions, comments, and collaboration frames.
- Treat UUIDs as internal mutation identifiers only; never use them as display fallbacks.
- Revalidate a linked peer record immediately before offering field insertion; a restricted or unavailable target returns no values.
- Archive enforcement is server-side capability clamping — the client banner is presentation only.
- Duplicate re-verifies every attachment read (`expectedOwner` = source document) and every link target under the acting user before any copy lands; nothing copied ever widens access, and copied attachments live under the copy's own private partition scope.
- Favorites and watches reveal nothing to other users; watcher lists are never exposed in any response.

## Dependencies & Licensing

All MIT or permissive; no GPL/AGPL or commercial dependencies (CKEditor, BlockNote-XL, and Liveblocks are explicitly excluded).

- **Client**: `yjs`, `@tiptap/core`, `@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`, `@tiptap/extension-collaboration`(+ caret), table extensions, `@tiptap/extension-image`, `-link`, `-task-list`/`-task-item`, `-text-align`, `-highlight`, `-text-style` (TextStyle + Color), `@tiptap/extensions` (CharacterCount), `@tiptap/suggestion`, `@hocuspocus/provider`.
- **Sidecar**: `@hocuspocus/server`, `@hocuspocus/transformer`, `@tiptap/html`, plus the Hocuspocus Redis extension when configured.
- **Export**: `html-to-docx` (`.docx`), `puppeteer-core` (Apache-2.0) against a system Chromium (PDF).

**Editor stack verdict: keep TipTap.** Two concerns were raised and researched against primary sources. *Licensing* — `@tiptap/core@3.x` and every `@tiptap/extension-*`, `@tiptap/html`, and `@tiptap/y-tiptap` package used here is MIT (verified npm `license` fields and repo `LICENSE.md`), and `@hocuspocus/*@4` is MIT. The paid line is Tiptap Cloud/Pro *services* (hosted collab, Content AI, DOCX/PDF import-export services, Comments-as-a-service, Pro registry) — none are dependencies: comments, versions, export, and mentions are in-house and collaboration is self-hosted Hocuspocus. *Performance* — the concern described TipTap v2, whose real problem was React re-rendering on every transaction; v3 defaults `shouldRerenderOnTransaction: false` and provides selective `useEditorState` subscriptions. Remaining large-document costs live in ProseMirror itself, so a raw-ProseMirror/Slate/MDXEditor rewrite could not remove them.

Adopted mitigations: pin `@tiptap/*@3.x` and `@hocuspocus/*@4.x`; never add `@tiptap-pro/*` registry packages (that would be a procurement decision); never set `shouldRerenderOnTransaction: true`; keep the editor isolated in its own island; prefer plain `renderHTML` chips over React node views for new nodes.

## Migration & Backward Compatibility

Every change is **additive**; no FROZEN or STABLE contract surface is modified.

- New workspace package `@open-mercato/documents`; `apps/mercato/src/modules.ts` gains one `enabledModules` entry and `apps/mercato/package.json` one `workspace:*` dependency — the sanctioned additive registration, mirroring `checkout`.
- New event ids, ACL feature ids, notification type ids, DI keys, API routes, and env vars are all additive (event and ACL ids are FROZEN against rename and removal only; adding is allowed).
- Eleven new tables and their columns arrive through eight additive, reversible migrations. No existing table is changed and no Core-owned table is touched.
- `EventDefinition.crossProcessBroadcast`, `isCrossProcessBroadcastEvent`, and `CROSS_PROCESS_EVENT_INSTANCE_ID` are additive event-platform surfaces. Existing event ids and `clientBroadcast` semantics are unchanged; existing `clientBroadcast` events retain their cross-process behavior.
- The attachment remediation adds the `attachmentService` DI key and public `AttachmentService` type additively; its optional bounded-upload and reference-checked release methods preserve structural compatibility. Existing attachment APIs, entity shapes, driver registrations, routes, ACL ids, and storage layouts are unchanged, and Documents resolves the new service fail-closed. No data migration or stored-attachment backfill is required.
- The Auth, API Keys, and Directory modules expose additive, request-scoped DI read services for principal and organization-scope resolution. Existing entities, RBAC methods, routes, ACL identifiers, and authentication payloads are unchanged.
- Trusted event emit options add optional tenant and organization fields — source- and runtime-compatible with existing emitters.
- Within the module: existing routes and response fields remain available; existing templates and comments remain readable; existing absolute comment anchors remain supported alongside the new relative ones; persisted entity type strings are not renamed; `documentEntityTypeSchema` widening is additive for readers; the `capabilities` projection gains `canArchive` and `canDuplicate` without disturbing existing flags; `deriveDocumentCapabilities` gains an optional `archived` input defaulting to false, so existing call sites compile and behave identically.
- Pagination is presentation-only and never enters Yjs state, versions, exports, comments, undo history, or event payloads.
- All user-facing strings ship in four locales (en/de/es/pl), 513 keys each, enforced by a locale-completeness test.
- **Operational upgrade path:** every Documents env var is optional with `:-` defaults in every Compose file (a regression test forbids `:?` interpolation, which would break `docker compose` for unconfigured users). The sidecar is behind the opt-in `documents-collab` profile, and unset or invalid collaboration vars degrade gracefully. Production image builds never fail solely because the optional collaboration URL is malformed; runtime validation logs and ignores invalid or loopback values. PDF export requires Chromium in the runtime image; `INSTALL_CHROMIUM=1` is opt-in and an image without it returns a graceful 503. Recorded in `UPGRADE_NOTES.md`.

The core guard tests (`optimistic-lock-editable-entities`, `optimistic-lock-ui-coverage`, `module-decoupling`) are core-scoped and do not scan this out-of-core package; a **package-local guard test** asserts each editable entity exposes `updated_at` and its APIs return `updatedAt`.

## Risks & Impact Review

| # | Risk | Severity | Area | Failure scenario | Mitigation | Residual |
|---|---|---|---|---|---|---|
| 1 | Sidecar auth bypass / cross-tenant room join | Critical | Realtime/security | A client joins another tenant's document room and edits | Client never holds the raw session token; short-lived per-document token with tier and scope baked in; `onAuthenticate` verifies signature, expiry, audience, `documentId==room`, tenant/org, and Origin; every sidecar query tenant-scoped; deny by default; seam tests | Low |
| 2 | Write after losing access (downgrade/revoke) | High | Security | A viewer, commenter, or downgraded editor keeps sending Yjs updates | Server-level `readOnly` message rejection; fresh authorization before every writable frame; 60 s token TTL forces re-mint at the lower tier; `unshared`/`shared`/`deleted`/`archived` events force-close rooms | Low |
| 3 | Per-document tier not enforced on a route | High | Security | A viewer PUTs content via the direct API | `resolvePermission` + capability gate in every route, with per-tier integration tests | Low |
| 4 | Private-document image leak | High | Security | An organization user with an image URL reads a private document's image | Document-scoped attachment proxy checks `resolvePermission` before streaming; editor embeds only proxy urls; private bytes non-cacheable after revocation | Low |
| 5 | Redis-origin edit persisted without an authenticated scope | High | Correctness/security | A replica wins the store lock with an empty authorization context while the authenticated source skips persistence | Only a locally authenticated writer owns durable persistence; lock-loser queues a complete store retry; two-replica regression forces the race and verifies merged state in PostgreSQL | Low |
| 6 | Cross-deployment collaboration traffic over shared Redis | High | Isolation | Two deployments sharing one Redis database exchange room traffic | Validated `DOCUMENTS_COLLAB_REDIS_PREFIX` deployment namespace, required in production; app and template env documentation synchronized | Low |
| 7 | Search stale after realtime edits | Medium | Correctness | Sidecar writes the DB directly and the index never refreshes | All persistence goes through `DocumentContentService.persist`, which reindexes; no raw-SQL bypass; freshness test | Low |
| 8 | Version restore clobbered by a live room | Medium | Correctness | Restore overwrites the DB but the in-memory room re-saves old state | Epoch-reset protocol with closing-flag store suppression, generation tagging, and a reversible pre-restore snapshot | Low |
| 9 | Plaintext bodies at rest (GDPR) | Medium | Privacy | Document and comment content readable in the DB or backups | Explicit documented trade-off (CRDT + search require plaintext); confidentiality via access control; consciously accepted | Accepted |
| 10 | CRDT storage growth unbounded | Medium | Storage | `yjs_state` grows forever | Debounced store writes persist compacted merged state; version snapshots capped and pruned; hard byte limits | Low |
| 11 | Client/sidecar extension drift | Medium | Correctness | A new editor extension breaks server HTML rendering, blanking search and export | Single shared `lib/editorConfig.ts` imported by both; materialization failure skips persisting html/text instead of writing empty strings | Low |
| 12 | New infra / sidecar down | Medium | Ops | Realtime unavailable in an environment without the sidecar | Editors degrade to optimistic-locked single-user autosave with unsaved-navigation protection; non-editing and revoked users stay read-only; env-gated, documented deploy | Low |
| 13 | Token rollover reads as an outage | Medium | UX | The 60 s expiry flashes "Realtime unavailable" every minute | Staged status machine with a reconnect grace window; fast bounded retry; transient failures retain the Y.Doc and queued edits | Low |
| 14 | Pagination writes measurements into shared state | Medium | Correctness | Browser measurement diverges across clients or pollutes undo/Yjs | Decoration-only plugin, metadata-only coalesced recompute, excluded from history, with serialization and Yjs assertions | Low |
| 15 | PDF export SSRF | High | Security | Server-side Chromium renders attacker-controlled `content_html` and fetches internal or metadata endpoints | Request interception aborts every non-`data:` subresource; JavaScript disabled; no cookies, tokens, or network access reach the renderer; URL-backed images stripped | Low |
| 16 | Record snapshot disclosure | Medium | Privacy | Field extraction copies contact or commercial data into a document shared more broadly than its source | Explicit subset selection with disclosure copy; revalidation immediately before the dialog opens; static snapshot semantics documented and tested | Accepted |
| 17 | Client bundle weight (TipTap/Yjs) | Medium | Perf | The editor bundle bloats the app | Literal dynamic imports (`ssr: false`), static no-eager-editor guards, and enforced production gzip budgets | Low |
| 18 | Watcher fanout latency | Low | Perf | A command at the 100-watcher cap performs ~100 access resolutions plus ~100 inserts in-request | Hard cap; fail-open post-commit projection; documented scaling path to a queued module worker | Accepted |
| 19 | Duplicate partial failure | Low | Correctness | A crash mid-copy leaves a half-created document | Hidden-until-finalized reveal plus compensating delete; worst case is a soft-deleted row and orphaned provider bytes, logged for operations | Low |
| 20 | Export fidelity below Word | Low | UX | `.docx` is not byte-identical to Word | Documented good-fidelity; acceptable for internal documents | Low |

## Test Coverage

The package ships **148 Jest suites / 962 tests** (147 suites / 958 tests run by default; the Redis-backed multi-instance suite is the sole default skip, contributing 1 suite / 4 tests, and runs separately against real Redis and PostgreSQL) plus **22 integration specs** `TC-DOCUMENTS-001`..`022` under `src/modules/documents/__integration__/`.

### Unit and component

Capability projection and owner/action-feature separation; `resolvePermission` tier resolution; archived capability clamping and route-level 403s on every archived mutation path; entity-registry availability, canonical links, safe labels, and type switching; picker keyboard, stale-response, pagination, and accessibility behavior; link command atomicity, optimistic locking, redaction, and undo/redo; template preview determinism, slot validation, bounded listings, and atomic instantiation; document and version preview sanitization with readable history labels; CRDT relative anchor encode/decode with legacy fallback; related-document widget context and labels; collaboration v2 token, origin, resource-limit, and room-invalidation behavior; reconnect grace, cleanup, and transient-versus-fatal token failures; collaborator caret hover/focus identity; PDF HTML/CSP/table selectors and the Chromium CSS-page-size option; pure page-break calculation and non-serialization; link-value redaction; safe ProseMirror field and table insertion; Redis persistence ownership and namespace isolation; notification DI resolution; migration reversibility and FKs; duplicate content pipeline, attachment byte-copy with URL rewrite, compensating delete, link re-verification, and undo semantics; favorite/watch idempotent toggles, soft-delete revive, watcher cap under the aggregate lock, and API-key rejection; watcher recipient resolution with actor exclusion and mention dedup; loading and rejected-import recovery; editor accessible names and selector keyboard behavior; fixed mobile page geometry; locale completeness and rendered UUID/GUID regression checks.

### Integration specs

| Spec | Covers |
|---|---|
| `TC-DOCUMENTS-001` | Documents CRUD, folders, optimistic lock |
| `TC-DOCUMENTS-002` | Sharing tiers — viewer content PUT 403, commenter body edit 403, editor 200, cross-organization principal denied, re-share upsert |
| `TC-DOCUMENTS-003` | Command-backed attachment upload, redacted audit snapshot, document-scoped proxy authorization |
| `TC-DOCUMENTS-004` | Cross-tenant read/write denial and the global-search non-leak |
| `TC-DOCUMENTS-005` | Threaded comments, real mention delivery, already-shared and role-shared access decisions, version snapshot/list/reversible restore |
| `TC-DOCUMENTS-006` | Export — docx `PK` artifact, real `%PDF-` (or graceful 503), non-shared 403, styled multi-page PDF with a table and rich text |
| `TC-DOCUMENTS-007` | Human-readable labels — `ownerLabel`, real `sharedWithCount`, comment `userLabels`, out-of-band mentions, version `createdByLabel`, no raw UUID |
| `TC-DOCUMENTS-008` | Template CRUD with manage-feature gating, instantiation, optimistic lock, cross-tenant isolation, export of a chip-bearing formatted document |
| `TC-DOCUMENTS-009` | Capability, folder, token, and readiness behavior |
| `TC-DOCUMENTS-010` | Typed links, redaction, reverse visibility, undo |
| `TC-DOCUMENTS-011` | Deterministic template preview and atomic instantiation |
| `TC-DOCUMENTS-012` | Safe version preview and restore |
| `TC-DOCUMENTS-013` | Preview mode, capability-aware editor chrome, edit/preview A4 geometry parity, absence of persisted pagination markers |
| `TC-DOCUMENTS-014` | Related-documents widgets on host record pages |
| `TC-DOCUMENTS-015` | Durable anchors under concurrent edits and deletion |
| `TC-DOCUMENTS-016` | All label-first selectors, contextual templates, picker-time and related-panel record-field insertion |
| `TC-DOCUMENTS-017` | Two-client token rollover, sustained sidecar interruption and recovery, revocation, optimistic single-user fallback save/conflict handling, paginated canvas, styled PDF |
| `TC-DOCUMENTS-018` | Live human and API-key role-share authorization, expiry, revocation, deletion, and scope isolation |
| `TC-DOCUMENTS-019` | Archive lifecycle — archive, default-list exclusion, `only` filter, read-only enforcement across every mutation route, unarchive, undo, live-session downgrade |
| `TC-DOCUMENTS-020` | Doc-to-doc links — picker-driven create, chip navigation, backlinks visibility filtering, self-link rejection, archived-target resolution |
| `TC-DOCUMENTS-021` | Favorites and duplicate — star/unstar with list filter, duplicate with content/attachment/link verification, dropped-link behavior, copy ownership |
| `TC-DOCUMENTS-022` | Watch — subscribe, exactly one watched notification with mention dedup, resolve/restore/archive delivery, unwatch, revoked-access watcher receives nothing |

Integration fixtures are created and cleaned up by each test and never rely on seeded or demo data. The multi-instance collaboration regression starts two Hocuspocus servers plus isolated Redis and PostgreSQL containers, edits through both replicas, and verifies the merged Yjs state in PostgreSQL; it runs as the unconditional, Docker-capable `documents-multi-instance` job in the main CI workflow (`yarn workspace @open-mercato/documents test:multi-instance`), independent of the standard Jest suite where it remains skipped by default.

## Final Compliance Report

**Shipped:** M1–M9 as the `@open-mercato/documents` workspace package (version 0.6.7) — 11 entities, 8 migrations, 26 API route files, 3 backoffice pages, 1 injection widget, 15 events, 3 notification types, 7 ACL features, 4 locales × 513 keys, and the Hocuspocus collaboration sidecar.

**Verification gate — green, in order (`Runner: local`):** `build:packages` → `generate` → `build:packages` → `i18n:check-sync` → `i18n:check-usage` (0 missing keys) → `typecheck` → `test` (24/24 turbo tasks) → `build:app`.

- Documents Jest suite: **147 suites / 958 tests pass**, 1 suite / 4 tests skipped (the Redis multi-instance regression), which passes separately against real Redis and PostgreSQL.
- Integration: `TC-DOCUMENTS-019`..`022` pass against a live app on the post-migration database (`4 passed`, 2026-07-18). The earlier full live production-app-plus-sidecar Documents suite passed 25/25 on 2026-07-13, covering reconnect/rollover, mention delivery and access projection, role-share authorization, and multi-step editor flows. Managed ephemeral runs pass for `TC-DOCUMENTS-003` and `TC-DOCUMENTS-018`.
- `.github/workflows/ci.yml` runs the Docker-backed two-sidecar regression as the required `documents-multi-instance` job rather than relying on the default-skipped Jest path.
- Create-app template tests pass (87/87), including recursive local-import parity for every shipped Documents template dependency.
- Production bundle measurement stays within the M8 budgets: 32.4 KiB gzip detail shell, 472.7 KiB gzip document editor, 418.5 KiB gzip template editor.
- Design-system compliance: no hardcoded status colours, arbitrary values, `dark:` overrides on status tokens, raw form elements, or raw `fetch` in module UI.
- Migrations generated for `documents` only and applied to a live PostgreSQL, confirming the `document_shares` partial unique `WHERE deleted_at IS NULL`.

**Known limitations carried forward, by design:**

- Global cross-entity document search stays `enabled: false` until the search layer gains a per-record visibility hook; discovery is via the permission-filtered list route, and `TC-DOCUMENTS-004` guards the non-leak.
- Document bodies, comments, and version snapshots are plaintext at rest (see Encryption & Search Field Policy).
- Authenticated attachment images are omitted from PDF export under the inert-renderer policy.
- Lost-access watcher rows count toward the 100-watcher cap until removed.
- Duplicate redo returns an error on primary-key reuse, matching the `instantiate` redo shape; duplicate undo tolerates post-duplication deletions of copied dependents (laxer than `instantiate`'s strict count check).
- The `OMDF1` Redis generation envelope predates the module's first release, so any future wire-version change requires a coordinated, non-overlapping sidecar rollout.

## Changelog

- **2026-07-08** — Spec created from the approved design and hardened by a pre-implementation backward-compatibility audit: concrete sidecar auth handshake (collab-token mint and verify), post-connect write enforcement and revocation, document-tier-gated image proxy, `DocumentContentService` search-freshness contract, explicit encryption and search field policy, epoch-reset version-restore protocol, shared editor config, local entity-id constants, re-share upsert, and a real PDF export endpoint. **M1–M4 implemented and verified**: shared-docs core (11 entities across the milestone set, per-document sharing, folders, CRUD APIs, image proxy, TipTap editor), the Hocuspocus realtime sidecar with collab-token handshake and live cursors, comments/@mentions with version history, and docx/PDF export.
- **2026-07-09** — **M5 implemented and verified**: TipTap keep-verdict recorded with sourced licensing and performance research; naked-GUID elimination via a shared `resolveUserLabels` and out-of-band comment mentions; Google-Docs UX (alignment, highlight, colour, undo/redo, outline, word count, inline rename); the `entityRef` chip node with an `@`-trigger EntityPicker; and `document_templates` with client-side instantiation and seeded defaults.
- **2026-07-13** — **M6–M8 implemented and verified**: `DocumentEntityLink` typed peer links with encrypted label snapshots and a seven-type registry; label-first selectors with no id fallback; the related-documents injection widget; contextual templates with server-side preview and atomic instantiation; explicit preview mode; durable Yjs relative comment anchors; staged realtime status with fast bounded reconnect; the inert styled A4 PDF builder; the presentation-only paginated canvas; authorized record-field insertion; Redis multi-instance fanout with persistence ownership, deployment namespacing, and generation tagging; intra-module foreign keys; and the enforced frontend bundle budget contract. Narrow additive platform seams (Auth, API Keys, Directory, Attachments, Notifications, Progress, Workflows, Shared, Events `crossProcessBroadcast`) were approved and recorded, and the create-app template gained the sidecar service and environment variables.
- **2026-07-18** — **M9 implemented and verified**: document-to-document links reusing the entity-link table with a visibility-filtered backlinks panel; the archive lifecycle with capability clamping, live-session downgrade, and undo; per-user favorites; document duplication as a hidden-until-finalized compensated sequence; and per-document watch subscriptions with delivery-time notification fanout. One additive reversible migration; no new platform seams, ACL features, or production dependencies. `TC-DOCUMENTS-019`..`022` pass live against the post-migration database.
- **2026-07-19** — Consolidated the three Documents specs (`2026-07-09-documents-ecosystem-integration-and-review.md`, `2026-07-17-documents-lifecycle-and-knowledge-fabric.md`, and the discharged M7 pre-implementation analysis) into this single M1–M9 spec and corrected the accumulated drift against the implementation: all seven original table names are plural (`documents`, `document_contents`, `document_folders`, `document_shares`, `document_comments`, `document_versions`, `document_attachments`) and the full set is eleven tables; the complete fifteen-event list is documented (adding `documents.document.duplicated`, `documents.link.created`, `documents.link.deleted`); seven ACL features including `documents.templates.manage`; `DOCUMENTS_COLLAB_JWT_SECRET_V2` as the operative secret with v1 as an optional legacy rollout path; the export route's `POST` paginated-snapshot method alongside `GET`; `document_contents.collaboration_generation`, `created_at`, and `deleted_at`; eight embeddable entity types; eight migrations; and one accurate test figure (148 Jest suites / 962 tests, 22 integration specs) replacing four contradictory counts.
- **2026-08-06** — Addressed final deployment and merge-readiness review: collaboration is now an opt-in Compose profile, Chromium is opt-in with the measured +1.02 GB image cost documented, invalid production collaboration endpoints degrade at runtime instead of aborting image builds, and the bundle-budget analyzer uses exact package-path markers and runs after `build:app` in CI.
