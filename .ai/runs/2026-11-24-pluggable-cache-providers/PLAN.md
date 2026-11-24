# Pluggable cache providers — v1 host (PR 1 of 3)

Source spec: .ai/specs/2026-11-24-pluggable-cache-providers.md
Spec PR: #10512 (merged)
Branch: feat/pluggable-cache-providers
Follow-up PRs (stacked): OSS engine packages (`.ai/specs/2026-11-24-oss-cache-provider-packages.md`), Enterprise managed providers (`.ai/specs/enterprise/2026-11-24-managed-cloud-cache-providers.md`)

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `om-auto-continue-pr-loop`. Step ids and `Exec` cells are immutable once the plan is committed — per-Step commits touch only `Status` and `Commit`.

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| 1 | 1.1 | Characterize stock cache selection, bootstrap fallback, readiness and purge | dispatch | done | d5750d82f1 |
| 1 | 1.2 | Provider contract entry point with registration validation and settings resolution | group:A:capable | done | 0afb97ccb8 |
| 1 | 1.3 | Cache service provider selection with lazy strategy handle and lifecycle | group:A:capable | done | 89a7cb1ca9 |
| 1 | 1.4 | App cache-provider manifest generator and CLI manifest loader | dispatch:capable | done | dca2d3fcd9 |
| 2 | 2.1 | Wire provider resolution into core bootstrap paths and app bootstrap | group:B:capable | done | 925117933f |
| 2 | 2.2 | Effective selection drives readiness, multi-instance guard and OAuth warning | group:B:capable | done | a52600558c |
| 2 | 2.3 | Post-generate structural purge through the generated manifest | group:B:capable | done | f7a9f0a178 |
| 2 | 2.4 | Provider conformance kit and independently packed fixture provider | dispatch:capable | done | e873cea74a |
| 2 | 2.4-review-fix | Export physical key layout and document provider decode and count contract | inline | done | a98efd0dbb |
| 2 | 2.4-checkpoint-fix | Pass cache env through turbo generate and name the provider readiness probe | inline | done | efaa89e19e |
| 2 | 2.5 | Provider-author and operator docs, env examples and template sync | dispatch | done | 48805b4a2b |
| 2 | 2.6 | Archive Delta into capabilities spec | inline | done | 191be38f6c |
| 3 | 3.1-review-fix | Sanitize runtime provider operation and close errors | inline | done | 3e45aa6048 |
| 3 | 3.2-review-fix | Ignore registrations when unselected and key the selection memo | inline | done | 1bcf6de1c0 |
| 3 | 3.3-review-fix | Provider init retry cooldown and terminal closed state | inline | done | 2008ab07e7 |
| 3 | 3.4-review-fix | Defer the OAuth cache warning until the provider selection is prepared | inline | done | 7c31d651c5 |
| 3 | 3.5-review-fix | Scrub DSN secrets in provider logs and show provider selection on system status | inline | done | 08179f62c0 |
| 3 | 3.6-review-fix | Document sanitized runtime errors, unselected registrations, retry cooldown, closed state and generate env | inline | done | 412004323e |
| 3 | 3.7-review-fix | Give the conformance kit sort an explicit comparator | inline | done | 5470e2d6a9 |
| 3 | 3.8-review-fix | Own the Redis URL and wire-protocol helpers in the cache package | inline | done | 517be0947b |

## Goal

Let a deployment select an explicitly registered npm cache provider (`CACHE_PROVIDER=<id>`) with provider-owned typed settings, through the existing `cache` DI service, with no package-specific core change and no silent fallback to memory.

## Scope

- `packages/cache`: new server-only `@open-mercato/cache/provider` entry (contract, registration, resolution, errors), `CacheServiceOptions.provider`, lazy provider strategy handle, effective-selection descriptor, `@open-mercato/cache/testing` conformance kit, packed fixture provider under `packages/cache/fixtures/`.
- `packages/cli`: `cache-providers` generator for `<app root>/mercato.cache.ts`, manifest loader for CLI/worker/scheduler, post-generate purge, single-instance guard input.
- `packages/core`: bootstrap provider failure path (no memory substitution), OAuth warning.
- `packages/shared`: request container optional-bootstrap catch must not swallow provider selection errors; maintenance re-export.
- `apps/mercato`: healthz probe uses effective selection; bootstrap-common registers manifest; `.env.example` (+ create-app template sync).
- Docs: `apps/docs` provider-author/operator page, `packages/cache/AGENTS.md`.

## Non-goals

