# Qualification evidence — @open-mercato/cache-provider-aws-elasticache

Recorded 2026-11-24 · package 0.11.0 · branch `cez/84f89130` · runner: local macOS (Docker 29.9.2, Node 26.12.1). Generic profile ids and stable codes only.

## Live profiles

| Profile | Status | Reason |
|---|---|---|
| `aws-valkey-node-cmd-disabled-iam-tls` — Valkey · node-based · cluster mode disabled · IAM · TLS | **unverified (blocked: no approved sandbox/credentials)** | No authorized non-production instance, identity or network path was provided. Live harness run with the profile selected and no environment recorded `blocked` (`missing:<variable names>`); 0 live tests executed. |

No profile of this package is supported. Promotion requires a protected live run per RUNBOOK.md.

## Preflight (not live evidence)

| Suite | Command | Result |
|---|---|---|
| Unit (Docker-free, default `yarn test`) | `yarn workspace @open-mercato/cache-provider-aws-elasticache test` | 43 passed, 0 failed (23 container/live tests skipped by design) |
| Container preflight — valkey/valkey:8.1 standalone, TLS-only, ACL (default user off) | `yarn workspace @open-mercato/cache-provider-aws-elasticache test:containers` | 22 passed, 0 failed (v1 conformance 16 incl. independent process + 6 managed identity/TLS/gate/packed) |
| Packed install (inside the container suite) | `yarn pack` of cache, cache-redis-protocol, cache-provider-managed-kit and this package → `npm install` into a fresh temp app | passed: only these four @open-mercato packages installed; gate closed ⇒ `unavailable` without evaluating settings; injected identity connects over TLS; provider tarball has LICENSE/README/RUNBOOK and kit tarball LICENSE/README, neither has tests/test-support, no secret patterns, no `workspace:` ranges; registration file typechecks |

Container preflight simulates the cloud identity with a fake credential source whose ACL password rotates; it proves re-AUTH on rotation, reconnect with the rotated credential, denied-credential failure without leakage, CA + hostname verification, non-mutating healthcheck, idempotent close and zero connections while the Enterprise gate is closed. It does not exercise the cloud's own identity service.

## Pinned client versions

ioredis 6.0.0 · @smithy/signature-v4 5.6.12 (Apache-2.0) · @aws-sdk/credential-provider-node 3.972.76 (Apache-2.0) · zod (workspace) · @open-mercato/cache-redis-protocol 0.11.0 (workspace) · @open-mercato/cache-provider-managed-kit 0.11.0 (workspace, private)
