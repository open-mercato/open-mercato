---
title: "Realtime collaboration runtime: sidecar, shares, reconnects"
modules: ["documents"]
areas: ["integration","backend-ui","debugging"]
topics: ["realtime","package-runtime","access-control"]
---

# Realtime collaboration runtime: sidecar, shares, reconnects

## The sidecar runs outside the app runtime

**Context**: The documents Hocuspocus sidecar is a standalone MikroORM-v7 process launched with `tsx`, separate from the Next app.

**Problem and rules**:

- A standalone MikroORM-v7 process run via `tsx` mis-transpiles `@mikro-orm/decorators/legacy` as standard ES decorators (`Cannot read properties of undefined (reading 'constructor')`), and importing entities from `src` yields a different class identity than the ORM registers from `dist`. A sidecar/worker MUST import the package **dist** (`@open-mercato/<pkg>/…`), not `../src/…`; add `tsx` as a devDep so the run script resolves it. Package-level typecheck/jest pass regardless — only a live boot catches it.
- Hocuspocus `beforeHandleMessage` fires on EVERY inbound message and a throw **closes the socket**, so a "reject read-only writes" guard there severs legitimate viewers on their first sync. Use the native `connection.readOnly` (set in `onAuthenticate`) — it drops `syncStep2`/`update` while still serving reads/awareness — plus an `onStoreDocument` tier early-return. Verify hook payload field names against the **installed** `@hocuspocus/server` dist (v4 uses `connectionConfig` in auth and `lastContext` in store), not the generic docs.
- The sidecar does NOT load `apps/mercato/.env` and bootstraps DI from a discovered app root. To point it at a freshly-restarted ephemeral env it needs, explicitly: `DOCUMENTS_COLLAB_APP_ROOT=<abs apps/mercato>` (else `Could not find app root with .mercato/generated`), `DATABASE_URL=<new ephemeral DB port>` (testcontainers picks a NEW random port each start — read `.ai/qa/ephemeral-env.json`), and the mint/verify secret from `.env` (`set -a; . ./apps/mercato/.env; set +a` — the collab JWT secret falls back to `AUTH_JWT_SECRET`/`AUTH_SECRET`/`JWT_SECRET`, so app and sidecar must share the same env). Rebuild the documents **dist** before restarting so the sidecar and the ephemeral prod build both pick up source changes.
- The sidecar authenticates on `Origin`, so `DOCUMENTS_COLLAB_ALLOWED_ORIGINS` must list every host the app is actually browsed from — including a preview/port-forwarder origin, which is a different origin than the app's own base URL. Otherwise the upgrade is rejected with `[onAuthenticate] origin not allowed`, logged **server-side only**, and the editor sits on "Connecting…" showing `0 words` with nothing in the browser console.
- The same boundary applies to the export path's deps. The Next app build cannot see a workspace package's `src/types/*.d.ts` ambient shim, so an untyped dep used by a package route (`html-to-docx`) needs its `declare module` in `apps/mercato/types/<mod>/index.d.ts` (a `typeRoots` folder), and heavy Node CJS deps with dynamic requires (`puppeteer-core`) need `serverExternalPackages` in `next.config.ts`. Mirror both into the create-app template in the same change. Package typecheck passes; only `yarn build:app` surfaces either failure.

## Share changes and reconnects are first-class

**Context**: Live co-editing keeps a long-lived socket whose authorization tier is decided once, at connect time.

**Problem and rules**:

- A share **downgrade** (editor→viewer via `PUT /shares`) is not a revoke — it emits `documents.document.shared`, not `unshared`. A Hocuspocus `connection.readOnly` is set once at `onAuthenticate` and the token TTL is only re-checked on reconnect, so a demoted editor keeps a writable live socket. Make `documents.document.shared` `clientBroadcast: true` and force-close its room too.
- Because a share/downgrade/restore force-closes the collab room, a client that drops to a permanent read-only fallback on `provider.on('disconnect'|'close')` gets kicked to read-only after ANY share made while editing. HocuspocusProvider auto-reconnects and re-mints the token (picking up the current tier); the client must only fall back on a genuine INITIAL-connect timeout or `authenticationFailed`, and treat a mid-session disconnect as transient (`hasConnected` guard) rather than tearing the provider down.
- `@tiptap/extension-collaboration-caret` ships NO stylesheet — its default `render` only sets inline `border-color`/`background-color` on `.collaboration-carets__caret` / `__label`, so with no app CSS the caret is an invisible zero-width span and the name renders as a plain inline colored block. Its default `selectionRender` uses `${color}70` (~44% alpha) → a heavy solid highlight. Fix in TWO places: (1) supply structural CSS (`border-left-width:2px`, an absolute-positioned label pill that fades via keyframes and shows on `:hover`) scoped under a wrapper class, injected as a `<style>` in the client editor — colors stay data-driven from the inline styles; (2) pass a custom `selectionRender` returning `${color}33` (~20%) for a Google-Docs-style wash. Verify with TWO tabs (same login = distinct Yjs clientIDs, so each sees the other's caret) — a single session shows no remote caret.
