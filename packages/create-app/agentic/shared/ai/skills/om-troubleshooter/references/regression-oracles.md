# Regression Oracles

Load the relevant oracle family before implementing the fix.

- **Scope:** two tenants/two orgs, permitted/denied/null/all-org/wildcard; invalid scope never widens.
- **Atomic write:** inject failure between phases; no partial data or premature event/cache/index side effect.
- **Locking:** current update succeeds; stale update/delete/action returns structured 409 and UI conflict.
- **Field:** create, reload, edit, clear to null, reload; request/DB/response/UI agree.
- **Bootstrap:** same registry/service behavior in browser/server, CLI, worker, and queue from packed install.
- **Cache/search:** immediate write read uses defined consistency; convergence polling has deadline and no arbitrary sleep.
- **Hydration:** server/client initial output matches across representative locale/timezone/environment.
- **Provider:** duplicate/concurrent/retry/timeout/page failure; idempotency and cursor/mapping state remain correct; secrets absent.

The oracle must fail on the pre-fix code for the intended reason and clean up its own fixtures.
