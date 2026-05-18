/**
 * Unified `modules.ts` override surface — one place for downstream apps to
 * replace or disable any contract a module presents.
 *
 * Spec: `.ai/specs/2026-05-04-modules-ts-unified-overrides.md`
 *
 * Each `ModuleEntry` in `apps/<app>/src/modules.ts` may carry an
 * `overrides` field whose sub-keys address one domain at a time:
 *
 *   {
 *     id: 'example',
 *     from: '@app',
 *     overrides: {
 *       ai: { agents: {...}, tools: {...} },         // Phase 1 — wired
 *       routes: { api: {...}, pages: {...} },        // Phase 2/3 — stub
 *       events: { subscribers: {...} },              // Phase 4 — stub
 *       workers: {...},                              // Phase 5 — stub
 *       ...
 *     },
 *   }
 *
 * The umbrella shape is the union of every per-domain sub-shape. Per-
 * domain runtime hooks ("wired" domains) own their composers and apply
 * the override map against their registry. Until a phase ships, the
 * dispatcher emits a one-shot structured warning when it sees an
 * override targeting that unwired domain — the runtime never throws on
 * unwired domains so app boot stays unaffected during the rollout.
 *
 * Resolution order across all domains (highest precedence first):
 *
 *   1. Programmatic — direct calls into the per-domain `apply*Overrides()` API.
 *   2. `modules.ts` inline — `entry.overrides.<domain>` here.
 *   3. File-based — overrides exported from a contributing module's own files.
 *   4. Base — the module's own registrations.
 *
 * `null` always means "disable"; a definition replaces.
 */

// ---------------------------------------------------------------------------
// Domain sub-shapes
// ---------------------------------------------------------------------------

/**
 * AI domain — agents and tools. Re-exports the canonical maps from
 * `@open-mercato/ai-assistant` so consumers do not need to import that
 * package directly when they only want to declare overrides.
 *
 * Imported lazily as `unknown` here because `@open-mercato/shared` must
 * NOT take a runtime dependency on `@open-mercato/ai-assistant` (the
 * dependency direction is the other way around). Apps that author
 * `entry.overrides.ai` should import the strongly-typed
 * `AiAgentOverridesMap` / `AiToolOverridesMap` from `@open-mercato/ai-assistant`
 * directly — TypeScript structurally compatible types make the loose
 * shape here a no-op annotation cost.
 */
export interface AiOverridesShape {
  agents?: Record<string, unknown>
  tools?: Record<string, unknown>
  extensions?: unknown[]
}

/**
 * Phase 2 (api — wired) / Phase 3 (pages — stubbed).
 *
 * The `api` sub-shape is keyed by `'METHOD /api/path'` and accepts either
 * a replacement definition (`{ handler, metadata? }`) or `null` to disable.
 * See {@link ApiRouteOverridesMap} for the strongly-typed alias and
 * {@link applyApiOverridesToManifests} for the runtime apply step.
 *
 * The `pages` sub-shape is still stubbed — the routes applier emits a
 * one-shot warning when it sees `entry.overrides.routes.pages` so an
 * early adopter notices instead of silently no-opping.
 */
export interface RoutesOverridesShape {
  api?: ApiRouteOverridesMap
  pages?: Record<string, unknown>
}

/** Phase 4 — event subscribers. Stubbed until wired. */
export interface EventsOverridesShape {
  subscribers?: Record<string, unknown>
}

/** Phase 6/7/8 — widget injection, component handles, dashboard widgets. */
export interface WidgetsOverridesShape {
  injection?: Record<string, unknown>
  components?: Record<string, unknown>
  dashboard?: Record<string, unknown>
}

/** Phase 9 — notification types + handlers. */
export interface NotificationsOverridesShape {
  types?: Record<string, unknown>
  handlers?: Record<string, unknown>
}

/** Phase 15 — setup lifecycle hooks. */
export interface SetupOverridesShape {
  defaultRoleFeatures?: Record<string, readonly string[]>
  seedDefaults?: false
  seedExamples?: false
  onTenantCreated?: false
}

