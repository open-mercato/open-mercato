# Execution Plan: env-based preconfiguration for `storage_s3`

> Tracking GitHub issue: [#1968](https://github.com/open-mercato/open-mercato/issues/1968)
>
> Source spec: `.ai/specs/implemented/SPEC-045i-storage-hub.md` (this run is a follow-up addendum, not a new spec)
>
> Status: complete — PR #1999

## Goal

Bring `packages/storage-s3` up to the bar set by `gateway_stripe` / `sync_akeneo` for env-based preconfiguration: rerunnable CLI, hardened error logging, fully documented env block, doc page section, and unit coverage. Do this without changing the S3 driver, health check, or standalone API surfaces from #1617.

## Scope

- `packages/storage-s3/src/modules/storage_s3/cli.ts` (new)
- `packages/storage-s3/src/modules/storage_s3/setup.ts` (log preset errors via `IntegrationLogService` instead of `console.warn`)
- `packages/storage-s3/src/modules/storage_s3/lib/preset.ts` (no behavior change expected; only refactor if needed to support test wiring)
- `packages/storage-s3/src/modules/storage_s3/__tests__/cli.test.ts` (new)
- `packages/storage-s3/src/modules/storage_s3/__tests__/preset.test.ts` (new — orthogonal coverage for preset reader)
- `apps/mercato/.env` — add `OM_INTEGRATION_STORAGE_S3_*` block matching Stripe/Akeneo precedent
- `packages/create-app/template/.env.example` — mirror the block for new apps
- `apps/docs/docs/user-guide/storage-hub.mdx` — expand the existing env-preconfig section with the rerunnable CLI command and `--force` semantics
- README of nothing else; we keep the changes narrow.

### Non-goals

- Do not touch the S3 driver, health check, or standalone S3 API routes.
- Do not change credential storage format.
- Do not rework `credentialsEnvPrefix` on attachment partitions (orthogonal, per the issue).
- Do not introduce a new `OM_ENABLE_STORAGE_S3` flag rename. The flag already exists in `apps/mercato/src/modules.ts:141` and `packages/create-app/template/src/modules.ts:141` — we just clarify it in docs and ensure the .env block keeps it.

## Implementation Plan

### Phase 1: Provider CLI + setup hardening

1.1 Add `packages/storage-s3/src/modules/storage_s3/cli.ts` that:
- exports `[configureFromEnvCommand, helpCommand]` as the module's CLI surface (same shape as Stripe/Akeneo);
- parses `--tenant`, `--org`, `--force`, plus aliases `--tenantId`, `--orgId`, `--organizationId`;
- prints a help block listing the required and optional `OM_INTEGRATION_STORAGE_S3_*` env vars;
- calls `applyS3EnvPreset(...)` with services resolved via `createRequestContainer()` (DI names: `integrationCredentialsService`, `integrationLogService`); — falls back to `createCredentialsService(em)` / `createIntegrationLogService(em)` if the DI keys are missing in some apps;
- exits with `process.exitCode = 1` on `Incomplete S3 env preset` or any thrown error.

1.2 Update `packages/storage-s3/src/modules/storage_s3/setup.ts` so that preset failures during `onTenantCreated` are surfaced through `IntegrationLogService.error(...)` (scope-aware) instead of `console.warn`. The CLI path already propagates errors via thrown exception.

### Phase 2: Documentation

2.1 Add the `# S3 Storage Preconfiguration` block to `apps/mercato/.env` matching the Stripe/Akeneo blocks (including a comment that the CLI command is rerunnable).

2.2 Mirror the same block in `packages/create-app/template/.env.example` so freshly scaffolded apps get it.

2.3 Expand the `Environment-based preconfiguration` section in `apps/docs/docs/user-guide/storage-hub.mdx` to (a) call out the rerunnable CLI `yarn mercato storage_s3 configure-from-env ...`, (b) document `--force` + `OM_INTEGRATION_STORAGE_S3_FORCE_PRECONFIGURE`, (c) clarify the relationship with `OM_ENABLE_STORAGE_S3` (the module-enablement gate consumed in `modules.ts`).

### Phase 3: Tests

3.1 Add `packages/storage-s3/src/modules/storage_s3/__tests__/preset.test.ts` covering: missing env → null, full env → typed preset, optional fields preserved, `FORCE_PRECONFIGURE` parsing.

3.2 Add `packages/storage-s3/src/modules/storage_s3/__tests__/cli.test.ts` covering the CLI handler behavior with stub services: (a) missing env → skip, (b) full env → configure, (c) existing creds + no force → skip, (d) `--force` flag → overwrite, (e) malformed env (missing region) → non-zero exit code.

### Phase 4: Validation gate

4.1 Run `yarn build:packages`, `yarn generate`, `yarn build:packages` (post-generate), `yarn typecheck`, `yarn test`, `yarn i18n:check-sync`, `yarn i18n:check-usage`, `yarn build:app`.

### Phase 5: Manual smoke verification

5.1 Spin up the running app (`yarn dev`), set the env vars, exercise the rerunnable CLI (configured + skipped paths), and confirm the Integration logs UI shows the structured info/error log entry.

### Phase 6: Pull request

6.1 Open a PR against `develop`, apply `review`, `feature`, `documentation` labels, and post the comprehensive summary comment.

## Risks

- **DI key drift**: `integrationCredentialsService` / `integrationLogService` are the registered keys in the host app; the storage-s3 module's own `di.ts` does not register them. Mirror the gateway_stripe CLI exactly to avoid binding surprises. If host registry is missing, fall back to `createCredentialsService(em)`/`createIntegrationLogService(em)` to remain self-contained.
- **Container disposal**: Follow gateway_stripe's `finally { dispose }` pattern so DB connections close on exit.
- **Setup.ts swallowed errors**: When `IntegrationLogService.error(...)` itself throws (e.g. DB not ready during a partial tenant create), fall back to `console.error(...)` so we never crash tenant provisioning.
- **Env block bloat**: Keep the new block commented out by default so existing deployments are not impacted.

## Backward Compatibility

- All new behavior is additive. No existing import path, env var, or DI registration is renamed.
- `applyS3EnvPreset` already supports the `force?: boolean` parameter — we reuse it.
- The existing `onTenantCreated` flow is preserved; only the error-handling branch changes from `console.warn` to `IntegrationLogService.error`.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Provider CLI + setup hardening

- [x] 1.1 Add storage_s3 configure-from-env CLI — 44827dd6d
- [x] 1.2 Surface tenant-setup preset failures via IntegrationLogService — 44827dd6d

### Phase 2: Documentation

- [x] 2.1 Document env block in apps/mercato/.env — dd9bb63c5
- [x] 2.2 Document env block in packages/create-app/template/.env.example — dd9bb63c5
- [x] 2.3 Expand storage-hub.mdx with rerunnable CLI + force semantics — dd9bb63c5

### Phase 3: Tests

- [x] 3.1 Add preset.test.ts — 44827dd6d
- [x] 3.2 Add cli.test.ts — 44827dd6d

### Phase 4: Validation gate

- [x] 4.1 Run full validation gate — typecheck, tests, generate, build:packages, build:app green; lint blocked by a pre-existing eslint-plugin-react/`next.config.ts` incompatibility (also reproduces on `origin/develop`); i18n usage check is advisory (no new keys added).

### Phase 5: Manual smoke verification

- [x] 5.1 Exercise CLI in running app, confirm logs in Integration UI — verified five scenarios (missing env / full env / existing creds no-force / `--force` / incomplete env), info log persisted in `integration_logs`. Incomplete env exits 1 via the dispatcher's catch path (post-04753e982 fix).

### Phase 6: Pull request

- [x] 6.1 Open PR + labels + summary comment — PR #1999, labels `review` / `feature` / `documentation` / `needs-qa`.

### Phase 7: Deploy-hook ergonomics (`--all-tenants`)

> Added after initial PR opened. User asked whether the preset auto-applies on Dokploy redeploy; the honest answer was no, so we extended the CLI with a single command that iterates every active scope so a single deploy hook applies the preset without baking UUIDs into the deploy config.

- [x] 7.1 Add `--all-tenants` flag, lib helper `runConfigureFromEnvForScopes`, per-scope summary + exit semantics — 2a92f84db
- [x] 7.2 Unit-test coverage for the multi-scope flow (mixed configured+skipped, one-tenant-errors, all-skip, `--force` per scope) — 2a92f84db
- [x] 7.3 Document `--all-tenants` in storage-hub.mdx and both `.env.example` files — 2a92f84db
- [x] 7.4 Manual smoke verified against three real tenants: skip-all (creds present), configure-all (after wipe), incomplete-env → exit 1, mode-conflict → exit 1.
