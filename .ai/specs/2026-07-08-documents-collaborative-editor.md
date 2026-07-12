# Documents — Collaborative Internal Docs Module

- **Date:** 2026-07-08
- **Status:** In progress (M1 targeted for first landing)
- **Scope:** OSS (`.ai/specs/`)
- **Package:** `@open-mercato/documents` (new workspace package) · module id `documents`
- **Author:** Platform team

## TLDR

A tenant/org-scoped backoffice module where staff author rich-text documents together in **real time**. Word-like editing (headings, bold/italic, lists, tables, links, images) on a **TipTap** surface, backed by a **Yjs** CRDT synced over a **Hocuspocus** WebSocket sidecar with **live-cursor presence**. Documents are organized in **folders**, shared **per-document** (owner / editor / commenter / viewer), annotated with **inline comments + @mentions** (firing OM notifications), kept in **version history**, and **exported to .docx/PDF**. Every layer is MIT/permissive-licensed and self-hosted. The sidecar's `onAuthenticate` hook is the security chokepoint that enforces OM session + org/tenant scope + per-document tier before a client may join a document room.

## Overview

Open Mercato has no collaborative document editor today. The closest primitives are single-user rich editors (`packages/ui/src/primitives/rich-editor.tsx`, the Lexical/MDXEditor markdown field), an SSE-only broadcast bridge (no bidirectional transport), enterprise **pessimistic** record-locking (designed to *prevent* concurrent edits), and a blob-storage attachments module. None of them provide concurrent multi-user editing.

This module adds that capability as a self-contained package, following the `packages/checkout/` workspace-package pattern and the `customers` module CRUD conventions. It introduces the platform's **first bidirectional real-time transport** (a Hocuspocus WebSocket sidecar) — an architectural addition the user explicitly approved during design (the AGENTS.md "Ask-First: provider-specific infra" gate is satisfied).

### Goals

- Real-time multi-user co-editing of a rich-text document, with live cursors/selections showing who is editing where.
- Per-document explicit sharing with viewer / commenter / editor tiers plus an owner.
- Folder organization (tree) and full-text search over document content that stays fresh after realtime edits.
- Inline comments + @mentions that notify mentioned users through OM's notification system.
- Version history with named/periodic snapshots and safe restore.
- Export to `.docx` and PDF (both real server-produced artifacts).
- Strict tenant/organization isolation everywhere, including on the WebSocket transport and on embedded images.

### Non-goals (v1)

- Not a customer-portal feature (backoffice only; portal is a future extension).
- Not a general Google-Docs replacement product (no public link sharing, no external anonymous collaborators).
- No pixel-perfect Word round-trip fidelity — export is good-fidelity, not byte-identical to Word.
- No client-side end-to-end encryption of document bodies (see Encryption & Search Field Policy — server-side CRDT merge + full-text search structurally require plaintext at rest; confidentiality is enforced by access control).
- No offline-first mobile client; no real-time on serverless (the sidecar is a long-lived process).
- No spreadsheet/presentation formats (Word-equivalent only).

## Problem Statement

Backoffice teams need to co-author internal documents (SOPs, meeting notes, proposals, internal wikis) without leaving Open Mercato for Google Docs / Word Online. The requirement is: a Word-equivalent editor, per-document sharing, simultaneous multi-user editing, and presence (who is editing, where their cursor is). The two hard prerequisites — a bidirectional low-latency transport and a conflict-free document model (CRDT) — are both absent from the platform and must be introduced.

## Proposed Solution

Deliver the module in four milestones so the new infrastructure is proven early and the heaviest/most license-sensitive piece (export) lands last. All four are in scope for v1; milestones are a build-order/risk sequencing, not a scope cut.

| Milestone | Delivers | Infra impact |
|---|---|---|
| **M1 — Shared-docs core** | Package + module scaffold; entities + migrations; per-doc sharing (shares table + tier resolution + ACL); folders; CRUD APIs; doc-scoped image proxy; docs list + folder tree; TipTap editor (single-user, async save writing `content_html`/`content_text`); `DocumentContentService` (persist + reindex); comments/versions APIs (schema + endpoints); search config; integration tests. | None (no new infra). |
| **M2 — Realtime + presence** | Collab-token mint route; Hocuspocus sidecar (`onAuthenticate`/`onLoadDocument`/`onStoreDocument` + read-only write enforcement + tenant-scoped queries + room-close on revoke); Yjs binding on the shared editor config; live cursors via Awareness; content materialization → `DocumentContentService`; dev/prod deploy wiring. | New WebSocket sidecar process. |
| **M3 — Comments/@mentions + version history** | Inline comment anchors + right-rail UI; @mention → OM notification; version snapshot timeline + safe restore (through the authoritative Y.Doc). | None. |
| **M4 — Export** | `.docx` export (MIT `html-to-docx`) + **PDF** export (permissive HTML→PDF renderer) — both real server endpoints + tests. | None. |
| **M5 — Deep OM integration + Google-Docs UX** | Editor-stack assessment (TipTap keep/wrap/migrate verdict); human-readable labels everywhere (zero naked UUIDs); Google-Docs UX features (align, highlight, text color, undo/redo, outline, word count, inline rename); embeddable business-entity chips (`@`-trigger + toolbar picker over customers/companies/deals/products/quotes); document templates with entity-data autofill; integration tests. | None (client-side HTTP coupling only). |

## Architecture

```
apps/mercato (Next.js, backoffice)
  @open-mercato/documents (new workspace package)
    src/modules/documents/
      backend/  → docs list · folder tree · editor page · share dialog · comments rail · versions panel
      api/      → /api/documents (CRUD) · /content · /folders · /shares · /comments · /versions
                  · /attachments (doc-scoped image proxy) · /collab-token (M2) · /export (M4)
      data/     → entities.ts (7 entities) · validators.ts (zod)
      lib/      → constants.ts (entity-id constants) · permissions.ts (effective per-doc tier)
                  · contentService.ts (DocumentContentService: persist + materialize + reindex)
                  · editorConfig.ts (SHARED TipTap extension set — imported by client AND sidecar)
      di.ts acl.ts events.ts setup.ts search.ts encryption.ts notifications.ts i18n/
    server/     → documents-collab-server.ts (Hocuspocus sidecar entry)

  Browser editor (TipTap + @tiptap/extension-collaboration[-cursor], editorConfig.ts)
        │  1) GET /api/documents/[id]/collab-token  → short-lived per-doc token (tier baked in)
        │  2) Yjs updates + Awareness over WebSocket (token in connection payload, not URL)
        ▼
  Hocuspocus sidecar  ──►  Postgres (via createRequestContainer + scoped EM)
     onAuthenticate  → verify collab-token · assert documentId==room · org/tenant · tier
                       editor/owner ⇒ readOnly=false ; viewer/commenter ⇒ readOnly=true (server-enforced)
     onLoadDocument  → DocumentContentService.load(docId, scope) → yjs_state → Y.applyUpdate
     onStoreDocument → DocumentContentService.persist(docId, scope, yDoc)  (yjs_state + html + text + REINDEX)
                                             (editorConfig.ts + @hocuspocus/transformer → @tiptap/html)
     onChange (share revoked / doc deleted event) → close affected rooms
```

- **Document body** is a Yjs document; its authoritative binary state lives in `document_content.yjs_state` (`bytea`). A human-readable `content_html` and a plain `content_text` are **materialized on store** for search, non-realtime render, and export.
- **Concurrency, two models by design:** the body uses Yjs (character-level CRDT merge — no optimistic lock). Document **metadata** (title, folder, sharing) is edited through `CrudForm`/`makeCrudRoute` and uses OM's standard `updated_at` optimistic lock. These are deliberately separate.
- **Presence** is Yjs Awareness (user id, display name, color, cursor/selection) rendered by `@tiptap/extension-collaboration-cursor`. It is ephemeral and never persisted.
- **Single source of editor truth:** the TipTap extension set lives in `lib/editorConfig.ts` and is imported by **both** the browser editor and the sidecar materializer, so server-side HTML rendering can never drift from client editing.

### Real-time transport (M2)

A **Hocuspocus** server runs as a separate long-lived Node process (`packages/documents/server/documents-collab-server.ts`). It is **not** a Next.js route (App Router route handlers cannot hold long-lived sockets). It boots its own DI/EM via `createRequestContainer()` and reuses OM's JWT verification.

