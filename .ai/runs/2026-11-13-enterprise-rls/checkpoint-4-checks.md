<!-- rls-full-implementation-checkpoint-4 -->
🤖 `om-auto-continue-pr-loop` — full implementation checkpoint 4

Verified tenant continuations now cover customer signup/invitation, verified magic-link/email/reset tokens, authenticated customer login, and module-owned storefront/buyer work. New runtime imports use neutral execution-context APIs; enterprise runtime does not enumerate these business modules. Login/token subscribers are awaited within the verified tenant scope.

Verification (local Node 24 runner):
- Storefront/buyer: **119 tests across 9 suites pass**; core TypeScript check passes.
- Login and token routes: **27 tests across 3 suites pass**; core TypeScript check passes.
- Module-owned storage inventory: **347 explicit entries**; unknown tables still fail closed.
- Production pool/catalog regressions previously passed **16 + 23 live PostgreSQL 17 checks**, zero skips. Prototype implementation has been removed.

The native integration runner built the packages and real Next app. Its first test attempt failed before fixture creation on a database connection timeout during Docker instability. Its automatic retry has started the app; live deferred-render assertions are still pending. These unit results do **not** establish live HTTP/RSC or 20/30/50/100-user isolation.

PR remains draft. Remaining gates include public portal/provisioning paths, worker/scheduler and maintenance boundaries, independent pools, migration lifecycle, real CRUD/browser/concurrency evidence, the full ordered validation gate, independent security review, and a conflict-resolution subagent before merge readiness.