/** Phase 16 — ACL features (per-feature override). */
export interface AclOverridesShape {
  features?: Record<string, unknown>
}

/** Phase 18 — encryption maps per entity id. */
export interface EncryptionOverridesShape {
  maps?: Record<string, unknown>
}

/**
 * Umbrella shape for `entry.overrides`. Every key is optional; a
 * downstream app sets only the domains it cares about.
 */
export interface ModuleOverrides {
  ai?: AiOverridesShape
  routes?: RoutesOverridesShape
  events?: EventsOverridesShape
  workers?: Record<string, unknown>
  widgets?: WidgetsOverridesShape
  notifications?: NotificationsOverridesShape
  interceptors?: Record<string, unknown>
  commandInterceptors?: Record<string, unknown>
  enrichers?: Record<string, unknown>
  guards?: Record<string, unknown>
  cli?: Record<string, unknown>
  setup?: SetupOverridesShape
  acl?: AclOverridesShape
  di?: Record<string, unknown>
  encryption?: EncryptionOverridesShape
}

/**
 * Public shape consumed by the dispatcher. Mirrors the `ModuleEntry`
 * defined in each app's `modules.ts` — the dispatcher only needs `id`
 * and `overrides`.
 */
export interface ModuleEntryWithOverrides {
  id: string
  from?: string
  overrides?: ModuleOverrides
}

// ---------------------------------------------------------------------------
// Per-domain runtime hook registry
// ---------------------------------------------------------------------------

/**
 * Each wired domain registers an applier that receives the list of
 * `(moduleId, overrides)` pairs in module-load order and forwards them
 * to its own runtime hook. Unwired domains do not register an applier
 * and instead trigger the dispatcher's one-shot warning.
 */
export type ModuleOverrideDomain =
  | 'ai'
  | 'routes'
  | 'events'
  | 'workers'
  | 'widgets'
  | 'notifications'
  | 'interceptors'
  | 'commandInterceptors'
  | 'enrichers'
  | 'guards'
  | 'cli'
  | 'setup'
  | 'acl'
  | 'di'
  | 'encryption'

export interface ModuleOverrideEntry<TShape> {
  moduleId: string
  overrides: TShape
}

export type ModuleOverrideApplier<TShape> = (
  entries: ReadonlyArray<ModuleOverrideEntry<TShape>>,
) => void

const appliers = new Map<ModuleOverrideDomain, ModuleOverrideApplier<unknown>>()
const warnedUnwiredDomains = new Set<ModuleOverrideDomain>()

/**
 * Register a per-domain runtime hook. Called once at module-load time
 * by each wired domain (e.g. the AI subsystem registers `'ai'` from
 * `@open-mercato/ai-assistant`).
 */
export function registerModuleOverrideApplier<TShape>(
  domain: ModuleOverrideDomain,
  applier: ModuleOverrideApplier<TShape>,
): void {
  appliers.set(domain, applier as ModuleOverrideApplier<unknown>)
}