- **Room** = document id (`documentName`).
- **`onLoadDocument`** / **`onStoreDocument`** go through `DocumentContentService`, whose every query is scoped by the authenticated `{ tenantId, organizationId }` (defense in depth beyond `onAuthenticate`), and whose `persist` both writes `yjs_state`/`content_html`/`content_text` **and** reindexes the document through the search indexer — so the normal query-index/search pipeline runs and content search stays fresh (no raw-SQL bypass).
- **Deploy:** dev — spawned alongside the OM dev runtime (env `DOCUMENTS_COLLAB_PORT`); prod — a separate service on the existing container platform. Client connects to `NEXT_PUBLIC_DOCUMENTS_COLLAB_URL`, restricted by a configured allowed-origins list.
- **Degrade:** if the sidecar is unreachable, the editor loads the last `content_html` read-only (Postgres holds the last saved state — no data loss) and surfaces a "realtime unavailable" state.
- **Scaling (optional):** the Hocuspocus Redis extension activates only when `DOCUMENTS_COLLAB_REDIS_URL` (or `REDIS_URL`) is explicitly configured — required for multi-instance sidecar deployments; without it the sidecar boots in single-node mode with a prominent startup warning. Document-affinity routing remains out of scope.

### Security & auth design (M2) — the sidecar chokepoint

Staff auth is an `httpOnly`, host-bound cookie; browser JS cannot read it and it will not auto-send to a cross-origin WebSocket. Therefore the client never handles the raw session token. Instead:

1. **Collab-token mint** — `GET /api/documents/[id]/collab-token` (Next route, auth via the httpOnly cookie, `requireFeatures: documents.view` + `resolvePermission`). It verifies the session server-side, computes the caller's **effective tier** on the document, and returns a **short-lived (~60s) signed token** scoped to `{ userId, tenantId, organizationId, documentId, tier, exp }`, signed with the platform JWT secret (dedicated `DOCUMENTS_COLLAB_JWT_SECRET` optional). The client passes this token as the Hocuspocus `token` (in the connection payload, never the URL) and re-mints on expiry/reconnect.
2. **Sidecar verify** — `onAuthenticate({ token, documentName })` verifies the token signature + `exp`, asserts `token.documentId === documentName` and tenant/org, then sets `context = { userId, tenantId, organizationId, tier }` and `connection.readOnly = (tier ∈ {viewer, commenter})`. Because the tier is baked into a short-TTL token minted per-doc, a share **downgrade or revocation propagates within one TTL** (the client must re-mint to keep a write connection; a downgraded user can only re-mint a lower tier).
3. **Write enforcement (not just UI)** — Hocuspocus's built-in `connection.readOnly` (set in `onAuthenticate` for viewer/commenter) is the message-level write rejection: it silently drops the connection's `syncStep2`/`update` messages while still serving reads + awareness, so a read-only client stays connected but cannot mutate the doc. `onStoreDocument` additionally returns early for a read-only tier (a persistence-layer double-check). (A throwing `beforeHandleMessage` guard is deliberately NOT used: that hook fires on **every** inbound message and a throw closes the socket, which would sever a legitimate viewer on their first sync — the native `readOnly` mechanism is both correct and non-destructive.) A stale editor cannot keep writing after losing access.
4. **Revocation belt-and-suspenders** — `documents.document.deleted` / `documents.document.unshared` events cause the sidecar to force-close affected rooms immediately, rather than waiting out the token TTL.
5. **Origin & transport** — allowed-origins check on the handshake; token in the connection payload; no session material in query strings or JS-readable storage.

## Data Models

New tables under the `documents` module (MikroORM v7, decorators from `@mikro-orm/decorators/legacy`, mirroring `packages/checkout` entities). All FKs are **within the module**; user/role/other-module references are stored as plain id columns (no cross-module ORM relations). Entity ids are referenced through a **local constants module** (`lib/constants.ts`, colon format e.g. `documents:document`), mirroring `packages/checkout`'s `CHECKOUT_ENTITY_IDS` pattern — not core's `E.*` shim. All tenant-scoped tables carry `organization_id` + `tenant_id`.

### `document`
| column | type | notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `organization_id` / `tenant_id` | uuid | scope |
| `title` | varchar(512) | |
| `folder_id` | uuid nullable | FK → `document_folder.id` (same module) |
| `owner_user_id` | uuid | cross-module id (no ORM relation) |
| `created_by_user_id` | uuid | |
| `is_active` | boolean default true | |
| `created_at` / `updated_at` / `deleted_at` | timestamptz | `updated_at` **required** for optimistic lock; `deleted_at` soft delete |

### `document_content` (1:1 with `document`)
| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `document_id` | uuid UNIQUE | FK → `document.id` |
| `organization_id` / `tenant_id` | uuid | scope |
| `yjs_state` | bytea nullable | authoritative CRDT binary (`@Property({ type: 'blob' })` → Buffer) — **plaintext** (see field policy) |
| `content_html` | text nullable | materialized on store — **plaintext** |
| `content_text` | text nullable | materialized on store (search source) — **plaintext** |
| `updated_at` | timestamptz | |

### `document_folder`
| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `organization_id` / `tenant_id` | uuid | scope |
| `name` | varchar(256) | |
| `parent_folder_id` | uuid nullable | FK → self (tree) |
| `owner_user_id` | uuid | |
| `created_at` / `updated_at` / `deleted_at` | timestamptz | |

### `document_share`
| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `organization_id` / `tenant_id` | uuid | scope |
| `document_id` | uuid | FK → `document.id` |
| `principal_type` | varchar(16) | `'user'` \| `'role'` |
| `principal_id` | uuid | user id or role id (cross-module id) |
| `permission` | varchar(16) | `'viewer'` \| `'commenter'` \| `'editor'` |
| `created_by_user_id` | uuid | |
| `created_at` / `updated_at` / `deleted_at` | timestamptz | |
| UNIQUE | partial `(document_id, principal_type, principal_id) WHERE deleted_at IS NULL` | **re-share undeletes/updates the soft-deleted row** (upsert), never blind-inserts, to avoid the known soft-delete+unique race |

### `document_comment`
| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `organization_id` / `tenant_id` | uuid | scope |
| `document_id` | uuid | FK → `document.id` |
| `parent_comment_id` | uuid nullable | FK → self (threads) |
| `author_user_id` | uuid | |
| `body` | text | **plaintext** (see field policy) |
| `anchor` | json nullable | Yjs relative position / range `{ from, to }` |
| `resolved_at` | timestamptz nullable | |
| `resolved_by_user_id` | uuid nullable | |
| `created_at` / `updated_at` / `deleted_at` | timestamptz | |

### `document_version`
| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `organization_id` / `tenant_id` | uuid | scope |
| `document_id` | uuid | FK → `document.id` |
| `label` | varchar(256) nullable | |
| `yjs_snapshot` | bytea | immutable CRDT snapshot |
| `content_html` | text nullable | rendered at snapshot time (preview) |
| `created_by_user_id` | uuid | |
| `created_at` | timestamptz | immutable — no `updated_at` |

### `document_attachment` (image/file association — doc-tier-gated access)
| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `organization_id` / `tenant_id` | uuid | scope |
| `document_id` | uuid | FK → `document.id` |
| `attachment_id` | uuid | id of the row in the attachments module (no ORM relation) |
| `created_by_user_id` | uuid | |
| `created_at` / `deleted_at` | timestamptz | |

Migrations generated via `yarn db:generate`; review SQL + update `migrations/.snapshot-open-mercato.json`. Generated entity ids produced by `yarn generate` (out-of-core package entities are folded into the consolidated map; the module references its own via `lib/constants.ts`).

## API Contracts

All routes are tenant/org-scoped, use `makeCrudRoute` where the shape fits (command-pattern writes + optimistic lock default-on), validate with zod, and return `updatedAt` on editable entities. Per-document permission is enforced in **every** route via `resolvePermission(documentId, ctx)` (in addition to the module ACL feature).

