# @open-mercato/documents

Collaborative internal documents for Open Mercato: a tenant/organization-scoped backoffice module where staff co-author rich-text documents in real time (TipTap + Yjs), organized in folders, shared per-document (owner / editor / commenter / viewer), annotated with inline comments + @mentions, versioned, and exported to `.docx`/PDF.

Spec: [`.ai/specs/2026-07-08-documents-collaborative-editor.md`](../../.ai/specs/2026-07-08-documents-collaborative-editor.md).

## Realtime collaboration sidecar (M2)

Real-time editing is served by a **Hocuspocus WebSocket sidecar** — a separate long-lived Node process, **not** a Next.js route (App Router route handlers can't hold long-lived sockets). Entry: [`server/documents-collab-server.ts`](server/documents-collab-server.ts).

### Run it

```bash
# Dev (from the repo root, alongside `yarn dev`):
yarn workspace @open-mercato/documents collab        # tsx server/documents-collab-server.ts

# Prod: build the app, then run the compiled/tsx entry as its own service.
```

The sidecar bootstraps the app's module registry + ORM via `bootstrapFromAppRoot()` (the same path the `mercato queue worker` fleet uses), then opens a fresh request-scoped container per document load/store so every query is tenant/org-scoped.

### Environment

| Var | Where | Default | Purpose |
|---|---|---|---|
| `DOCUMENTS_COLLAB_PORT` | sidecar | `4101` | WebSocket listen port |
| `NEXT_PUBLIC_DOCUMENTS_COLLAB_URL` | app (client) | — | `ws(s)://…` the browser connects to; when unset the editor degrades to read-only last-saved HTML |
| `DOCUMENTS_COLLAB_ALLOWED_ORIGINS` | sidecar | (all) | comma-separated allowed `Origin`s for the handshake |
| `DOCUMENTS_COLLAB_JWT_SECRET` | app + sidecar | derived from `JWT_SECRET` | optional dedicated secret for the collab token; when unset the token is signed/verified with a `documents-collab`-audience key derived from `JWT_SECRET` |
| `DOCUMENTS_COLLAB_APP_ROOT` | sidecar | auto-resolved | app root for `bootstrapFromAppRoot` (defaults to the resolved mercato app) |
| `DOCUMENTS_COLLAB_START` | sidecar | on | set `off` to import the module without auto-starting the server (used by tests) |
| `DATABASE_URL` | sidecar | — | required for the cross-process event bridge (force-close on unshare/delete/restore) |
| `DOCUMENTS_PDF_CHROMIUM_PATH` | app (M4) | auto-probe | Chromium/Chrome executable for PDF export (falls back to `PUPPETEER_EXECUTABLE_PATH` then common system paths) |

### Security model (the sidecar is the chokepoint)

1. The browser never holds the raw httpOnly session token. It calls `GET /api/documents/[id]/collab-token`, which verifies the session server-side, computes the caller's effective per-doc tier, and returns a **~60s** signed token scoped `{ userId, tenantId, organizationId, documentId, tier }` on a dedicated `documents-collab` audience (so it can never be replayed as a staff session).
2. `onAuthenticate` verifies the token (signature + expiry + audience), asserts `token.documentId === room` + tenant/org, sets `connection.readOnly` for viewer/commenter, and denies by default.
3. Write enforcement is Hocuspocus's native `connection.readOnly` (drops a read-only connection's `syncStep2`/`update` messages while still serving reads/awareness) plus an `onStoreDocument` read-only-tier early-return.
4. `onLoadDocument`/`onStoreDocument` open a **fresh request-scoped container per operation** and scope every `DocumentContentService` query by the token's `{ tenantId, organizationId }`. Persist writes `yjs_state` + materializes `content_html`/`content_text` + reindexes.
5. `documents.document.deleted` / `.unshared` / `.version.restored` (all `clientBroadcast: true`) reach the sidecar over the cross-process pg bridge and force-close the affected room; a "closing" flag suppresses the room's final store so a restore can't be clobbered.

### Degrade

If the sidecar is unreachable (or `NEXT_PUBLIC_DOCUMENTS_COLLAB_URL` is unset), the editor loads the last saved `content_html` **read-only** and shows a "realtime unavailable" state — no data loss (Postgres holds the last saved state).
