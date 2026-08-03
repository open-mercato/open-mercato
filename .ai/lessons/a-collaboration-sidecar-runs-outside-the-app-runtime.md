---
title: "A collaboration sidecar must import package dist, not src"
modules: ["documents"]
areas: ["integration","debugging","architecture"]
topics: ["package-runtime","build-output","realtime"]
---

# A collaboration sidecar must import package dist, not src

**Context**: The documents Hocuspocus sidecar is a standalone MikroORM-v7 process launched with `tsx`, separate from the Next app.

**Problem and rules**:

- A standalone MikroORM-v7 process run via `tsx` mis-transpiles `@mikro-orm/decorators/legacy` as standard ES decorators (`Cannot read properties of undefined (reading 'constructor')`), and importing entities from `src` yields a different class identity than the ORM registers from `dist`. A sidecar/worker MUST import the package **dist** (`@open-mercato/<pkg>/…`), not `../src/…`; add `tsx` as a devDep so the run script resolves it. Package-level typecheck/jest pass regardless — only a live boot catches it.
- Hocuspocus `beforeHandleMessage` fires on EVERY inbound message and a throw **closes the socket**, so a "reject read-only writes" guard there severs legitimate viewers on their first sync. Use the native `connection.readOnly` (set in `onAuthenticate`) — it drops `syncStep2`/`update` while still serving reads/awareness — plus an `onStoreDocument` tier early-return. Verify hook payload field names against the **installed** `@hocuspocus/server` dist (v4 uses `connectionConfig` in auth and `lastContext` in store), not the generic docs.
- The sidecar does NOT load `apps/mercato/.env` and bootstraps DI from a discovered app root. To point it at a freshly-restarted ephemeral env it needs, explicitly: `DOCUMENTS_COLLAB_APP_ROOT=<abs apps/mercato>` (else `Could not find app root with .mercato/generated`), `DATABASE_URL=<new ephemeral DB port>` (testcontainers picks a NEW random port each start — read `.ai/qa/ephemeral-env.json`), and the mint/verify secret from `.env` (`set -a; . ./apps/mercato/.env; set +a` — the collab JWT secret falls back to `AUTH_JWT_SECRET`/`AUTH_SECRET`/`JWT_SECRET`, so app and sidecar must share the same env). Rebuild the documents **dist** before restarting so the sidecar and the ephemeral prod build both pick up source changes.
- The sidecar authenticates on `Origin`, so `DOCUMENTS_COLLAB_ALLOWED_ORIGINS` must list every host the app is actually browsed from — including a preview/port-forwarder origin, which is a different origin than the app's own base URL. Otherwise the upgrade is rejected with `[onAuthenticate] origin not allowed`, logged **server-side only**, and the editor sits on "Connecting…" showing `0 words` with nothing in the browser console.
