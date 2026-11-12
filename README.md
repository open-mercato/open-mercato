# PR #8377 Docker verification — 2026-11-12

Application source: 865ae2130306b4d56bf5ab5c17b7a6ef452c5d42.
Continuation head at execution: 7854878b9d755bd8f3d36940f027fff3b4db7dd8 (only the tracking plan differs).
Runner: Docker, Node v24.22.2 arm64; Docker Compose v5.6.1. The Compose test driver uses the host CLI and launches six real isolated Node 24 Compose startup cases; the other listed suites execute inside Node 24 containers.

212 tests passed, 0 failed, 0 skipped:
- Compose encryption/preflight: 29 (including six real startup cases across all three production copies).
- Env helper and starter: 71.
- Deployment compatibility, initialization safety and log policy: 43.
- Standalone setup fixtures: 38.
- CLI env helper Jest: 5.
- Runtime KMS and lookup hashing Jest: 20.
- Synthetic recovery and rollback: 6.

The recovery rehearsal bundles the PR's actual KMS and AES/lookup source. All keys are freshly generated in memory. PostgreSQL 16 runs on a temporary Docker network with no published ports and disposable storage. Four scoped encrypted fixture rows cover two tenants, a null organization and a system record, including inner credential envelopes. Owner-assisted resealing plus hash backfill, target-only decrypt/read/lookups, duplicate rejection and consistent snapshot rollback pass. Changing only secrets and rotating only outer envelopes correctly fail. The fixture snapshot is an isolated SQL table copy; this does not test pg_dump, the entities rotation CLI, a full application login, live Vault, installation-specific inventory, or real production migration. All fixture containers/networks were removed.

A first Jest launch using macOS dependencies lacked the Linux resolver binding. A Linux test-only binding was installed in a temporary tools directory and both normal Jest commands then passed; no repository dependencies or configuration were changed.

## Commands

```
OM_COMPOSE_ENCRYPTION_TEST_IMAGE=node:24 node --test scripts/__tests__/fullapp-compose-encryption.test.mjs
# The following execute inside node:24 Docker with the PR mounted read-only:
node --test scripts/__tests__/dev-env-file.test.mjs packages/starter/src/__tests__/starter.test.mjs
node --test scripts/__tests__/root-compose-backcompat.test.mjs scripts/__tests__/dev-initialization-safety.test.mjs scripts/__tests__/dev-orchestration-log-policy.test.mjs
cd packages/create-app && node --test src/lib/template-setup-infra.test.ts
cd packages/cli && node /workspace/node_modules/jest/bin/jest.js --config jest.config.cjs --runInBand --cacheDirectory /tmp/jest-cache src/lib/__tests__/env-example.test.ts
cd packages/shared && node /workspace/node_modules/jest/bin/jest.js --config jest.config.cjs --runInBand --cacheDirectory /tmp/jest-cache src/lib/encryption/__tests__/kms.test.ts src/lib/encryption/__tests__/lookupHash.test.ts
# Synthetic rehearsal; requires PostgreSQL fixture and /workspace/node_modules/pg:
node --test recovery-rehearsal.cjs
```

The recorded QA outcome covers the changed deployment/setup boundary and the documented synthetic recovery scenarios. Named human Emergency Security Exception approval remains a separate merge gate. Operators still must verify their own complete inventory and recovery before opening traffic.
