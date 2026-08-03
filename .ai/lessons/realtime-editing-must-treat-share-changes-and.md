---
title: "Realtime editing must handle share changes and reconnects"
modules: ["documents"]
areas: ["backend-ui","module-data"]
topics: ["realtime","events","access-control"]
---

# Realtime editing must handle share changes and reconnects

**Context**: Live co-editing keeps a long-lived socket whose authorization tier is decided once, at connect time.

**Problem and rules**:

- A share **downgrade** (editor→viewer via `PUT /shares`) is not a revoke — it emits `documents.document.shared`, not `unshared`. A Hocuspocus `connection.readOnly` is set once at `onAuthenticate` and the token TTL is only re-checked on reconnect, so a demoted editor keeps a writable live socket. Make `documents.document.shared` `clientBroadcast: true` and force-close its room too.
- Because a share/downgrade/restore force-closes the collab room, a client that drops to a permanent read-only fallback on `provider.on('disconnect'|'close')` gets kicked to read-only after ANY share made while editing. HocuspocusProvider auto-reconnects and re-mints the token (picking up the current tier); the client must only fall back on a genuine INITIAL-connect timeout or `authenticationFailed`, and treat a mid-session disconnect as transient (`hasConnected` guard) rather than tearing the provider down.
- `@tiptap/extension-collaboration-caret` ships NO stylesheet — its default `render` only sets inline `border-color`/`background-color` on `.collaboration-carets__caret` / `__label`, so with no app CSS the caret is an invisible zero-width span and the name renders as a plain inline colored block. Its default `selectionRender` uses `${color}70` (~44% alpha) → a heavy solid highlight. Fix in TWO places: (1) supply structural CSS (`border-left-width:2px`, an absolute-positioned label pill that fades via keyframes and shows on `:hover`) scoped under a wrapper class, injected as a `<style>` in the client editor — colors stay data-driven from the inline styles; (2) pass a custom `selectionRender` returning `${color}33` (~20%) for a Google-Docs-style wash. Verify with TWO tabs (same login = distinct Yjs clientIDs, so each sees the other's caret) — a single session shows no remote caret.
