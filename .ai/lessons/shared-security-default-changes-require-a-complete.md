---
title: "Shared security-default changes require a complete consumer audit"
modules: ["shared","auth","cache"]
areas: ["integration","testing","module-data"]
topics: ["access-control","data-scoping","events"]
---

# Shared security-default changes require a complete consumer audit

**Context**: Hardening the shared rate-limit proxy-depth default fixed auth and metadata-driven consumers, but checkout public routes still passed a hard-coded trust depth of `1`.

**Problem**: A secure shared default has no effect when a downstream consumer overrides it. Direct checkout deployments could still trust attacker-controlled forwarding headers and rotate rate-limit buckets.

**Rule**: When changing a shared security default, enumerate every production call site and remove local overrides that bypass the contract. Centralize repeated key derivation in the owning module and add tests for direct, one-proxy, multi-proxy, and fallback behavior.

**Applies to**: shared auth, rate-limit, origin, session, encryption, and tenant-scoping helpers and every module that consumes them.

- 2026-07-10 · payment_gateways: mock-only idempotency coverage missed Stripe partial-refund terminalization and retry advancement → test production adapters, successor-state reconciliation, and rerunnable operation IDs.
- 2026-07-09 · customer_accounts: organization-scoped RBAC queries can still trust pre-hardening ACL caches → version the cache-key namespace when authorization semantics change
- 2026-07-10 · payment_gateways: a stale-claim lease without owner heartbeats can steal slow live provider calls; renew token-scoped leases during provider I/O and let followers wait for the shared result.
- 2026-07-09 · api_keys: Do not confuse a superadmin's immutable actor tenant with its intentional selected-tenant CRUD scope → fail-close organization arrays without overriding effective `auth.tenantId`.
- 2026-07-09 · customer_accounts: denial tests covered status but missed secondary side effects and complete same-org parity → assert every write/event/cache path stays untouched and exercise all affected positive routes
- 2026-07-10 · storage_s3: Temp-path tests hard-coded POSIX separators → build expected paths with `node:path` so Windows coverage stays valid.
- 2026-07-10 · ai_assistant: A TOCTOU test that swaps only before descriptor validation does not prove same-handle reads → also swap after identity validation and assert the validated descriptor content is returned.
