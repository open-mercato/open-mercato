# Extension Branches

Load only the selected branch.

- **Enricher:** exact target entity, namespaced additive result, scoped batched `enrichMany`, ACL, timeout/fallback, conservative cache behavior.
- **Interceptor:** exact route/method, schema-compatible request rewrite, additive response, timeout/fail posture, no auth/scope weakening.
- **Mutation guard:** operation mapping, wildcard features, explicit block/validated rewrite, post-commit callbacks, command/lock preservation.
- **Widget/menu:** stable widget/item IDs, exact spot, deterministic placement, headless declaration when possible, display plus execution authorization.
- **Extension entity:** app-owned scoped table, scalar host ID, scoped uniqueness, orphan/delete behavior, no cross-module ORM relation.
- **Subscriber:** declared event ID, persistent/idempotent decision, optional-host safe resolve, scoped command write, retry test.
- **Component override:** stable handle, preserve props/accessibility; prefer transform/wrapper.
- **Module override:** supported domain/key, key/value identity, `null` disable semantics, generation/cache/nav cleanup.

Run `yarn generate` for every discovered branch and verify generated registration selects the intended host exactly once.
