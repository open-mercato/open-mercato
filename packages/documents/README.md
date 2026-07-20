# @open-mercato/documents

Collaborative internal documents for Open Mercato: a tenant/organization-scoped backoffice module where staff co-author rich-text documents in real time (TipTap + Yjs), organized in folders, shared per-document (owner / editor / commenter / viewer), annotated with inline comments + @mentions, versioned, and exported to `.docx`/PDF.

Spec: [Documents collaborative editor](../../.ai/specs/2026-07-08-documents-collaborative-editor.md).

## Realtime collaboration sidecar (M2)

Real-time editing is served by a **Hocuspocus WebSocket sidecar** — a separate long-lived Node process, **not** a Next.js route (App Router route handlers can't hold long-lived sockets). Entry: [`server/documents-collab-server.ts`](server/documents-collab-server.ts).

### Run it

```bash
# Dev (from the repo root, alongside `yarn dev`):
yarn workspace @open-mercato/documents collab        # tsx server/documents-collab-server.ts

# Production package entry:
yarn workspace @open-mercato/documents build
yarn workspace @open-mercato/documents collab:prod

# Scaffolded standalone app (run as a second workload from the same image):
yarn documents:collab
```

The sidecar bootstraps the app's module registry + ORM via `bootstrapFromAppRoot()` (the same path the `mercato queue worker` fleet uses), then opens a fresh request-scoped container per document load/store so every query is tenant/org-scoped.

The create-app Docker Compose templates include a `documents-collab` service on port 4101. In other schedulers, run `yarn documents:collab` as a separate service and set `NEXT_PUBLIC_DOCUMENTS_COLLAB_URL` before building the app to its browser-reachable `ws://` or `wss://` endpoint.

### Environment

| Var | Where | Default | Purpose |
|---|---|---|---|
| `DOCUMENTS_COLLAB_PORT` | sidecar | `4101` | WebSocket listen port |
| `DOCUMENTS_COLLAB_REDIS_URL` | sidecar | unset (or `REDIS_URL`) | Redis used to synchronize Yjs updates and awareness across sidecar replicas. When neither is set the sidecar runs single-node mode and logs a startup warning; multi-instance deployments require Redis |
| `DOCUMENTS_COLLAB_REDIS_PREFIX` | sidecar | development-only local namespace | Deployment-scoped Redis key prefix. Required whenever Redis is configured in production. All replicas in one deployment must share it; deployments using the same Redis database must use different values |
| `NEXT_PUBLIC_DOCUMENTS_COLLAB_URL` | app (client) | — | `ws(s)://…` the browser connects to; when unset, users with edit capability get optimistic-locked single-user autosave while read-only users keep the last-saved view |
| `DOCUMENTS_COLLAB_ALLOWED_ORIGINS` | sidecar | local/test: all | comma-separated exact browser origins allowed during the WebSocket handshake. In production the sidecar requires an allowed origin, sourced from this var **or** `APP_URL`/`NEXT_PUBLIC_APP_URL` |
| `DOCUMENTS_COLLAB_JWT_SECRET_V2` | app + sidecar | unset (fails closed) | shared secret for v2 capability tokens; must contain at least 32 UTF-8 bytes. When unset the app mints no token and clients fall back to non-collaborative editing |
| `DOCUMENTS_COLLAB_JWT_SECRET` | app + sidecar | — | optional v1 rollout secret; the sidecar accepts legacy v1 tokens **only** while this is set to a ≥32-byte value that differs from the v2 secret |
| `DOCUMENTS_COLLAB_APP_ROOT` | sidecar | auto-resolved | app root for `bootstrapFromAppRoot` (defaults to the resolved mercato app) |
| `DOCUMENTS_COLLAB_START` | sidecar | on | set `off` to import the module without auto-starting the server (used by tests) |
| `DATABASE_URL` | sidecar | — | required for the cross-process event bridge (force-close on unshare/delete/restore) |
| `DOCUMENTS_PDF_CHROMIUM_PATH` | app (M4) | auto-probe | Chromium/Chrome executable for PDF export (falls back to `PUPPETEER_EXECUTABLE_PATH` then common system paths) |

### Security model (the sidecar is the chokepoint)

1. The browser never holds the raw httpOnly session token. It calls `GET /api/documents/[id]/collab-token`, which verifies the session server-side, computes the caller's effective per-doc capabilities, and returns a **~60s** v2 token scoped to the actor, tenant, organization, document, tier, and read-only state on a dedicated collaboration audience.
2. `onAuthenticate` verifies the v2 secret, expiry, audience, room binding, tenant/organization scope, and the browser `Origin`; viewer/commenter connections are read-only and failures deny by default.
3. Write enforcement is Hocuspocus's native `connection.readOnly` (drops a read-only connection's `syncStep2`/`update` messages while still serving reads/awareness), a fresh authorization check before every writable frame is applied, and an `onStoreDocument` read-only-tier early-return.
4. `onLoadDocument`/`onStoreDocument` open a **fresh request-scoped container per operation** and scope every `DocumentContentService` query by the token's `{ tenantId, organizationId }`. Persist writes `yjs_state` + materializes `content_html`/`content_text` + reindexes.
5. `documents.document.deleted` / `.unshared` / `.version.restored` (all `crossProcessBroadcast: true`, not browser `clientBroadcast` events) reach the sidecar over the cross-process pg bridge and force-close the affected room; a "closing" flag suppresses the room's final store so a restore can't be clobbered.

### Degrade

If the sidecar is unreachable (or `NEXT_PUBLIC_DOCUMENTS_COLLAB_URL` is unset), a user who still has edit capability gets an **editable single-user fallback**. It persists through the bounded content `PUT` path with the content row's optimistic-lock token, exposes explicit save status/control, and guards navigation while a save is pending. A definitive collaboration authorization rejection, revoked capability, viewer, or commenter remains read-only and fail-closed. PostgreSQL remains authoritative in both modes.

Redis replication is transport-only: the authenticated source replica owns
persistence and publishes its exact Yjs state only after that store succeeds.
A dedicated command-bounded publisher releases the store lock before fanout;
if Redis never acknowledges the release, the sidecar resumes after the lock's
expiry instead of retaining Hocuspocus' save mutex indefinitely. Redis
delivery failures retain and retry only the latest durable state for each room,
so post-store Redis recovery never blocks later PostgreSQL persistence. Each
durable frame carries the content collaboration generation, and replicas reject
pre-restore frames before they can merge stale Yjs structs into a replacement room.
The `OMDF1` generation envelope predates the module's first release. Any future
wire-version change must use a coordinated, non-overlapping sidecar rollout
(drain and restart every replica); mixed wire versions are intentionally rejected.
A receiving replica validates the complete merged state before applying or
broadcasting it and never competes for the durable store lock with an empty
authorization context. Receivers subscribe before reading their scoped
PostgreSQL snapshot and retain the loading Y.Doc until registration, so a
durable publish racing that read cannot be dropped. Set
`DOCUMENTS_COLLAB_REDIS_PREFIX` to the same deployment-specific value on every
replica so collaboration traffic cannot cross application environments that
share a Redis database.

The real multi-instance regression starts two Hocuspocus servers plus isolated
Redis and PostgreSQL containers, edits through both replicas, and verifies the
merged Yjs state in PostgreSQL:

```bash
yarn workspace @open-mercato/documents test:multi-instance
```

The main CI workflow runs this command as the required Docker-capable
`documents-multi-instance` job, independently from the standard Jest suite
where the test remains skipped by default.
