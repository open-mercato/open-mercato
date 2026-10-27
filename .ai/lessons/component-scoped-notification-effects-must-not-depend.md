---
title: "Component-scoped notification effects must not depend on header chrome"
modules: ["notifications","events","ui"]
areas: ["backend-ui","integration","testing"]
topics: ["access-control","data-scoping","events"]
---

# Component-scoped notification effects must not depend on header chrome

**Context**: `TC-UMES-008` emitted a notification from a backend page and expected `useNotificationEffect` on that same page to react, but the effect stayed empty when notification dispatch only happened through the optional notification bell runtime.

**Problem**: Component-scoped reactive notification hooks become flaky when delivery depends on header actions such as notification bell visibility, feature-gated chrome, or lazy-loaded header components. The page-level hook contract should be tied to notification arrival, not to whether another UI surface happens to mount.

**Rule**: When building or changing `useNotificationEffect`-style APIs, subscribe directly to the DOM Event Bridge notification-created event where possible and dedupe with dispatcher delivery. Keep notification panel/bell state hooks as UI consumers, not the sole delivery path for component-scoped side effects.

**Applies to**: `packages/ui/src/backend/notifications/useNotificationEffect.ts`, notification dispatcher hooks, backend pages that use `useNotificationEffect`, and integration tests covering reactive notification behavior.