| Route | Methods | ACL feature | Per-doc tier | Notes |
|---|---|---|---|---|
| `/api/documents` | GET, POST | `documents.view` / `documents.create` | list → only docs the caller can see (owner ∪ shares ∪ `documents.manage`); create → owner = caller | list projects metadata only (no `yjs_state`) |
| `/api/documents/[id]` | GET, PUT, DELETE | `documents.view` / `documents.edit` / `documents.delete` | GET → viewer+; PUT title/folder → editor+; DELETE → owner or `documents.manage` | `updatedAt` optimistic lock on PUT/DELETE |
| `/api/documents/[id]/content` | GET, PUT | `documents.view` / `documents.edit` | GET → viewer+; PUT → editor+ | **M1 async path**: PUT persists via `DocumentContentService` (writes `content_html`+`content_text`+reindex), giving search a source before realtime. After M2 the sidecar owns live writes; this remains the read + degrade-fallback save. |
| `/api/documents/[id]/collab-token` | GET | `documents.view` | viewer+ (tier baked into token) | M2: mints the short-lived per-doc Hocuspocus token (see Security & auth design) |
| `/api/documents/folders` | GET, POST, PUT, DELETE | `documents.view` / `documents.edit` | folder-level (owner or `documents.manage`) | tree via `parent_folder_id` |
| `/api/documents/[id]/shares` | GET, POST, PUT, DELETE | `documents.share` | owner or `documents.manage` | manage the shares table; re-share upserts a soft-deleted row |
| `/api/documents/[id]/comments` | GET, POST, PATCH | `documents.view` | GET → viewer+; POST → commenter+; resolve → commenter+ or author | @mention in body → `documents.comment.mentioned` → notification |
| `/api/documents/[id]/comments/access-check` | POST | `documents.view` | viewer+ | returns mentioned user ids that currently lack explicit document access so the author can choose whether to share before notifying |
| `/api/documents/[id]/versions` | GET, POST, POST `/[versionId]/restore` | `documents.view` / `documents.edit` | GET → viewer+; snapshot/restore → editor+ | restore goes through the authoritative Y.Doc (see Version restore) |
| `/api/documents/[id]/attachments` | POST | `documents.edit` | editor+ | uploads via attachments module + records `document_attachment`; returns a doc-scoped url |
| `/api/documents/[id]/attachments/[attachmentId]` | GET | `documents.view` | viewer+ | **doc-tier-gated proxy**: checks `resolvePermission` then streams the attachment — embedded images are gated by doc tier, not merely org scope |
| `/api/documents/[id]/export` | GET `?format=docx\|pdf` | `documents.view` | viewer+ | M4: `.docx` via `html-to-docx`; **PDF** via a permissive HTML→PDF renderer — both return a real file artifact |

### Collab sidecar protocol (M2)

Hocuspocus over WebSocket at `NEXT_PUBLIC_DOCUMENTS_COLLAB_URL`. Not an HTTP route. Auth via the short-lived collab-token; `onAuthenticate` enforces scope + tier; read-only enforced at the message level. Message protocol is the standard Yjs sync + awareness protocol (opaque binary).

### Version restore protocol

Restore must not be a raw DB overwrite that a live room merges over: `Y.applyUpdate(liveDoc, oldSnapshot)` **merges** (it does not revert), and a live Hocuspocus room's final `onStoreDocument` would clobber a DB-only write. Restore is therefore an **epoch reset**, not a merge:

1. The restore endpoint records a **pre-restore snapshot** (reversible), writes the target `yjs_snapshot` to `document_content.yjs_state` (+ materialized `content_html`/`content_text` + reindex, via `DocumentContentService`), and emits `documents.version.restored` (**`clientBroadcast: true`**; payload carries `documentId` + `tenantId` + `organizationId`).
2. The sidecar consumes `documents.version.restored` over the cross-process bridge, marks the room **closing** — so its pending/last `onStoreDocument` is **suppressed** and cannot overwrite the just-restored state — and **force-disconnects** every connection in that room. Hocuspocus then unloads the cached in-memory `Y.Doc`.
3. Clients reconnect (the provider re-mints a token) and `onLoadDocument` seeds a fresh `Y.Doc` from the restored `yjs_state` — an epoch reload. In-flight pre-restore edits are dropped by design (they live only in the discarded in-memory doc); the pre-restore snapshot makes the whole operation reversible.

Residual race (Low, documented): between the endpoint's DB write and the sidecar receiving the event a live room could store once; the store-suppression on the *closing* flag plus the short event latency bound the window, and the pre-restore snapshot makes any such case recoverable.

## Access Control