- Any engine adapter package (PR 2 / PR 3).
- Queue, rate-limiter, event transports; per-tenant provider selection.
- Changing stock strategies, wire formats, or legacy precedence when `CACHE_PROVIDER` is unset.

## Design (shared context for executors)

### Contract (`packages/cache/src/provider.ts`, exported as `@open-mercato/cache/provider`; already covered by the `./*` export map)

```ts
export const CACHE_PROVIDER_API_VERSION = 1
export type CacheProviderPlacement = 'local' | 'shared'
export type CacheProviderSettingsSchema<TConfig> = {
  safeParse(input: unknown): { success: true; data: TConfig } | { success: false; error: { issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string; code?: string }> } }
}  // structural, so zod schemas fit without a zod dependency in @open-mercato/cache
export type CacheProviderHostContext = {
  namespace: string           // CACHE_PROVIDER_NAMESPACE, validated [a-zA-Z0-9._-]{1,64}
  defaultTtl?: number
  codec: CacheCodecOptions    // compression settings resolved like the stock service
  helpers: { encode, decode, matchPattern }   // shared codec + pattern helpers
  logger: { warn(msg, meta?), error(msg, meta?) } // sanitized
}
export type CacheProviderDefinition<TConfig> = {
  apiVersion: 1
  id: string                  // namespaced: /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9._-]*$/
  settings: CacheProviderSettingsSchema<TConfig>
  capability(config: TConfig): { placement: CacheProviderPlacement }
  create(config: TConfig, context: CacheProviderHostContext): CacheStrategy | Promise<CacheStrategy>  // returned strategy MUST implement healthcheck + close
  redact?(config: TConfig): Record<string, unknown>
}
export function defineCacheProvider<TConfig>(def: Omit<CacheProviderDefinition<TConfig>, 'apiVersion'>): CacheProviderDefinition<TConfig>
export type CacheProviderRegistration = { id: string; load: () => Promise<CacheProviderDefinition<any>>; settings: () => unknown }
export function defineCacheProviderRegistration(reg): CacheProviderRegistration  // no side effects
export class CacheProviderError extends Error { code: CacheProviderErrorCode; providerId?: string; fieldPaths?: string[] }
// codes: 'invalid_registration' | 'duplicate_id' | 'reserved_id' | 'not_registered' | 'load_failed' | 'id_mismatch'
//        | 'unsupported_api_version' | 'invalid_settings' | 'missing_namespace' | 'invalid_namespace'
//        | 'conflicting_selection' | 'unavailable' | 'timeout' | 'not_resolved'
// message is sanitized: never includes settings values, only ids, codes, field paths
```

- Reserved IDs: `memory`, `redis`, `sqlite`, `jsonfile` (and anything without a `/`).
- `resolveCacheProvider(registrations, { env, selectedId? })`: validate every registration's id syntax/duplicates/reserved first (cheap, no loading). If no selection (`CACHE_PROVIDER` unset/empty) → `null`. Else locate registration (`not_registered`), `await load()` (`load_failed`, cause sanitized), check `apiVersion === 1` and `definition.id === registration.id`, call `settings()` once, `safeParse` (`invalid_settings` with field paths only), require namespace, compute capability. Returns `ResolvedCacheProvider { id, definition, config, placement, namespace }`. Inactive providers are never loaded and their `settings()` never called.
- Process-global holder keyed by `Symbol.for('@open-mercato/cache/provider-selection')`: `setCacheProviderRegistrations(list)`, `prepareCacheProviderSelection(): Promise<ResolvedCacheProvider | null>` (memoized in-flight promise, resolves once per process), `getPreparedCacheProvider()` sync accessor (throws `not_resolved` if `CACHE_PROVIDER` set but not yet prepared).

### Service integration (`packages/cache/src/service.ts`)

- `CacheServiceOptions.provider?: ResolvedCacheProvider` (additive).
- Precedence: explicit `options.strategy` wins over ambient provider; `options.strategy` + `options.provider` together → `conflicting_selection`; `options.provider` → use it; else `CACHE_PROVIDER` set → `getPreparedCacheProvider()` (throws if not prepared — never memory); else legacy `CACHE_STRATEGY` behavior unchanged.
- Provider path: build a lazy strategy handle — `create()` called on first operation, shared in-flight promise; connect bounded by `CACHE_PROVIDER_CONNECT_TIMEOUT_MS` (default 10000) → `timeout`; failed init closes the partially created strategy and the next op retries; `close()` idempotent; no `withDependencyFallback`. Then apply `createTenantAwareWrapper` once.
- `describeCacheSelection(options?)` → `{ kind: 'stock', strategy, placement } | { kind: 'provider', id, placement }` (stock placement: redis → shared, others → local) for readiness/guard/OAuth.
- `purgeConfiguredCachePatternsAcrossTenantScopes(patterns, options)` uses provider when selected (memory short-circuit only for stock memory); closes in `finally`.

