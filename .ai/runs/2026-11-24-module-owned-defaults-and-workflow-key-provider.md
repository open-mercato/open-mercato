# Execution Plan: Module-Owned Instance Config Defaults & Workflow One-Time Key Provider

- **Slug:** `module-owned-defaults-and-workflow-key-provider`
- **Branch:** `feat/module-owned-defaults-and-workflow-key-provider`
- **Base branch:** `fix/kernel-optional-module-gaps-9678` (stacked on PR #10129 per maintainer request)
- **Source doc:** `.ai/specs/2026-11-24-module-owned-instance-config-defaults.md`
- **Additional spec:** `.ai/specs/2026-11-24-workflow-one-time-key-provider.md`
- **Related:** Refs #10476, Refs #10508, stacked on #10129
- **Engine:** `om-auto-create-pr (steps: 7, --loop: no)`

## Goal

Move shipped instance configuration defaults (`notifications.delivery_strategies`, `vector.auto_index_enabled`) into their owning modules via an additive server-only `ModuleSetupConfig.instanceConfigDefaults` provider restored strictly and transactionally by Configs, and move Workflows `CALL_API` one-time API key issuance behind an API Keys-owned `apiKeyOneTimeIssuer` DI service.

## Scope

- **Phase 1 (Spec 1 — Module-owned instance config defaults):**
  - Characterize current `configs restore-defaults` and CLI help/init behavior before cutover (`packages/core/src/modules/configs/lib/__tests__/restore-instance-defaults.test.ts`, `packages/cli/src/__tests__/mercato.test.ts`).
  - Add optional `ModuleSetupConfig.instanceConfigDefaults` types in `packages/shared/src/modules/setup.ts`.
  - Declare defaults in `packages/search/src/modules/search/setup.ts` (preserving `vector.auto_index_enabled` legacy namespace and env precedence) and `packages/core/src/modules/notifications/setup.ts` (preserving `notifications.delivery_strategies` stored default config).
  - Implement validated catalog collection and strict transactional restore with unique-violation retry and post-commit cache publication in `packages/core/src/modules/configs/`, preserving existing `moduleConfigService.restoreDefaults` best-effort semantics for other callers.
  - Cut over `packages/core/src/modules/configs/cli.ts` to discover contributions from enabled modules without importing Notifications or hardcoding Search/Vector defaults.
  - Verify server/CLI discovery across app-local, workspace, and packed modules and client-bundle isolation.
  - Document the authoring property and legacy `vector` namespace in `apps/docs/docs/framework/modules/configs.mdx` and archive the Delta into `.ai/specs/capabilities/instance-config-defaults.md`.
- **Phase 2 (Spec 2 — API Keys provider for workflow requests):**
  - Characterize `CALL_API` identity, isolated-EM transaction visibility, cleanup, and missing-`api_keys` refusal behavior.
  - Add narrow `ApiKeyOneTimeIssuer` server contract in `@open-mercato/shared/lib/auth/principal-service.ts` (no workflow imports) and register `apiKeyOneTimeIssuer` in `packages/core/src/modules/api_keys/di.ts` wrapping `withOnetimeApiKey` on a context-detached EntityManager fork.
  - Cut over `packages/core/src/modules/workflows/lib/activity-executor.ts` (`executeCallApi`) to soft-resolve `apiKeyOneTimeIssuer` from the active execution container without importing `api_keys`, preserving translated missing-capability refusal, error/retry classification, role resolution, and HTTP/SSRF guards.

## Non-goals

- Implementing specs 3–6 from PR #10508 (`workflow-named-rule-provider`, `record-locks-audit-history-provider`, `record-locks-settings-initialization`, `owner-provided-example-workflow-seeding`).
- Adding database migrations, new HTTP routes, or UI surfaces.
- Changing existing `moduleConfigService.restoreDefaults` or `withOnetimeApiKey` public signatures or semantics.

## Risks

- **Strict restore rollback & cache coherence:** Partial catalog writes or premature cache writes on failure would leave setup inconsistent. Mitigated by validating all entries before opening a single transaction on a fresh EM and publishing cache only after commit.
- **Cross-namespace overwrites:** Arbitrary `legacyStorageNamespace` values could clobber another module's config. Mitigated by pinning `legacyStorageNamespace: 'vector'` exclusively to `search` + `auto_index_enabled` and rejecting all other cross-namespace writes and duplicate normalized keys before the first write.
- **CALL_API transaction visibility & auth boundary:** Issuing keys on the workflow's transaction-bound EM causes 401s on internal HTTP calls; failing to clean up leaks short-lived credentials. Mitigated by forking with `useContext: false` inside `apiKeyOneTimeIssuer` and delegating to `withOnetimeApiKey`'s `finally` cleanup.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Module-owned instance configuration defaults (Spec 1)

- [x] 1.1 Characterize current configs restore-defaults and CLI help/init behavior — 978e2e5dfc
- [x] 1.2 Add ModuleSetupConfig.instanceConfigDefaults and owner declarations in search and notifications — e4e0fef36a
- [x] 1.3 Implement strict transactional instance restore and cut over configs CLI with comprehensive tests — 1f6ff95f42
- [x] 1.4 Document authoring contract and archive instance-config-defaults Delta — d199725617, 8df6028d56

### Phase 2: API Keys provider for workflow requests (Spec 2)

- [ ] 2.1 Characterize CALL_API credential lifecycle, identity, and missing-api_keys behavior
- [ ] 2.2 Add ApiKeyOneTimeIssuer contract and api_keys DI registration
- [ ] 2.3 Cut over executeCallApi to soft-resolve apiKeyOneTimeIssuer with unit and decoupling tests
