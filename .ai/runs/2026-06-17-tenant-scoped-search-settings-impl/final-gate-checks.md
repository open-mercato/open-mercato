# Final gate — tenant-scoped-search-settings-impl

**UTC:** 2026-06-17T15:40:00Z
**Branch head:** (fork) feat/tenant-scoped-search-settings-impl
**All 13 task rows:** done

## Full validation gate

| Check | Result |
|-------|--------|
| `yarn generate` | ✅ exit 0 |
| `yarn build:packages` (post-change) | ✅ 21/21 tasks successful |
| `yarn typecheck` (all 23 packages) | ✅ 21/21 successful, **0 `error TS`** |
| `yarn i18n:check-sync` | ✅ all translation files in sync (after `--fix` sorted the 4 new search keys) |
| `yarn i18n:check-usage` | ✅ no missing keys (3713 unused = pre-existing advisory) |
| `yarn test` (full unit suite) | ✅ green **except one documented environmental flake** — see below |
| `yarn build:app` | ⏳ deferred — heavy Next production build; `@open-mercato/app` typecheck passed (0 TS errors), so app types are clean. Run in CI. |

### Unit-test flake (not a regression)

The only failing unit suite is `@open-mercato/cli › src/lib/__tests__/dev-env-reload.test.ts › watches generated runtime files` (1 of 959 cli tests). This is the documented inotify-exhaustion flake on this machine: a live `fs.watch('.')` probe returns **ENOSPC** (`max_user_watches=65536` exhausted). It fails on any branch including clean `develop`; CI is green. This run touched **no** `@open-mercato/cli` code. Not a regression.

## Integration suites

| Suite | Result |
|-------|--------|
| `yarn test:integration` (Playwright/ephemeral stack) | ⏳ deferred to CI — local box cannot host the ephemeral stack reliably (inotify exhausted). New specs `TC-SEARCH-010` (settings source round-trip) and `TC-SEARCH-011` (unavailable-provider save guard) ship in this PR and run there. |
| `yarn test:create-app:integration` | ⏭️ skipped with justification — this run touched only `@open-mercato/core` (configs) and `@open-mercato/search`; no packaging, template, or shared-package export surface was changed, so the standalone/create-app path is unaffected. |

## Design System (ds-guardian)

- Only one UI file changed: `VectorSearchSection.tsx`. Self-check of the added lines (`git diff origin/fix/...HEAD`) found **no** arbitrary sizes (`text-[...]`/`p-[...]`/`z-[...]`), no raw Tailwind status colors, and no `dark:` overrides. New status text uses the semantic `text-status-warning-text` token; inheritance hints use `text-muted-foreground`. No residual findings.

## Self code-review + BC

- Code-review: scope confined to configs (core) + search; no cross-module ORM, tenant scope derived from auth only, no raw `fetch` added in app code (probe uses Node `fetch` server-side intentionally), no hardcoded user-facing strings (i18n keys added across en/pl/de/es).
- BC (`BACKWARD_COMPATIBILITY.md`): `ModuleConfigService` scope arg is optional and the no-scope path is byte-for-byte prior behavior; `ModuleConfigRecord` additions are additive; `module_configs` migration is additive (nullable columns + partial indexes, existing rows valid as instance default, no backfill); search API responses only add fields; new DI key `embeddingProviderProbe` is additive. The `isProviderConfigured('ollama')` always-true → probe-gated selection is a documented behavior fix (UPGRADE_NOTES).
