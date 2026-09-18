---
title: "Use cryptographic randomness in auth-adjacent test helpers"
modules: ["auth","cache","communication_channels"]
areas: ["testing","integration","module-data"]
topics: ["data-scoping","generated-files","filters"]
---

# Use cryptographic randomness in auth-adjacent test helpers

**Context**: CodeQL reported insecure randomness in integration helpers where generated fixture values flowed through authenticated API requests and auth rate-limit tests.

**Problem**: Even when randomness is only used for fixture uniqueness, `Math.random()` can be flagged when the generated value is used in security-sensitive paths such as login attempts, tokens, credentials, rate-limit identifiers, or authenticated request setup.

**Rule**: Use `node:crypto` helpers (`randomInt`, `randomUUID`, or `randomBytes`) for any generated value that may touch auth, security checks, identifiers, request headers, or authenticated API calls. Reserve `Math.random()` only for explicitly non-security demo data, and prefer deterministic fixtures when uniqueness is not required.

**Applies to**: integration helpers, auth tests, rate-limit tests, fixture factories, temporary IDs, generated emails/passwords, and any test utility that feeds API requests or security-sensitive code paths.

- Notification read scopes must distinguish selected, unrestricted, no-access, and omitted legacy semantics in filters, cache behavior, and isolated integration fixtures.
- 2026-07-11 · shared data engine: tenant-scope tests covered explicit null but not omitted scope → parameterize non-null, null, and omitted tenantId for every predicate path.