/** @__internal Test-only hook — clear all registered appliers + warnings. */
export function resetModuleOverrideAppliersForTests(): void {
  appliers.clear()
  warnedUnwiredDomains.clear()
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

const DOMAIN_KEYS: ModuleOverrideDomain[] = [
  'ai',
  'routes',
  'events',
  'workers',
  'widgets',
  'notifications',
  'interceptors',
  'commandInterceptors',
  'enrichers',
  'guards',
  'cli',
  'setup',
  'acl',
  'di',
  'encryption',
]

const TRACKING_ISSUE_HINT =
  'See `.ai/specs/2026-05-04-modules-ts-unified-overrides.md` and tracking issue https://github.com/open-mercato/open-mercato/issues/1787.'

/**
 * Walk every `ModuleEntry` and dispatch its `overrides.<domain>` shape
 * to the matching wired applier. Unwired domains emit a one-shot
 * structured warning.
 *
 * Call this exactly once from `apps/<app>/src/bootstrap.ts` BEFORE any
 * registry first-loads. Calling it more than once is safe but
 * accumulates per-domain entries each time.
 */
export function applyModuleOverridesFromEnabledModules(
  modules: ReadonlyArray<ModuleEntryWithOverrides>,
): void {
  if (!Array.isArray(modules) || modules.length === 0) return

  // Bucket entries by domain in module-load order.
  const buckets = new Map<ModuleOverrideDomain, Array<ModuleOverrideEntry<unknown>>>()

  for (const entry of modules) {
    if (!entry || typeof entry.id !== 'string' || !entry.id) continue
    const overrides = entry.overrides
    if (!overrides || typeof overrides !== 'object') continue

    for (const domain of DOMAIN_KEYS) {
      const value = (overrides as Record<string, unknown>)[domain]
      if (value === undefined || value === null) continue
      if (typeof value !== 'object') continue
      const list = buckets.get(domain) ?? []
      list.push({ moduleId: entry.id, overrides: value })
      buckets.set(domain, list)
    }
  }

  // Dispatch each domain to its wired applier; warn on unwired domains.
  for (const [domain, entries] of buckets) {
    const applier = appliers.get(domain)
    if (!applier) {
      if (!warnedUnwiredDomains.has(domain)) {
        warnedUnwiredDomains.add(domain)
        const moduleIds = Array.from(new Set(entries.map((e) => e.moduleId))).join(', ')
        console.warn(
          `[Module Overrides] Domain "${domain}" not yet wired — entry.overrides.${domain} for module(s) [${moduleIds}] was ignored. ${TRACKING_ISSUE_HINT}`,
        )
      }
      continue
    }
    applier(entries)
  }
}

// ---------------------------------------------------------------------------
// Phase 2 — Routes (API) applier
// ---------------------------------------------------------------------------
//
// Wires `entry.overrides.routes.api` so a downstream module can disable or
// replace any API route declared by another module. The override map is
// keyed by `'METHOD /api/path'` (case-insensitive method, leading slash on
// the path), and each value is either:
//
//   - `null` — disable the matching method on the route.
//   - `{ handler, metadata? }` — replace the matching method's handler
//      (and optionally merge override metadata into the route's metadata).
//
// Resolution order (lowest precedence first):
//
//   1. `modules.ts` inline — every `entry.overrides.routes.api` on a
//      `ModuleEntry` (last entry per key wins).
//   2. Programmatic — `applyApiRouteOverrides({...})` from anywhere at
//      boot or test scaffolds (last call per key wins).
//
// A file-based tier (per-module `apiRouteOverrides` exports) is **not**
// part of Phase 2 — modules that ship a route override do so via
// `modules.ts` or programmatically. The umbrella spec keeps the file-based
// tier "where applicable".
//
// The applied overrides are consumed by `registerApiRouteManifests` (see
// `./registry.ts`) which rewrites the manifest array once before storing
// it. Calls to `applyApiRouteOverrides` made AFTER manifests are already
// registered do not retro-actively update the stored manifest — for
// runtime override scenarios call the dispatcher / programmatic API
// before `bootstrap.ts` triggers manifest registration.
//
// Spec: `.ai/specs/2026-05-04-modules-ts-unified-overrides.md` (Phase 2).

// ApiRouteManifestEntry / ApiHandler / HttpMethod live in ./registry. The
// type-only import is erased at runtime, so there is no cycle even though
// ./registry imports the runtime helpers below.
import type { ApiHandler, ApiRouteManifestEntry, HttpMethod } from './registry'

/** Override for a single API route entry: replace handler/metadata, or `null` to disable. */
export interface ApiRouteOverrideDefinition {
  /** Replacement handler. Same signature as the original API route handler. */
  handler: ApiHandler
  /** Optional metadata override — replaces the per-method metadata on the route. */
  metadata?: unknown
}

/** Override value per `'METHOD /api/path'` key — definition or `null` to disable. */
export type ApiRouteOverride = ApiRouteOverrideDefinition | null

/** Map of `'METHOD /api/path'` → override. */
export type ApiRouteOverridesMap = Record<string, ApiRouteOverride>

const VALID_HTTP_METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

const programmaticApiRouteOverrides: ApiRouteOverridesMap = {}
const modulesConfigApiRouteOverrides: ApiRouteOverridesMap = {}

let warnedRoutesPagesNotYetWired = false

/**
 * Normalize an override key to the canonical `'METHOD /api/path'` form.
 * Returns `null` if the key is malformed (missing method, unknown method,
 * empty path). Trailing slashes on the path are stripped.
 */
function normalizeApiRouteOverrideKey(key: string): string | null {
  if (typeof key !== 'string') return null
  const trimmed = key.trim()
  if (!trimmed) return null
  const parts = trimmed.split(/\s+/)
  if (parts.length < 2) return null
  const method = parts[0].toUpperCase() as HttpMethod
  if (!VALID_HTTP_METHODS.includes(method)) return null
  const rawPath = parts.slice(1).join(' ').trim()
  if (!rawPath) return null
  const withLead = rawPath.startsWith('/') ? rawPath : `/${rawPath}`
  const normalized = withLead.replace(/\/+$/, '') || '/'
  return `${method} ${normalized}`
}

/**
 * Programmatic API: apply API-route overrides. Supersedes any matching
 * `modules.ts` inline overrides for the same key. Call before
 * `registerApiRouteManifests` (i.e. before generated `apiRoutes` lands in
 * the registry); calls after registration do not retro-actively update
 * the stored manifest.
 *
 * @example
 * applyApiRouteOverrides({
 *   'GET /api/example/items': null,                            // disable
 *   'POST /api/example/items': { handler: customHandler },     // replace
 * })
 */
export function applyApiRouteOverrides(overrides: ApiRouteOverridesMap): void {
  if (!overrides) return
  for (const [rawKey, value] of Object.entries(overrides)) {
    const key = normalizeApiRouteOverrideKey(rawKey)
    if (!key) {
      console.warn(
        `[Module Overrides] Skipping malformed routes.api key "${rawKey}" — expected "METHOD /api/path".`,
      )
      continue
    }
    programmaticApiRouteOverrides[key] = value
  }
}

/** @__internal Test-only hook — clear programmatic + modules.ts route override state. */
export function resetApiRouteOverridesForTests(): void {
  for (const key of Object.keys(programmaticApiRouteOverrides)) {
    delete programmaticApiRouteOverrides[key]
  }
  for (const key of Object.keys(modulesConfigApiRouteOverrides)) {
    delete modulesConfigApiRouteOverrides[key]
  }
  warnedRoutesPagesNotYetWired = false
}

/**
 * Resolve the final API-route override map. Resolution order (lowest →
 * highest precedence):
 *
 *   1. `modules.ts` inline (applied via the dispatcher).
 *   2. Programmatic (`applyApiRouteOverrides`).
 */
export function composeApiRouteOverrides(): ApiRouteOverridesMap {
  const out: ApiRouteOverridesMap = {}
  for (const [k, v] of Object.entries(modulesConfigApiRouteOverrides)) out[k] = v
  for (const [k, v] of Object.entries(programmaticApiRouteOverrides)) out[k] = v
  return out
}

/**
 * Apply an API-route override map to a list of registered manifest entries.
 * Returns a NEW array — never mutates input.
 *
 * Behavior:
 *  - For each entry, walk every method in `entry.methods`.
 *  - If the override key `'METHOD path'` is `null`, drop that method from
 *    the entry's `methods` array.
 *  - If the override key is a definition, wrap `entry.load()` to return a
 *    module that exposes the override handler at `module[METHOD]` (top-level)
 *    and the override metadata at `module.metadata[METHOD]`.
 *  - If every method on the entry is disabled, the entry is dropped.
 *  - Overrides naming a key that does not match any entry log a single
 *    warning so an operator notices a stale override.
 */
export function applyApiOverridesToManifests<T extends ApiRouteManifestEntry>(
  routes: readonly T[],
  overrides: Readonly<ApiRouteOverridesMap>,
): T[] {
  if (!routes || routes.length === 0) return Array.from(routes)
  const overrideKeys = Object.keys(overrides)
  if (overrideKeys.length === 0) return Array.from(routes)

  const consumedKeys = new Set<string>()
  const result: T[] = []

  for (const entry of routes) {
    const path = entry.path
    const remainingMethods: HttpMethod[] = []
    const methodOverrides = new Map<HttpMethod, ApiRouteOverrideDefinition>()

    for (const method of entry.methods) {
      const key = `${method} ${path}`
      if (!Object.prototype.hasOwnProperty.call(overrides, key)) {
        remainingMethods.push(method)
        continue
      }
      consumedKeys.add(key)
      const value = overrides[key]
      if (value === null) continue
      if (value && typeof value === 'object' && typeof value.handler === 'function') {
        methodOverrides.set(method, value)
        remainingMethods.push(method)
      } else {
        console.warn(
          `[Module Overrides] Skipping malformed routes.api override for "${key}" — expected { handler, metadata? } or null.`,
        )
        remainingMethods.push(method)
      }
    }

    if (remainingMethods.length === 0) continue

    const methodsChanged = remainingMethods.length !== entry.methods.length
    const hasReplacements = methodOverrides.size > 0

    if (!methodsChanged && !hasReplacements) {
      result.push(entry)
      continue
    }

    const originalLoad = entry.load
    const wrappedLoad: T['load'] = hasReplacements
      ? async () => {
          const original = await originalLoad()
          const out: Record<string, unknown> = { ...original }
          const baseMetadata = original && typeof original === 'object' && original.metadata !== undefined
            ? original.metadata
            : null
          const mergedMetadata: Record<string, unknown> = baseMetadata && typeof baseMetadata === 'object'
            ? { ...(baseMetadata as Record<string, unknown>) }
            : {}
          for (const [method, def] of methodOverrides) {
            out[method] = def.handler
            if (def.metadata !== undefined) mergedMetadata[method] = def.metadata
          }
          if (Object.keys(mergedMetadata).length > 0) out.metadata = mergedMetadata
          return out
        }
      : originalLoad

    result.push({ ...entry, methods: remainingMethods, load: wrappedLoad })
  }

  for (const key of overrideKeys) {
    if (!consumedKeys.has(key)) {
      console.warn(
        `[Module Overrides] routes.api override "${key}" did not match any registered API route — override skipped.`,
      )
    }
  }

  return result
}

/**
 * Dispatcher applier for the `'routes'` domain. Buckets every entry's
 * `overrides.routes.api` into the `modules.ts` tier and emits a one-shot
 * warning when `overrides.routes.pages` is present (Phase 3 — not yet
 * wired).
 */
function routesOverridesApplier(
  entries: ReadonlyArray<ModuleOverrideEntry<RoutesOverridesShape>>,
): void {
  const modulesWithPages: string[] = []
  for (const entry of entries) {
    const shape = entry.overrides
    if (!shape || typeof shape !== 'object') continue
    const api = shape.api
    if (api && typeof api === 'object') {
      for (const [rawKey, value] of Object.entries(api)) {
        const key = normalizeApiRouteOverrideKey(rawKey)
        if (!key) {
          console.warn(
            `[Module Overrides] Skipping malformed routes.api key "${rawKey}" — expected "METHOD /api/path".`,
          )
          continue
        }
        modulesConfigApiRouteOverrides[key] = value as ApiRouteOverride
      }
    }
    const pages = shape.pages
    if (pages && typeof pages === 'object' && Object.keys(pages).length > 0) {
      modulesWithPages.push(entry.moduleId)
    }
  }
  if (modulesWithPages.length > 0 && !warnedRoutesPagesNotYetWired) {
    warnedRoutesPagesNotYetWired = true
    const ids = Array.from(new Set(modulesWithPages)).join(', ')
    console.warn(
      `[Module Overrides] Sub-domain "routes.pages" not yet wired — entry.overrides.routes.pages for module(s) [${ids}] was ignored. ${TRACKING_ISSUE_HINT}`,
    )
  }
}

registerModuleOverrideApplier<RoutesOverridesShape>('routes', routesOverridesApplier)