### Manifest

- App file `<app root>/mercato.cache.ts` (apps/mercato/mercato.cache.ts — app root, NOT src/) exports `cacheProviders: CacheProviderRegistration[]`.
- Generator `packages/cli/src/lib/generators/cache-providers.ts` writes `cache-providers.generated.ts` into the generated output dir: either `export { cacheProviders } from '<relative path to mercato.cache>'` or `export const cacheProviders = []`, plus checksum. It never evaluates the file. Hook into `yarn generate` alongside `generateWebResearchAdapters`.
- `apps/mercato/src/bootstrap-common.ts` calls `setCacheProviderRegistrations(cacheProviders)` from the generated file. CLI/worker/scheduler: a narrow `loadCacheProviderManifest(appDir)` that imports the generated file the same way the CLI already loads other generated registries.

### Runtime boundaries

- Core `bootstrap()` and `bootstrapProcessRoot()`: `await prepareCacheProviderSelection()` before cache construction; catch blocks that fall back to `createCacheService({ strategy: 'memory' })` MUST rethrow `CacheProviderError`. Legacy shared request-container optional bootstrap catch must rethrow it too.
- healthz: when selection kind is `provider`, call `cache.healthcheck()` (required); stock redis unchanged; probe name stays internal, response body unchanged.
- Single-instance guard: cache component is safe when selection placement is `shared`; offender's `envVar` becomes `CACHE_PROVIDER` for providers.
- OAuth warning: skip when placement is `shared`.

## Risks

- Bootstrap error propagation could take down request paths for misconfigured deployments — intended by spec (no silent memory), but stock paths must be byte-for-byte unchanged when `CACHE_PROVIDER` unset (characterization tests in 1.1 guard this).
- Next/Turbopack bundling of the app-root `mercato.cache.ts` — prove with `yarn build:app`.

## Implementation Plan

### Phase 1 — Provider contract

#### Step 1.1 — Characterize stock cache selection, bootstrap fallback, readiness and purge
- Tests pinning: unknown `CACHE_STRATEGY` → memory; explicit `strategy` precedence; core bootstrap memory fallback on stock init failure; healthz redis special case; post-generate purge no-op for memory.

#### Step 1.2 — Provider contract entry point with registration validation and settings resolution
- `packages/cache/src/provider.ts` + errors + process-global selection holder; unit tests for every error code, redaction, single settings evaluation, inactive providers untouched.

#### Step 1.3 — Cache service provider selection with lazy strategy handle and lifecycle
- Service integration per Design; tests for precedence, conflicting selection, lazy connect sharing, timeout, failed init close + retry, idempotent close, no memory substitution, tenant wrapper applied once, `describeCacheSelection`.

#### Step 1.4 — App cache-provider manifest generator and CLI manifest loader
- Generator + tests (empty manifest, re-export manifest, deterministic output); generated registry wired into `yarn generate`; CLI loader.

### Phase 2 — Runtime, conformance kit and documentation

#### Step 2.1 — Wire provider resolution into core bootstrap paths and app bootstrap
#### Step 2.2 — Effective selection drives readiness, multi-instance guard and OAuth warning
#### Step 2.3 — Post-generate structural purge through the generated manifest
#### Step 2.4 — Provider conformance kit and independently packed fixture provider
- `packages/cache/src/testing/conformance.ts` (`@open-mercato/cache/testing`): `defineCacheProviderConformance({ name, createStrategy(namespace), createSecondProcess? , batchSize })` registering jest `describe/it` (uses global jest functions); covers CRUD, TTL default/override, tag overlap/retag, glob + stats, scoped clear, cleanup, foreign namespace, interleaved tenants, cross-instance propagation, corrupt value, batch boundary, close.
- Fixture package `packages/cache/fixtures/cache-provider-fixture` (id `acme/fixture-fs`, shared placement, directory-backed store, zod-free schema) — test packs it with `npm pack`, installs the tarball into a temp app dir and resolves it via a registration; conformance suite runs against it, including two child processes.
#### Step 2.5 — Provider-author and operator docs, env examples and template sync
#### Step 2.6 — Archive Delta into capabilities spec