- **Module ACL features** (`acl.ts`, ids immutable): `documents.view`, `documents.create`, `documents.edit`, `documents.delete`, `documents.share`, `documents.manage`.
- **Default role features** (`setup.ts`): `admin` → `documents.*`; a general staff role → `documents.view`, `documents.create`, `documents.edit`, `documents.share` (they still only touch docs they own or are shared).
- **Per-document tiers**: owner (full) > editor (read/write body, comment, snapshot/restore) > commenter (read + comment) > viewer (read). `documents.manage` is an org-admin override granting owner-equivalent access to all docs in the org.
- **`resolvePermission(documentId, ctx)`**: effective tier = max of (owner?, direct user share, role shares matching the caller's roles, `documents.manage` override). Enforced in every HTTP route **and** in the sidecar `onAuthenticate`. Deny by default; never trust `documentName`/route params without a scope + tier check.

## Events & Search

**Event ids** (`events.ts`, `createModuleEvents`, grammar `module.entity.action`, past tense):
- `documents.document.created`, `documents.document.updated` (`clientBroadcast: true` — refresh list/presence), `documents.document.shared`; **`documents.document.deleted` and `documents.document.unshared` are `clientBroadcast: true` in M2** so they cross the process bridge to the sidecar (which has no in-process view of the Next app's emits)
- `documents.comment.created`, `documents.comment.mentioned` (drives the @mention notification), `documents.comment.resolved`
- `documents.version.created`; **`documents.version.restored` is `clientBroadcast: true` in M2** → the sidecar force-closes the room for an epoch reload (see Version restore protocol)

`documents.document.deleted`, `documents.document.unshared`, and `documents.version.restored` are consumed by the sidecar (over the cross-process pg bridge, gated on `clientBroadcast: true`) to force-close/reset rooms; `documents.comment.mentioned` is consumed by `notifications.ts` to notify the mentioned user via `resolveNotificationService(container).create(...)`.

**Sidecar tenant isolation (M2):** the collab sidecar is a single long-lived multi-tenant process. It MUST create a **fresh request-scoped container per `onLoad`/`onStore` operation** (`createRequestContainer()` → a freshly-forked `EntityManager`), and every `DocumentContentService` query MUST be scoped by the `{ tenantId, organizationId }` from the **authenticated token's context** (never a shared/global EM, never the room name alone). This is defense-in-depth beyond `onAuthenticate` and is the mechanism that prevents cross-tenant leakage on the shared transport.

**`search.ts`** — search entity `documents:document`; `buildSource` joins `document.title` + the 1:1 `document_content.content_text` as the fulltext body; presenter shows title + folder + owner. **Search freshness** is guaranteed by `DocumentContentService.persist` reindexing on every materialization (M1 async save and M2 store), so realtime edits do not leave the index stale.

> **M1 security note (global search disabled):** Open Mercato's global cross-entity search is only feature-gated (`search.view`) and has **no per-record ACL hook** — so indexing per-document-private titles/content into it would expose them to any org user holding `documents.view`, bypassing per-doc sharing. Therefore the `documents:document` search entity ships `enabled: false` in M1; the reindex calls safely no-op. Document discovery in M1 is via the **permission-filtered list route** (`GET /api/documents?search=`, title match). Secure per-doc-filtered content search is deferred to a follow-up that adds a per-record visibility hook to the search layer (the `buildSource`/`fieldPolicy` config is retained, ready to re-enable). Sharing writes additionally **validate the principal exists in the caller's tenant/org** (cross-org/invalid principal → 400).

## Encryption & Search Field Policy

**Posture (deliberate, documented trade-off):** document bodies (`yjs_state`, `content_html`, `content_text`), comment `body`, and version snapshots are stored **plaintext at rest** and `content_text`/`title` are fulltext-indexed. Server-side CRDT merge (the sidecar operates on plaintext Yjs state) **and** full-text search both structurally require plaintext; field-level encryption of the CRDT is incompatible with the approved realtime design. True confidentiality would require client-side end-to-end encryption, which eliminates server materialization and search — explicitly out of scope for v1.

- **Confidentiality mechanism = access control:** per-doc tiers on every HTTP route and the WS transport, tenant/org scoping on all queries (including sidecar), and the doc-tier-gated image proxy.
- **`encryption.ts`** declares `defaultEncryptionMaps = []` **with an explicit comment** recording this trade-off, so the absence of field encryption is intentional, not accidental. (No structured PII fields exist in v1; a future such field would be added there.)
- **Search `fieldPolicy`:** `content_text` + `title` fulltext-indexed; `yjs_state`/binary excluded; comments searchable via the parent doc (not separately indexed in v1); vector/token search off by default.
- **Ask-First (GDPR):** this plaintext-at-rest posture is surfaced to the user for conscious acceptance in the run report. The architecture forces it for the approved feature set; the alternative is a future E2E variant that sacrifices search + server materialization.

## UI

Backoffice, DS-token compliant, `apiCall` only, i18n via `useT`, dialogs honor `Cmd/Ctrl+Enter` + `Escape`.

- **List page** (`DataTable`): title, folder, owner, shared-with count, updated; folder tree left rail; row actions (open, share, delete); create button.
- **Editor page**: TipTap toolbar (headings, bold/italic/underline/strike, lists, task list, **tables**, link, image, code block) built from `lib/editorConfig.ts`; presence avatars + live cursors (M2); comments right-rail (M3); version-history panel (M3); Share button → dialog; Export menu (M4). Editor dynamically imported (`ssr: false`).
- **Share dialog**: add user/role + tier, list/edit/remove current shares.
- **Image upload**: via `POST /api/documents/[id]/attachments`; the editor embeds the doc-scoped proxy url (`…/attachments/[attachmentId]`), never the raw `/api/attachments` url.

## Dependencies & Licensing (all MIT/permissive)

Client (`dependencies`): `yjs`, `@tiptap/core`, `@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`, `@tiptap/extension-collaboration`, `@tiptap/extension-collaboration-cursor`, `@tiptap/extension-table`(+`-row`/`-cell`/`-header`), `@tiptap/extension-image`, `@tiptap/extension-link`, `@tiptap/extension-task-list`/`-task-item`, `@hocuspocus/provider`. Server (sidecar): `@hocuspocus/server`, `@hocuspocus/transformer`, `@tiptap/html`. Export (M4): `html-to-docx` (`.docx`); PDF via a permissive HTML→PDF renderer (e.g. `puppeteer-core` [Apache-2.0] against a system Chromium, finalized at M4) — a **real** PDF artifact, not a print stub. New env: `DOCUMENTS_COLLAB_PORT`, `NEXT_PUBLIC_DOCUMENTS_COLLAB_URL`, optional `DOCUMENTS_COLLAB_JWT_SECRET`. Pin latest stable majors at implementation time (TipTap 3.x, Yjs 13.6.x, Hocuspocus current). **No** GPL/AGPL/commercial deps (CKEditor, BlockNote-XL, Liveblocks explicitly excluded).

## Backward Compatibility / Migration & BC

Every change is **additive**; no FROZEN/STABLE contract surface is modified. Verified in the pre-implement audit against ARCHITECTURE.md §27.

- New workspace package `@open-mercato/documents` — additive.
- `apps/mercato/src/modules.ts` gains one `enabledModules` entry (`{ id: 'documents', from: '@open-mercato/documents' }`); `apps/mercato/package.json` gains one `workspace:*` dep — the sanctioned additive registration (mirrors `checkout`).
- New event ids `documents.*`, new ACL feature ids `documents.*`, new DI keys (module-scoped), new API routes `/api/documents/*`, new env vars — all additive (ACL/event ids are FROZEN against rename/remove only; adding is allowed).
- New DB tables (7) via a new migration — additive; no existing-table changes.

Guard tests (`optimistic-lock-editable-entities`, `optimistic-lock-ui-coverage`, `module-decoupling`) are core-scoped and do not scan this out-of-core package; a **package-local guard test** asserts each editable entity exposes `updated_at` and its APIs return `updatedAt`.

## Risks & Impact Review

| # | Risk | Severity | Area | Failure scenario | Mitigation | Residual |
|---|---|---|---|---|---|---|
| 1 | Sidecar auth bypass / cross-tenant room join | Critical | Realtime/security | A client joins another tenant's doc room and edits | Client never holds raw session token; short-lived per-doc collab-token (tier+scope baked in); `onAuthenticate` verifies token, asserts `documentId==room` + tenant/org; sidecar queries tenant-scoped; deny by default; seam tests | Low |
| 2 | Write after losing access (downgrade/revoke) | High | Security | A viewer/commenter or downgraded editor keeps sending Yjs updates | Server-level `readOnly` message rejection; short token TTL forces re-mint at lower tier; `unshared`/`deleted` events force-close rooms | Low |
| 3 | Per-doc tier not enforced on a route | High | Security | A viewer PUTs content via direct API | `resolvePermission` gate in every route + per-tier integration tests | Low |
| 4 | Private-doc image leak | High | Security | An org user with an image URL reads a private doc's image | Doc-scoped attachment proxy checks `resolvePermission` before streaming; editor embeds only proxy urls | Low |
| 5 | Search stale after realtime edits | Medium | Correctness | Sidecar writes DB directly, index never refreshes | All persistence goes through `DocumentContentService.persist` which reindexes; no raw-SQL bypass; freshness test | Low |
| 6 | Version restore clobbered by live room | Medium | Correctness | Restore overwrites DB but in-memory room re-saves old state | Restore applies via the authoritative Y.Doc + broadcast/epoch; pre-restore snapshot recorded | Low |
| 7 | Plaintext bodies at rest (GDPR) | Medium | Privacy | Document/comment content readable in DB/backups | Explicit documented trade-off (CRDT+search require plaintext); access-control confidentiality; Ask-First user acceptance | Accepted |
| 8 | CRDT storage growth unbounded | Medium | Storage | `yjs_state` grows forever | Debounced store writes compacted merged state; version snapshots capped/pruned | Low |
| 9 | Client/sidecar extension drift | Medium | Correctness | New editor extension breaks server HTML render | Single shared `lib/editorConfig.ts` imported by both | Low |
| 10 | New infra / sidecar down | Medium | Ops | Realtime unavailable in an env without the sidecar | Editor degrades to read-only last-saved HTML (Postgres authoritative); env-gated; documented deploy | Medium |
| 11 | Client bundle weight (TipTap/Yjs) | Medium | Perf | Editor bundle bloats the app | Dynamic import (`ssr:false`), code-split editor route | Low |
| 12 | Export fidelity below Word | Low | UX | `.docx` not byte-identical to Word | Documented good-fidelity; internal-doc tolerant | Low |

## Integration Test Coverage

Module-local tests under `packages/documents/src/modules/documents/__integration__/TC-*.spec.ts`, self-contained (API fixtures, cleaned up in teardown), stable without seeded data. Per project rule they ship in the same change.

**API (M1):**
- Documents CRUD: create → list → get → update-metadata → soft-delete; tenant scope; **cross-tenant read/write denial**.
- Folders: CRUD + tree + move a doc between folders.
- Sharing tiers: owner shares as viewer/commenter/editor; **viewer PUT content → 403**, **commenter body edit → 403**, editor PUT content → 200, owner share/delete → 200; cross-org principal → denied; **re-share of a previously-removed principal upserts (no unique violation)**.
- Content endpoint: PUT/GET body writes `content_text` and the doc becomes searchable.
- Image proxy: editor uploads an image; a viewer of the doc can GET it; a non-shared org user → 403.
- Optimistic lock: stale `updatedAt` on metadata PUT → 409.

**API (M3):**
- Comments: create (commenter+), list, resolve; viewer comment → 403; @mention → notification row for the mentioned user.
- Versions: snapshot (editor+), list, restore (editor+); viewer snapshot → 403; restore records a reversible pre-restore snapshot.

**Sidecar (M2, jest seam):**
- Collab-token mint returns tier-scoped token; `onAuthenticate` — editor → read-write; viewer/commenter → read-only; non-shared user → reject; wrong-tenant/doc-mismatch → reject; expired token → reject; read-only connection's update message rejected. (Live co-editing itself is a documented **manual QA** scenario, not automated E2E.)

**Export (M4):**
- `GET /export?format=docx` and `?format=pdf` (viewer+) each return a valid file artifact for a document.

**Key UI paths (Playwright):**
- Docs list loads; create document; open editor, type + save; open Share dialog and add a share.

## Implementation Phases & Status

### M1 — Shared-docs core  _(LANDED — verified 2026-07-08)_
- [x] P1 · Package skeleton + module scaffold (`index/acl/di/events/setup/search/encryption/notifications/i18n` + `lib/constants.ts`, `lib/editorConfig.ts`); registered in `apps/mercato/src/modules.ts` + `apps/mercato/package.json`; `yarn generate`.
- [x] P2 · Entities (7) + validators + `yarn db:generate` migration + snapshot (partial-unique on `document_shares` verified applied to a live DB).
- [x] P3 · CRUD API routes (documents, `/content`, folders, shares, comments, versions, doc-scoped attachments proxy) + `resolvePermission` + `DocumentContentService` (persist + materialize + reindex) + tenant scope. Detail GET returns the caller's effective `tier`/`canShare`. Share writes validate the principal exists in the tenant/org.
- [x] P4 · Backend UI — docs list (DataTable + folder tree), editor page (TipTap single-user via `editorConfig.ts`, async save), share dialog. DS-clean.
- [x] P5 · M1 integration tests (TC-DOCUMENTS-001..004: CRUD/folders/optimistic-lock, sharing tiers, image proxy, cross-tenant denial + title search) + package-local guard test + `resolvePermission` unit test (19 jest tests) + full gate green. `search.ts` ships `enabled: false` for M1 (per-doc ACL gap — see M1 security note).

### M2 — Realtime + presence  _(LANDED — verified 2026-07-08)_
- [x] Collab-token mint route (`GET /api/documents/[id]/collab-token`, dedicated `documents-collab` JWT audience, ~60s TTL) + shared `lib/collabToken.ts` (mint/verify, audience-isolated); Hocuspocus sidecar (`server/documents-collab-server.ts`): `onAuthenticate` (verify token + assert `documentId===room` + tenant/org + set `connection.readOnly` for viewer/commenter, deny by default), read-only enforcement (native `connection.readOnly` message-level drop + `onStoreDocument` tier early-return), tenant-scoped `onLoad/onStore` via `DocumentContentService` (fresh request-scoped container per op), room force-close on `deleted`/`unshared`/`shared`(downgrade)/`version.restored` via the cross-process pg bridge, `isRoomClosing` store-suppression; bootstrap via `bootstrapFromAppRoot()` + `createRequestContainer()`. Sidecar consumes the package **dist** (entity-class identity + legacy decorators).
- [x] TipTap Collaboration + CollaborationCaret (v3) binding to a HocuspocusProvider (function token → re-mint on reconnect); Awareness live-cursor presence; materialization through the shared `editorConfig` (`lib/collabMaterializer.ts` + `@hocuspocus/transformer` + `@tiptap/html`).
- [x] Dev/prod deploy wiring (`collab` script + `README.md` + env: `DOCUMENTS_COLLAB_PORT`/`NEXT_PUBLIC_DOCUMENTS_COLLAB_URL`/`DOCUMENTS_COLLAB_JWT_SECRET`/`DOCUMENTS_COLLAB_ALLOWED_ORIGINS`); read-only degrade path when the sidecar is unreachable; sidecar seam tests (9 jest: editor→RW, viewer/commenter→RO, wrong-doc/expired/tampered→reject, tenant-scoped load, store-suppression) + collab-token unit tests (5). Sidecar boots live (Hocuspocus 4.3.0 listening, DI/ORM bootstrapped).

### M3 — Comments/@mentions + version history  _(LANDED — verified 2026-07-08)_
- [x] Comments right-rail + `MentionPicker` (queries `/api/auth/users`, degrades on 403) → `@[uuid]` token → notification; inline anchors (capture `{from,to}` selection, jump/highlight; absolute offsets — documented v1 drift); resolve sends the optimistic-lock header; viewers get no composer.
- [x] Version snapshot timeline + safe restore (epoch-reset protocol: DB write + `documents.version.restored` `clientBroadcast:true` → sidecar force-closes the room + suppresses the final store → clients reload the restored state; reversible pre-restore snapshot).

### M4 — Export  _(LANDED — verified 2026-07-08)_
- [x] `.docx` export (`html-to-docx`) + real PDF export (`puppeteer-core`, 503 without Chromium) at `GET /api/documents/[id]/export?format=docx|pdf` (viewer+, tier-gated); PDF renderer has an SSRF egress guard (request interception aborts all non-`data:` subresource fetches); Export menu (same-origin cookie download); integration tests (TC-DOCUMENTS-006 asserts docx `PK` + pdf `%PDF`/503 + non-shared 403).

## M5 — Deep OM Integration + Google-Docs UX (2026-07-09)

### Editor stack assessment (TipTap verdict: KEEP)

A team member raised two concerns: TipTap's license may not permit free commercial use, and TipTap degrades under heavy plugin load (suggesting Slate / raw ProseMirror / MDXEditor). Both were researched with primary sources (npm license fields, the tiptap monorepo LICENSE, tiptap.dev pricing/release notes, GitHub issues):

- **Licensing — unfounded for our dependency set.** `@tiptap/core@3.x` and every `@tiptap/extension-*`/`@tiptap/html`/`@tiptap/y-tiptap` package we use is **MIT** (verified npm `license` fields + repo `LICENSE.md`, © Tiptap GmbH). `@hocuspocus/*@4` is MIT. The paid line is Tiptap **Cloud/Pro services** (hosted collab, Content AI, DOCX/PDF import-export services, Comments-as-a-service, Pro registry) — none are dependencies: comments, versions, export, and mentions are in-house and collab is self-hosted Hocuspocus. 2024–2026 direction moved toward openness (10 formerly-Pro extensions MIT-relicensed June 2025).
- **Performance — the concern describes TipTap v2.** v2's real problem was React re-rendering on every transaction; v3 (which we ship) defaults `shouldRerenderOnTransaction: false` and provides selective `useEditorState` subscriptions. Remaining large-doc costs (node-view mount, huge selections) live in ProseMirror itself, so a raw-PM/Slate/MDXEditor rewrite cannot remove them. Slate is 0.x with a community collab story; MDXEditor is a markdown authoring component (no realtime, Lexical-based) — neither fits a shipped tiptap+yjs+hocuspocus module.
- **Verdict: keep.** Mitigations adopted: pin `@tiptap/*@3.x` + `@hocuspocus/*@4.x`; never add `@tiptap-pro/*` registry packages (procurement decision required); never set `shouldRerenderOnTransaction: true`; keep the editor isolated in its own island; prefer plain `renderHTML` chips over React node views for new nodes.

### Workstream A — Human-readable labels everywhere (naked-GUID elimination)

Audit findings (10) and fixes. A shared helper `lib/userLabels.ts` (`resolveUserLabels(em, scope, userIds) → Map<id, { label, secondary }>`) generalizes the shares-route resolver and is reused by every route below.

| # | Finding | Fix |
|---|---|---|
| 1 | List Owner column falls back to raw `ownerUserId` | list GET returns `ownerLabel` (name ?? email) resolved via `resolveUserLabels` |
| 2 | "Shared with" count always 0 (API never returns it) | list GET returns real active-share count per doc (single grouped query) |
| 3 | Comment author renders `shortenId(authorUserId)` | comments GET returns `userLabels` map (authors + resolvedBy + mentioned); rail renders names |
| 4 | Reply badge shows truncated comment UUID | render parent comment's author name + body snippet |
| 5/6 | Mentions stored/rendered as `@[uuid]` tokens; raw token visible in composer | **out-of-band mentions**: comment POST carries `mentions: [{ userId }]` (zod-capped `.max(50)` like sibling arrays); body stores plain `@Name` text only; new `document_comments.mentions` json column; notify/`grantAccessTo` use the **merged** set (input.mentions ∪ legacy parsed tokens); GET feeds legacy-token ids through `extractMentionedUserIds` into `userLabels` so old bodies render names (no data migration); comments POST OpenAPI description updated |
| 7 | Grant-access prompt falls back to truncated UUID | access-check response includes `label` per user id |
| 8 | Version creator renders `shortenId(createdByUserId)` | versions GET returns `createdByLabel` |
| 9 | ShareDialog falls back to raw id for deleted/foreign principals | render localized "removed user" placeholder instead of the id |
| 10 | PrincipalPicker manual-UUID degrade mode | **removed** (jury ruling): when the user/role directory is unavailable the picker shows a localized retryable error state — no manual-ID entry path remains anywhere in the module |

`resolveUserLabels` returns a localized "unknown user" fallback label whenever a lookup misses (deleted user, cross-org orphan) — applied uniformly by every consumer (list owner, comment authors, mentions, versions, access-check), so no code path ever falls back to the raw id. Mentions note: the server does **not** validate that each `mentions[]` entry textually corresponds to an `@Name` in the body — the legacy `@[uuid]` tokens were equally client-supplied with no correspondence check, recipients remain access-filtered before notification, so this is no regression (jury finding considered and dismissed).

### Workstream B — Google-Docs UX features

All new extensions are MIT `@tiptap/*@3.x` (verified published at 3.27.x). New deps: `@tiptap/extension-text-align`, `@tiptap/extension-highlight`, `@tiptap/extension-text-style` (TextStyle + Color), `@tiptap/extensions` (CharacterCount), `@tiptap/suggestion` (Workstream C).

**Extension partition (explicit — client/sidecar/export parity):**
- **Shared** (`getDocumentEditorExtensions`, consumed by client + sidecar materializer + export): `entityRef` node, `TextAlign` (paragraph+heading), `Highlight` (multicolor), `TextStyle` + `Color` — everything whose HTML must render identically server-side. All are DOM-free schema/mark definitions, safe in Node.
- **Client-only** (`getCollaborativeEditorExtensions` / island): the `@tiptap/suggestion`-based `@`-trigger plugin (DOM/positioning-dependent — MUST NOT enter the shared config or the Node sidecar), `CharacterCount`, `Placeholder`, Collaboration/CollaborationCaret (as today).

- **Text alignment** (left/center/right/justify) on paragraphs + headings — toolbar group. **Highlight** (multicolor palette) and **text color** (fixed palette; colors are document *content* — inline styles in the doc, not UI chrome, so DS token rules do not apply to the stored values). Both in shared `editorConfig.ts` (sidecar must render the marks' HTML).
- **Undo/redo toolbar buttons** — collab mode uses the Collaboration extension's Yjs undo manager commands; fallback mode uses StarterKit `undoRedo` (already conditionally enabled).
- **Document outline** — hand-rolled left pane computed from heading nodes on debounced updates (no new dep); click scrolls to/selects the heading.
- **Word/character count** — `CharacterCount` from `@tiptap/extensions`, status-bar display.
- **Inline rename** — the editor `<h1>` title becomes an editable field; save via existing metadata PUT (optimistic lock via `updatedAt`, conflict via `surfaceRecordConflict`). Closes the "no rename UI" gap.

### Workstream C — Embeddable business-entity chips

Users insert references to records from other modules; **never see or type UUIDs**.

- **Node:** inline atom node `entityRef` in the **shared** `editorConfig.ts`, attrs `{ entityType, entityId, label, href }` (label/href are insert-time snapshots — the sanctioned FK-id + snapshot pattern). `renderHTML` → `<span data-entity-ref data-entity-type data-entity-id data-href class="om-entity-ref">label</span>` **and a matching `parseHTML` rule on `span[data-entity-ref]`** (attrs read back from the data attributes) so `htmlToYDoc` template seeding, clipboard copy/paste, and the materializer round-trip all preserve chips. Plain HTML render, no React node view — identical output client-side, sidecar materialization, and export; docx/pdf show the label text. Cmd/Ctrl+click (via `editorProps.handleClick`, client-only) opens the record's backoffice page.
- **Insertion:** `@`-trigger in the document body via `@tiptap/suggestion` (client-only plugin) + a toolbar "Insert record" button — both open the same searchable **EntityPicker** (built on the module's existing combobox pattern; sectioned by entity type).
- **Registry (`lib/entityRegistry.ts`, client):** static list of embeddable types — `customer-person` (`GET /api/customers/people?search=`), `customer-company` (`/api/customers/companies`), `deal` (`/api/customers/deals`), `product` (`/api/catalog/products`), `quote` (`/api/sales/quotes`) — each with i18n label, item→`{ id, label, subtitle }` mapping, and backoffice href template (`/backend/customers/people/[id]`, `/backend/customers/companies/[id]`, `/backend/customers/deals/[id]`, `/backend/catalog/products/[id]`, `/backend/sales/quotes/[id]`).
- **Architecture compliance:** coupling is **client-side HTTP only** — the documents module never imports other modules' code or entities; the picker calls their public list APIs with the caller's session, so ACL enforcement is inherited (a user without `customers.deals.view` gets 403 → that type is hidden from the picker: graceful degrade, soft-optional integration). No server-side cross-module lookups, no ORM relations, no new contract surfaces.

### Workstream D — Document templates with entity autofill

Pre-configured document types (offer letter, meeting notes, deal summary) instantiated with system data; the user adds free text around it.

- **Entity `document_template`** (tenant/org-scoped, mirrors existing entity conventions): `id`, `organization_id`, `tenant_id`, `name` varchar(256), `description` text nullable, `body_html` text (TipTap-compatible HTML with `{{slot.field}}` tokens + optional `entityRef` chips), `context_slots` json (`[{ slot, entityType, required }]`), `created_by_user_id`, `is_active`, `created_at`/`updated_at`/`deleted_at`. One additive migration (together with `document_comments.mentions`).
- **API:** `/api/documents/templates` (GET/POST/PUT/DELETE) at `api/templates/route.ts` (module-id auto-prefix — never `api/documents/templates`), **hand-rolled on the module's `resolveDocumentsContext` + mutation-guard + `enforceCommandOptimisticLock` pattern with `api/folders/route.ts` as the exact template** (the module deliberately uses no `makeCrudRoute`; search stays `enabled:false`). Zod validators in `data/validators.ts` (name ≤256, `contextSlots` shape, caps mirroring siblings). ACL: list/read requires `documents.view`; manage (create/edit/delete) requires **`documents.templates.manage`** (new additive feature id; admin already covered by the `documents.*` wildcard grant).
- **Instantiation is client-side** (no new server endpoint, ACL-safe by construction): "New from template" flow → pick template → one `LookupSelect` picker per context slot (same registry as Workstream C) → tokens `{{slot.field}}` filled from the picked list-item fields (person: `name`/`email`/`phone`; company: `name`/`email`/`phone`; deal: `title`/`status`/`value`/`valueCurrency`; product: `title`/`subtitle`/`sku`; quote: `number`) plus `{{slot.chip}}` → an `entityRef` chip, `{{date}}` → localized today — then `POST /api/documents` + `PUT /api/documents/[id]/content` with the filled HTML → open the editor. **Every substituted value is HTML-escaped** (`< > & " '`) before insertion — entity data must never inject markup into the document body or exported artifacts (chip substitution inserts the escaped label inside the sanctioned `entityRef` span only). The collab sidecar already seeds a room from `contentHtml` when `yjs_state` is empty (`htmlToYDoc`), so no realtime changes are needed.
- **Template management UI:** `backend/documents/templates/page.tsx` (DataTable list + create/edit page using a single-user TipTap editor with the shared extension set + an "insert field token" dropdown per slot). Unresolved tokens (unfilled optional slots) are stripped at instantiation.
- **Seeded defaults:** `setup.ts` gains `onTenantCreated` (new tenants) + `seedDefaults` (init/backfill) seeding three example templates (offer letter, meeting notes, deal summary); idempotent via name-per-tenant existence check; bodies seeded in English (templates are user-editable *content*, not chrome — setup context carries no locale; documented decision).
- **Materializer hardening (deploy-skew guard):** adding `entityRef`/new marks to the shared config means a **stale sidecar dist** could fail `generateHTML` on content produced by a newer client; today the materializer's catch-all returns empty html/text which `onStoreDocument` would persist, transiently blanking search/export (yjs state stays intact). Fix in this milestone: on materialization failure the sidecar **skips persisting** html/text (keeps last materialized values) instead of writing empty strings; deploy note — rebuild the package and restart the sidecar with the client rollout.

### M5 API contract additions (all additive)

| Route | Change |
|---|---|
| `GET /api/documents` | + `ownerLabel`, `sharedWithCount` per item |
| `GET /api/documents/[id]/comments` | + `userLabels: Record<id,{label}>`; comment nodes + `mentions` |
| `POST /api/documents/[id]/comments` | + optional `mentions: [{ userId }]` (body no longer needs `@[uuid]` tokens; legacy tokens still parsed) |
| `POST /api/documents/[id]/comments/access-check` | + `label` per returned user id |
| `GET /api/documents/[id]/versions` | + `createdByLabel` per version |
| `/api/documents/templates` (new) | CRUD for `document_template` |

### M5 Integration Test Coverage

- **TC-DOCUMENTS-007 (labels):** list returns `ownerLabel` + real `sharedWithCount`; comments GET returns `userLabels` covering author + mentioned users; comment POST with `mentions` array notifies without `@[uuid]` in body; access-check returns labels; versions GET returns `createdByLabel`; **no raw UUID rendered** for these surfaces.
- **TC-DOCUMENTS-008 (templates + chips):** template CRUD (manage-feature gating: non-admin edit → 403; read with `documents.view` → 200); instantiation flow API-level (create doc + PUT filled content → GET content contains filled values and an `entityRef` span; unfilled optional tokens stripped); template optimistic lock (stale `updatedAt` → 409); cross-tenant template isolation; **export of a chip-bearing formatted document** (`?format=docx` returns a valid artifact for a doc containing `entityRef` + align/highlight/color marks).
- **Materializer round-trip (jest, sidecar parity):** `htmlToYDoc(html) → yDocToContent` preserves an `entityRef` span (all data attrs) plus text-align/highlight/color marks — proves the shared-config schema round-trips through the exact transform the sidecar runs; plus a failure-path test that a materialization error does **not** persist empty html/text (deploy-skew guard).
- **Key UI paths (preview QA, manual + screenshots):** insert an entity chip via `@` and via toolbar; create doc from template with slot pickers; rename inline; align/highlight/color/undo/redo; outline navigation; word count; comments with name-rendered mentions.

### M5 — Implementation Phases & Status

- [x] M5-P0 · Schema: `document_comments.mentions` json column + `DocumentTemplate` entity + validators + one additive migration (`Migration20260709164720_documents.ts`) + snapshot + `lib/constants.ts` entry.
- [x] M5-P1 · Server labels: `lib/userLabels.ts` + list GET (`ownerLabel`, `sharedWithCount`) + comments GET/POST (`userLabels`, out-of-band `mentions`, merged legacy tokens) + access-check `withoutAccessUsers` labels + versions `createdByLabel`.
- [x] M5-P2 · Editor lib: `entityRef` node (parseHTML+renderHTML) + align/highlight/color/character-count in `editorConfig.ts` (shared vs client split respected) + `lib/entityRegistry.ts` + `EntityPicker` component + `lib/entitySuggestion.ts` + 5 new `@tiptap/*@3` deps + materializer null-on-failure hardening (sidecar skips html/text overwrite).
- [x] M5-P3 · Editor island integration: toolbar groups (align/highlight/color/undo/redo/insert-record), `@`-suggestion wiring, `OutlinePane`, word count, inline rename (optimistic lock, conflict bar).
- [x] M5-P4 · Comments rail client: author/mention names via `userLabels`, out-of-band mention composer (no visible tokens), reply-to-name badge, grant-access labels, PrincipalPicker UUID-entry path removed (Alert + retry), ShareDialog removed-principal placeholder.
- [x] M5-P5 · Templates: hand-rolled CRUD API + `documents.templates.manage` ACL + management UI (TipTap body editor + insert-field tokens) + "New from template" flow (`lib/templateFill.ts`, HTML-escaped) + idempotent seeded defaults (`onTenantCreated` + `seedDefaults`).
- [x] M5-P6 · Integration tests TC-DOCUMENTS-007/008 — **9/9 documents specs pass live** against a fresh ephemeral env (real prod build + testcontainers Postgres, migration applied from zero, templates auto-seeded) + i18n 294 keys ×4 locales in sync + full gate green (build:packages→generate→build:packages→typecheck→test 23 pkgs→build:app) + DS-guardian pass (1 violation + 2 warnings fixed) + full preview QA sweep (template instantiation with entity autofill, realtime editing + Live pill, word count, highlight/align/color/undo/redo, outline, toolbar + `@`-trigger chip insertion, Cmd+click chip navigation, inline rename persistence, out-of-band mention composer with zero visible UUIDs, version creator labels, share picker, materialization fresh-edit round-trip, owner-label list column).

## Open Questions

- **Editor stack (TipTap concern)** — Resolved 2026-07-09: keep TipTap v3 (all deps verified MIT; perf concern was v2's re-render behavior). See "Editor stack assessment".
- **Realtime transport** — Resolved: Hocuspocus WebSocket sidecar (user-approved; Ask-First infra gate satisfied).
- **Sidecar auth handshake** — Resolved: short-lived per-doc collab-token minted by a Next route; sidecar verifies via OM JWT + `createRequestContainer()`; tier baked into the token (see Security & auth design).
- **Sharing model** — Resolved: per-document explicit sharing (owner + viewer/commenter/editor).
- **Module placement** — Resolved: dedicated `@open-mercato/documents` package.
- **Body encryption (GDPR)** — Resolved for v1 with a documented trade-off: plaintext at rest, confidentiality via access control (CRDT merge + search require plaintext). **Ask-First: surfaced to the user for conscious acceptance.**
- **PDF export** — Resolved: a real server PDF endpoint via a permissive HTML→PDF renderer (not a browser-print stub).

## Final Compliance Report

**Landed (verified 2026-07-08):** M1 — Shared-docs core, as a new `@open-mercato/documents` workspace package (54 files).

**Verification gate — all green:**
- `yarn build:packages` ✓ (documents package builds) · `yarn generate` ✓ (`E.documents.*` + registries) · `yarn build:packages` (post-generate) ✓
- `yarn typecheck` ✓ **0 errors** across 22 packages · `yarn test` ✓ **23/23 task-packages**, documents jest **19/19** (resolvePermission unit + `updated_at` guard)
- `yarn build:app` ✓ (Next app compiled successfully, documents routes/pages included)
- Migration ✓ generated for documents only (`db:generate` → "documents: no changes" no-op check) and **applied to a live Postgres**, confirming the `document_shares` partial-unique `WHERE deleted_at IS NULL`
- DS guard ✓ (0 hardcoded status colors / arbitrary values / raw fetch in the UI)

**Review (four-reviewer jury):** mandatory fresh Claude reviewer (Opus) + Codex + DeepSeek (Kimi skipped — CLI absent). Confirmed blockers, all fixed and re-verified:
1. Editor read-only for owners (detail GET omitted `tier`/`canShare`) — fixed (GET returns effective tier).
2. Global search leaked private document title/content (no per-record ACL) — fixed (`search.ts` `enabled: false` for M1; discovery via permission-filtered list route; TC-004 asserts the non-leak).
3. Share POST didn't validate the principal exists in tenant/org — fixed (User/Role scoped existence check; cross-org/invalid → 400).
4. Missing cross-tenant / cross-org test coverage — added (TC-DOCUMENTS-004).

---

**Landed (verified 2026-07-08):** M2 — Realtime + presence · M3 — Comments/@mentions + version history · M4 — Export, extending the `@open-mercato/documents` package (new sidecar + collab core + comments/versions UI + export; 70 files staged vs `develop`, no new entities/columns → no migration).

**Verification gate — all green:**
- `yarn build:packages` ✓ → `yarn generate` ✓ → `yarn build:packages` ✓ · `yarn typecheck` ✓ (22 packages) · `yarn test` ✓ (**5472 core + 33 documents** jest: collab-token audit ×5, sidecar-auth seam ×9, + M1 19) · `yarn build:app` ✓ (Next compiled; collab-token + export routes included)
- **Sidecar boots live** ✓ (Hocuspocus 4.3.0 listening; `bootstrapFromAppRoot` + `createRequestContainer` DI/ORM bootstrap; consumes package **dist** for entity-class identity + legacy decorators)
- **Live integration ✓ — 7/7 documents specs pass against the ephemeral prod env** (real Next prod build + testcontainers Postgres, migration applied from zero): TC-DOCUMENTS-001–004 (CRUD/folders/optimistic-lock, sharing tiers, image proxy, cross-tenant + no-global-leak), **TC-DOCUMENTS-005** (threaded comments + @mention notification row + version snapshot/list + reversible restore — M3), **TC-DOCUMENTS-006** (viewer docx `PK` + **real PDF `%PDF-`** via Chromium + non-shared 403 — M4). This live run is what surfaced blocker #5 (the entire module API was 404 before the fix).
- DS guard ✓ (0 hardcoded status colors / arbitrary values / raw fetch on new UI, all 4 locales in sync)
- No schema change (M2–M4 add no entities/columns; the M1 migration is unchanged)

**Review (four-reviewer jury):** mandatory fresh Claude reviewer (Opus, max thinking) + Codex 5.5 (xhigh) + DeepSeek V4 Pro (Kimi skipped — CLI absent). Cross-model: confirmed (codex + deepseek); Claude fresh-review FAIL→PASS after fixes. Blockers reconciled:
1. **PDF export SSRF** (Codex + Claude, confirmed) — server-side Chromium rendered attacker-controlled `content_html` with no egress guard → internal/metadata fetch. **Fixed**: `page.setRequestInterception(true)` aborts every non-`data:` subresource request.
2. **Share downgrade not enforced on a live socket** (Codex + Claude, confirmed) — a demoted editor kept `readOnly=false` until reconnect. **Fixed**: `documents.document.shared` is now `clientBroadcast:true` and in the sidecar force-close set, so a downgrade drops the room and clients re-mint at the lower tier.
3. **Empty `yjsState` → `Y.applyUpdate` throws** (Codex, confirmed) — a fallback-saved / empty snapshot broke room load. **Fixed**: `onLoadDocument` guards `yjsState.length > 0`.
4. **Sidecar ran from `src` under `tsx`** (caught by the live boot smoke) — MikroORM v7 legacy decorators mis-transpiled + entity-class-identity mismatch vs the ORM registration. **Fixed**: the sidecar imports the package **dist** (`@open-mercato/documents/…`); `tsx` added as a devDep for the `collab` script.
5. **API route module-prefix doubling** (CRITICAL, latent since M1; caught only by running the integration tests against a booted app) — route files lived under `api/documents/*`, and OM auto-prefixes the module id, so every route served at `/api/documents/documents/*` and the intended `/api/documents/*` 404'd — the **entire module API was unreachable** at runtime (build/typecheck/jest all passed because the URLs are strings; the M1 integration tests had been compiled + discovered but never executed live). **Fixed**: moved `api/documents/*` → `api/*` (matching the `customers` convention); module-root imports lost one `../`, `_shared`/sibling imports unchanged; `yarn generate` now emits `/documents/<resource>` (no doubling). Backend pages were unaffected.
- **Dismissed as spurious** (verified against the installed `@hocuspocus/server@4` dist, not the generic docs): DeepSeek's "`onAuthenticate` must use `connection` not `connectionConfig`" (the server builds the Connection from `hookPayload.connectionConfig.readOnly`) and "`onStoreDocument` must use `context` not `lastContext`" (the store payload field IS `lastContext`, populated). The fresh Claude reviewer independently confirmed both are non-issues.

**Non-blocking follow-ups (recorded, not in scope for this pass):** (a) an @mention notification embeds the document title for a mentioned org-user who has no share (same-tenant title disclosure; click-through still 403s) — harden by authorizing mention recipients; (b) the client editor drops to permanent read-only fallback on a transient socket blip instead of letting Hocuspocus auto-reconnect (UX robustness). Secure per-doc-filtered content search remains deferred (`search.ts` `enabled:false`) until the search layer gains a per-record visibility hook (TC-DOCUMENTS-004 guards the non-leak).

## Changelog

- **2026-07-08** — Spec created from approved design (brainstorming session). Four-milestone plan; M1 targeted for first verified landing.
- **2026-07-08** — Spec hardened after pre-implement BC/readiness audit + cross-model spec jury (Codex + DeepSeek): concrete sidecar auth handshake (collab-token mint + verify), post-connect write enforcement + revocation, doc-tier-gated image proxy, `DocumentContentService` search-freshness contract, explicit encryption/search field policy (plaintext trade-off, Ask-First), safe version-restore protocol, shared editor config (no client/sidecar drift), local entity-id constants, re-share upsert, and a real PDF export endpoint.
- **2026-07-08** — **M1 implemented and verified** (new `@open-mercato/documents` package). Full gate green (build:packages/generate/typecheck/test/build:app), migration applied to a live DB, four-reviewer jury passed after fixing three confirmed blockers (owner read-only editor, global-search per-doc leak, unvalidated share principal) and adding cross-tenant test coverage. M1 ships `search.ts` `enabled: false` (per-doc ACL gap); secure content search deferred to M2+.
- **2026-07-08** — Spec re-hardened during M2 shift-left jury: version-restore changed from a merge to an **epoch-reset** protocol (force-close + store-suppression + `clientBroadcast` on `version.restored`), explicit sidecar per-operation tenant-isolation invariant, and corrected read-only enforcement (native `connection.readOnly`, not a throwing `beforeHandleMessage` — that hook fires on every message and a throw would sever legitimate viewers).
- **2026-07-08** — **M2 + M3 + M4 implemented and verified** (realtime Hocuspocus sidecar + collab-token handshake + live cursors; comments/@mentions rail + version history; docx/PDF export). No new entities/columns (no migration). Full gate green (build:packages → generate → build:packages → typecheck 22 pkgs → test **5472 core + 33 documents** → build:app); sidecar boots live (Hocuspocus 4.3.0). Four-reviewer jury (fresh Claude Opus + Codex + DeepSeek; Kimi absent) fixed **3 confirmed blockers** — PDF-export SSRF (egress guard), share-downgrade not enforced on a live socket (`shared` now force-closes the room), empty-`yjsState` `Y.applyUpdate` crash (length guard) — plus a live-boot fix (sidecar consumes package **dist** for MikroORM v7 legacy decorators / entity-class identity; `tsx` devDep). Two DeepSeek "criticals" (`connectionConfig`/`lastContext` field names) dismissed as spurious after verifying the installed `@hocuspocus/server@4` dist. Non-blocking follow-ups: @mention title-disclosure to non-shared org users; client auto-reconnect UX.
- **2026-07-09** — **Editor UI follow-up implemented** (Documents Item 3): the client island keeps the M2 realtime token/provider/Y.Doc/awareness/degrade wiring but presents it as a Google-Docs-like backoffice surface with a sticky grouped toolbar, centered document page, in-canvas title, presence avatar stack, semantic status pill, client-only Placeholder extension, and TipTap v3 BubbleMenu selection toolbar. The page passes the document title into the island and wires bubble-menu comments to the existing comments rail through a pending selection anchor. No API, persistence, sidecar, or schema changes.
- **2026-07-09** — **Mention access prompt follow-up implemented** (Documents Item 2): comment creation now checks whether mentioned users can open the document, prompts share-capable authors to grant commenter access before notifying, and filters mention notifications to users with final document access. Added `POST /api/documents/[id]/comments/access-check` plus optional `grantAccessTo` on comment creation; no schema changes.
- **2026-07-09** — **M5 spec added** (Deep OM integration + Google-Docs UX): TipTap keep-verdict recorded with sourced licensing/perf research; naked-GUID elimination plan (10 audit findings, shared `resolveUserLabels`, out-of-band comment mentions with a new `mentions` json column); Google-Docs UX features (align/highlight/color/undo-redo/outline/word-count/inline rename); `entityRef` chip node + `@`-trigger EntityPicker over customers/companies/deals/products/quotes (client-side HTTP coupling, FK-id + label snapshot); `document_template` entity + CRUD + client-side instantiation with `{{slot.field}}` autofill + seeded defaults; TC-DOCUMENTS-007/008 coverage.
- **2026-07-09** — **M5 implemented and verified** (one additive migration: `document_templates` + `document_comments.mentions`). Full gate green (typecheck 22 pkgs · jest 51 documents tests · build:app · i18n 294 keys ×4 in sync); **9/9 documents integration specs pass live** on a fresh ephemeral env (templates auto-seed via `seedDefaults`); extensive preview QA of every editor/template/label flow. Four-reviewer gate: spec-stage jury (codex+kimi+deepseek — 7 confirmed design fixes incl. dropping the manual-UUID picker fallback, explicit shared/client extension partition, `entityRef` parseHTML, HTML-escaped substitution); code-stage jury (kimi+deepseek ran, codex skipped — 3 confirmed: graceful template-seed skip without tenant users, symmetric migration `down()`, bounded materializer warning set; 1 dismissed with evidence) + mandatory fresh Claude reviewer (2 confirmed blockers fixed: `String.replace` `$`-pattern injection in template fill [+ regression test], chip `data-href` restricted to same-origin paths). Preview QA fixes: list `ownerLabel` client mapping, StarterKit v3 link/underline dedupe, EntityPicker unmounts when closed, DS-guardian items (Alert error state, CheckboxField, Spinner). Non-blocking notes recorded: double-space collapse spans whole template body; `@`-cancel leaves the typed `@`; templates page shows manage actions to view-only users (server enforcement correct); rename 409 double-signals conflict; templates CRUD emits no module events (not spec-required).
- **2026-07-12** — **Full-branch code-review remediation (collab stack).** Redis extension made conditional: registered only when `DOCUMENTS_COLLAB_REDIS_URL`/`REDIS_URL` is explicitly set (multi-instance sync); otherwise the sidecar runs single-node with a startup warning instead of the previous production throw, and the silent dev `127.0.0.1:6379` default was removed. Fixed a persistence gap where a read-only `lastContext` silently dropped the debounced store: the sidecar now tracks the last writable authorization context per room and persists through the existing live re-authorization path. The collab-token route now short-circuits to the graceful non-collab response (`url: null`) when `DOCUMENTS_COLLAB_JWT_SECRET_V2` is missing or too short, eliminating the 500-retry loop (client falls back immediately). Comments list `pageSize` clamped to 100 (repo cap) with sequential client paging preserving the full-rail UX. The rename/delete 409 double-signal note above is resolved — all nine affected catch sites now gate the generic flash behind `surfaceRecordConflict`.
