---
title: "Integration tests: avoid `networkidle` on pages with SSE/background streams"
modules: ["events","catalog","customers"]
areas: ["integration","backend-ui","testing"]
topics: ["events","filters","package-runtime"]
---

# Integration tests: avoid `networkidle` on pages with SSE/background streams

**Context**: Multiple Sales/Integration UI tests started timing out at 20s in ephemeral runs. Failing point was `page.waitForLoadState('networkidle')` right after navigation.

**Problem**: Pages with SSE or other long-lived background requests may never reach Playwright `networkidle`, causing deterministic false failures unrelated to product logic.

**Rules**:

1. In integration tests/helpers, do not use `waitForLoadState('networkidle')` as a generic readiness gate on backend pages.
2. Prefer `waitForLoadState('domcontentloaded')` plus one explicit UI readiness assertion for the interaction target (for example, a key button/input becoming visible).
3. Keep selectors user-facing and stable (`Edit`, `Filter`) rather than translation keys or positional indexing (`nth(...)`) when possible.
4. For custom-entity record forms, prefer opening the records list first and waiting for the `Create` action to appear before entering the form; this proves definitions loaded in the current app state.
5. In custom-entity Playwright tests, target form controls via `data-crud-field-id="<fieldKey>"` instead of label-text ancestor traversal. The wrapper id is stable across monorepo and standalone layouts, while label-only selectors are brittle.

**Applies to**: `packages/*/__integration__/**` Playwright tests and shared integration helpers (especially sales, customers, and custom-entity flows).
