/**
 * Unified `modules.ts` override surface — one place for downstream apps to
 * replace or disable any contract a module presents.
 *
 * Spec: `.ai/specs/implemented/2026-05-04-modules-ts-unified-overrides.md`
 *
 * Each `ModuleEntry` in `apps/<app>/src/modules.ts` may carry an
 * `overrides` field whose sub-keys address one domain at a time:
 *
 *   {
 *     id: 'example',
 *     from: '@app',
 *     overrides: {
 *       ai: { agents: {...}, tools: {...} },         // Phase 1 — wired
 *       routes: { api: {...}, pages: {...} },        // Phase 2/3 — wired
 *       events: { subscribers: {...} },              // Phase 4 — wired
 *       workers: {...},                              // Phase 5 — wired
 *       ...
 *     },
 *   }
 *
 * The umbrella shape is the union of every per-domain sub-shape. Per-
 * domain runtime hooks own their composers and apply the override map
 * against their registry. During the rollout the dispatcher emitted a
 * one-shot warning for unwired domains; all domains in this umbrella are
 * now wired, so warnings only indicate a missing custom applier in tests
 * or future domain additions.
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


type LooseOverrideMap = Record<string, unknown>

/**
 * Phase 2 (api) / Phase 3 (pages).
 *
 * The `api` sub-shape is keyed by `'METHOD /api/path'` and accepts either
 * a replacement definition (`{ handler, metadata? }`) or `null` to disable.
 * See {@link ApiRouteOverridesMap} for the strongly-typed alias and
 * {@link applyApiOverridesToManifests} for the runtime apply step.
 *
 * The `pages` sub-shape is keyed by `'/backend/path'` or
 * `'/frontend/path'`; `null` disables the page and a definition replaces
 * its loader and/or metadata.
 */
export interface RoutesOverridesShape {
  api?: ApiRouteOverridesMap | LooseOverrideMap
  pages?: PageRouteOverridesMap | LooseOverrideMap
}

/** Phase 4 — event subscribers. */
export interface EventsOverridesShape {
  subscribers?: SubscriberOverridesMap | LooseOverrideMap
}

/** Phase 6/7/8 — widget injection, component handles, dashboard widgets. */
export interface WidgetsOverridesShape {
  injection?: InjectionWidgetOverridesMap | LooseOverrideMap
  components?: ComponentOverridesMap | LooseOverrideMap
  dashboard?: DashboardWidgetOverridesMap | LooseOverrideMap
}

/** Phase 9 — notification types + handlers. */
export interface NotificationsOverridesShape {
  types?: NotificationTypeOverridesMap | LooseOverrideMap
  handlers?: NotificationHandlerOverridesMap | LooseOverrideMap
}

/** Phase 15 — setup lifecycle hooks. */
export interface SetupOverridesShape {
  defaultRoleFeatures?: Record<string, readonly string[]>
  defaultCustomerRoleFeatures?: Record<string, readonly string[]>
  seedDefaults?: false
  seedExamples?: false
  onTenantCreated?: false
}

/** Phase 16 — ACL features (per-feature override). */
export interface AclOverridesShape {
  features?: AclFeatureOverridesMap | LooseOverrideMap
}

/** Phase 18 — encryption maps per entity id. */
export interface EncryptionOverridesShape {
  maps?: EncryptionMapOverridesMap | LooseOverrideMap
}

/**
 * Umbrella shape for `entry.overrides`. Every key is optional; a
 * downstream app sets only the domains it cares about.
 */
export interface ModuleOverrides {
  ai?: AiOverridesShape
  routes?: RoutesOverridesShape
  events?: EventsOverridesShape
  workers?: WorkerOverridesMap | LooseOverrideMap
  widgets?: WidgetsOverridesShape
  notifications?: NotificationsOverridesShape
  interceptors?: ApiInterceptorOverridesMap | LooseOverrideMap
  commandInterceptors?: CommandInterceptorOverridesMap | LooseOverrideMap
  enrichers?: ResponseEnricherOverridesMap | LooseOverrideMap
  guards?: PageGuardOverridesMap | LooseOverrideMap
  cli?: CliOverridesMap | LooseOverrideMap
  setup?: SetupOverridesShape
  acl?: AclOverridesShape
  di?: DiOverridesMap | LooseOverrideMap
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
  registerBuiltInModuleOverrideAppliers()
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
  'See `.ai/specs/implemented/2026-05-04-modules-ts-unified-overrides.md` and tracking issue https://github.com/open-mercato/open-mercato/issues/1787.'

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
        logger.warn('Override domain not yet wired — entry ignored', { domain, moduleIds, hint: TRACKING_ISSUE_HINT })
      }
      continue
    }
    applier(entries)
  }
}

// ---------------------------------------------------------------------------
// Phase 2/3 — Routes (API + pages) applier
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
// Spec: `.ai/specs/implemented/2026-05-04-modules-ts-unified-overrides.md` (Phases 2/3).

// ApiRouteManifestEntry / ApiHandler / HttpMethod live in ./registry. The
// type-only import is erased at runtime, so there is no cycle even though
// ./registry imports the runtime helpers below.
import type {
  ApiHandler,
  ApiRouteManifestEntry,
  BackendRouteManifestEntry,
  FrontendRouteManifestEntry,
  HttpMethod,
  Module,
  ModuleCli,
  ModuleDashboardWidgetEntry,
  ModuleInjectionWidgetEntry,
  ModuleSubscriber,
  ModuleWorker,
} from './registry'
import { createLogger } from '../lib/logger'
import type { ModuleInjectionTable } from './widgets/injection'
import type { ComponentOverride } from './widgets/component-registry'
import type { NotificationHandler } from './notifications/handler'
import type { NotificationTypeDefinition } from './notifications/types'
import type { ModuleEncryptionMap } from './encryption'
import type { ModuleSetupConfig } from './setup'
import type { ApiInterceptor } from '../lib/crud/api-interceptor'
import type { ResponseEnricher } from '../lib/crud/response-enricher'
import type { CommandInterceptor } from '../lib/commands/command-interceptor'
import type { PageMiddlewareRegistryEntry, PageRouteMiddleware } from './middleware/page'

const logger = createLogger('shared').child({ component: 'module-overrides' })

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

type OverrideStore<T> = {
  modules: Record<string, T | null>
  programmatic: Record<string, T | null>
}

type OverrideValue<T> = T | null
type OverrideMap<T> = Record<string, OverrideValue<T>>

/** Override for a backend/frontend page route: replace loader/metadata, or `null` to disable. */
export interface PageRouteOverrideDefinition {
  load?: BackendRouteManifestEntry['load']
  Component?: Awaited<ReturnType<BackendRouteManifestEntry['load']>>
  metadata?: Partial<Omit<BackendRouteManifestEntry | FrontendRouteManifestEntry, 'moduleId' | 'load'>>
}

export type PageRouteOverride = PageRouteOverrideDefinition | null
export type PageRouteOverridesMap = Record<string, PageRouteOverride>

export type SubscriberOverride = ModuleSubscriber | null
export type SubscriberOverridesMap = Record<string, SubscriberOverride>

export type WorkerOverride = ModuleWorker | null
export type WorkerOverridesMap = Record<string, WorkerOverride>

export type CliOverride = ModuleCli | null
export type CliOverridesMap = Record<string, CliOverride>

export type InjectionWidgetOverride = ModuleInjectionWidgetEntry | null
export type InjectionWidgetOverridesMap = Record<string, InjectionWidgetOverride>

export type DashboardWidgetOverride = ModuleDashboardWidgetEntry | null
export type DashboardWidgetOverridesMap = Record<string, DashboardWidgetOverride>

export type ComponentOverrideValue = ComponentOverride | ComponentOverride[] | null
export type ComponentOverridesMap = Record<string, ComponentOverrideValue>

export type NotificationTypeOverride = NotificationTypeDefinition | null
export type NotificationTypeOverridesMap = Record<string, NotificationTypeOverride>

export type NotificationHandlerOverride = NotificationHandler | null
export type NotificationHandlerOverridesMap = Record<string, NotificationHandlerOverride>

export type ApiInterceptorOverride = ApiInterceptor | null
export type ApiInterceptorOverridesMap = Record<string, ApiInterceptorOverride>

export type CommandInterceptorOverride = CommandInterceptor | null
export type CommandInterceptorOverridesMap = Record<string, CommandInterceptorOverride>

export type ResponseEnricherOverride = ResponseEnricher | null
export type ResponseEnricherOverridesMap = Record<string, ResponseEnricherOverride>

export type PageGuardOverride = PageRouteMiddleware | null
export type PageGuardOverridesMap = Record<string, PageGuardOverride>

export type AclFeatureOverride = string | { id: string; [key: string]: unknown } | null
export type AclFeatureOverridesMap = Record<string, AclFeatureOverride>

export type EncryptionMapOverride = ModuleEncryptionMap | null
export type EncryptionMapOverridesMap = Record<string, EncryptionMapOverride>

export type DiBindingOverrideDefinition = {
  register: (container: { register: (registrations: Record<string, unknown>) => unknown }, key: string) => void
}
export type DiBindingOverride = DiBindingOverrideDefinition | unknown | null
export type DiOverridesMap = Record<string, DiBindingOverride>

const pageRouteOverrideStore: OverrideStore<PageRouteOverrideDefinition> = { modules: {}, programmatic: {} }
const subscriberOverrideStore: OverrideStore<ModuleSubscriber> = { modules: {}, programmatic: {} }
const workerOverrideStore: OverrideStore<ModuleWorker> = { modules: {}, programmatic: {} }
const cliOverrideStore: OverrideStore<ModuleCli> = { modules: {}, programmatic: {} }
const injectionWidgetOverrideStore: OverrideStore<ModuleInjectionWidgetEntry> = { modules: {}, programmatic: {} }
const dashboardWidgetOverrideStore: OverrideStore<ModuleDashboardWidgetEntry> = { modules: {}, programmatic: {} }
const componentOverrideStore: OverrideStore<ComponentOverride | ComponentOverride[]> = { modules: {}, programmatic: {} }
const notificationTypeOverrideStore: OverrideStore<NotificationTypeDefinition> = { modules: {}, programmatic: {} }
const notificationHandlerOverrideStore: OverrideStore<NotificationHandler> = { modules: {}, programmatic: {} }
const apiInterceptorOverrideStore: OverrideStore<ApiInterceptor> = { modules: {}, programmatic: {} }
const commandInterceptorOverrideStore: OverrideStore<CommandInterceptor> = { modules: {}, programmatic: {} }
const responseEnricherOverrideStore: OverrideStore<ResponseEnricher> = { modules: {}, programmatic: {} }
const pageGuardOverrideStore: OverrideStore<PageRouteMiddleware> = { modules: {}, programmatic: {} }
const aclFeatureOverrideStore: OverrideStore<Exclude<AclFeatureOverride, null>> = { modules: {}, programmatic: {} }
const encryptionMapOverrideStore: OverrideStore<ModuleEncryptionMap> = { modules: {}, programmatic: {} }
const diOverrideStore: OverrideStore<Exclude<DiBindingOverride, null>> = { modules: {}, programmatic: {} }
const setupOverridesByModule: Record<string, SetupOverridesShape> = {}

function normalizeIdOverrideKey(key: string, label: string): string | null {
  if (typeof key !== 'string') return null
  const trimmed = key.trim()
  if (trimmed) return trimmed
  logger.warn('Skipping malformed override key — expected a non-empty string', { label, key })
  return null
}

function clearStore<T>(store: OverrideStore<T>): void {
  for (const key of Object.keys(store.modules)) delete store.modules[key]
  for (const key of Object.keys(store.programmatic)) delete store.programmatic[key]
}

// Shared frozen empty override map. Returned from compose* helpers when both
// the modules-tier and programmatic-tier stores are empty so per-request hot
// paths (page guards, etc.) reuse one object instead of allocating fresh `{}`
// per call. Consumers MUST NOT mutate — internal applier loops iterate keys
// only, and the public API hands out shallow copies through composeApiRouteOverrides.
const EMPTY_OVERRIDE_MAP: Readonly<Record<string, never>> = Object.freeze({})

function applyStoreOverrides<T>(
  store: OverrideStore<T>,
  target: 'modules' | 'programmatic',
  overrides: OverrideMap<T> | undefined,
  options: {
    label: string
    normalizeKey?: (key: string) => string | null
  },
): void {
  if (!overrides || typeof overrides !== 'object') return
  const normalize = options.normalizeKey ?? ((key: string) => normalizeIdOverrideKey(key, options.label))
  for (const [rawKey, value] of Object.entries(overrides)) {
    const key = normalize(rawKey)
    if (!key) continue
    store[target][key] = value
  }
}

function composeStore<T>(store: OverrideStore<T>): OverrideMap<T> {
  const modulesKeys = Object.keys(store.modules)
  const programmaticKeys = Object.keys(store.programmatic)
  if (modulesKeys.length === 0 && programmaticKeys.length === 0) {
    return EMPTY_OVERRIDE_MAP as OverrideMap<T>
  }
  return { ...store.modules, ...store.programmatic }
}

function applyArrayOverrides<T>(
  items: readonly T[] | undefined,
  overrides: Readonly<OverrideMap<T>>,
  options: {
    label: string
    getId: (value: T) => string | null
    isReplacement?: (value: unknown) => value is T
  },
): { items: T[] | undefined; consumed: Set<string>; changed: boolean } {
  if (!items || Object.keys(overrides).length === 0) {
    return { items: items ? Array.from(items) : items, consumed: new Set(), changed: false }
  }

  const consumed = new Set<string>()
  const result: T[] = []
  let changed = false

  for (const item of items) {
    const id = options.getId(item)
    if (!id || !Object.prototype.hasOwnProperty.call(overrides, id)) {
      result.push(item)
      continue
    }
    consumed.add(id)
    changed = true
    const replacement = overrides[id]
    if (replacement === null) continue
    if (options.isReplacement && !options.isReplacement(replacement)) {
      logger.warn('Skipping malformed override — replacement has the wrong shape', { label: options.label, id })
      result.push(item)
      continue
    }
    const replacementId = options.getId(replacement)
    if (replacementId !== id) {
      logger.warn('Skipping malformed override — replacement id must match the override key', { label: options.label, id })
      result.push(item)
      continue
    }
    result.push(replacement)
  }

  return { items: result, consumed, changed }
}

function warnStaleOverrides(label: string, overrides: Readonly<Record<string, unknown>>, consumed: ReadonlySet<string>): void {
  for (const key of Object.keys(overrides)) {
    if (!consumed.has(key)) {
      logger.warn('Override did not match any registered entry — override skipped', { label, key })
    }
  }
}

function isObjectWithId(value: unknown): value is { id: string } {
  return !!value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string'
}

function isModuleSubscriber(value: unknown): value is ModuleSubscriber {
  return isObjectWithId(value)
    && typeof (value as ModuleSubscriber).event === 'string'
    && typeof (value as ModuleSubscriber).handler === 'function'
}

function isModuleWorker(value: unknown): value is ModuleWorker {
  return isObjectWithId(value)
    && typeof (value as ModuleWorker).queue === 'string'
    && typeof (value as ModuleWorker).handler === 'function'
}

function isModuleCli(value: unknown): value is ModuleCli {
  return !!value
    && typeof value === 'object'
    && typeof (value as ModuleCli).command === 'string'
    && typeof (value as ModuleCli).run === 'function'
}

function isInjectionWidgetEntry(value: unknown): value is ModuleInjectionWidgetEntry {
  return !!value
    && typeof value === 'object'
    && typeof (value as ModuleInjectionWidgetEntry).key === 'string'
    && typeof (value as ModuleInjectionWidgetEntry).loader === 'function'
}

function isDashboardWidgetEntry(value: unknown): value is ModuleDashboardWidgetEntry {
  return !!value
    && typeof value === 'object'
    && typeof (value as ModuleDashboardWidgetEntry).key === 'string'
    && typeof (value as ModuleDashboardWidgetEntry).loader === 'function'
}

function isComponentOverrideValue(value: unknown): value is ComponentOverride | ComponentOverride[] {
  const items = Array.isArray(value) ? value : [value]
  return items.every((item) =>
    !!item
    && typeof item === 'object'
    && !!(item as ComponentOverride).target
    && typeof (item as ComponentOverride).target.componentId === 'string',
  )
}

function isNotificationType(value: unknown): value is NotificationTypeDefinition {
  return !!value && typeof value === 'object' && typeof (value as NotificationTypeDefinition).type === 'string'
}

function isNotificationHandler(value: unknown): value is NotificationHandler {
  return isObjectWithId(value) && typeof (value as NotificationHandler).handle === 'function'
}

function isApiInterceptor(value: unknown): value is ApiInterceptor {
  return isObjectWithId(value) && typeof (value as ApiInterceptor).targetRoute === 'string'
}

function isCommandInterceptor(value: unknown): value is CommandInterceptor {
  return isObjectWithId(value) && typeof (value as CommandInterceptor).targetCommand === 'string'
}

function isResponseEnricher(value: unknown): value is ResponseEnricher {
  return isObjectWithId(value)
    && typeof (value as ResponseEnricher).targetEntity === 'string'
    && typeof (value as ResponseEnricher).enrichOne === 'function'
}

function isPageRouteMiddleware(value: unknown): value is PageRouteMiddleware {
  return isObjectWithId(value) && typeof (value as PageRouteMiddleware).run === 'function'
}

function isEncryptionMap(value: unknown): value is ModuleEncryptionMap {
  return !!value
    && typeof value === 'object'
    && typeof (value as ModuleEncryptionMap).entityId === 'string'
    && Array.isArray((value as ModuleEncryptionMap).fields)
}

function getFeatureId(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string') {
    return (value as { id: string }).id
  }
  return null
}

const VALID_HTTP_METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

const programmaticApiRouteOverrides: ApiRouteOverridesMap = {}
const modulesConfigApiRouteOverrides: ApiRouteOverridesMap = {}

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

function normalizePageRouteOverrideKey(key: string): string | null {
  if (typeof key !== 'string') return null
  const trimmed = key.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('backend:') || trimmed.startsWith('frontend:')) return trimmed
  const withLead = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  const stripped = withLead.replace(/\/+$/, '') || '/'
  if (stripped === '/frontend') return 'frontend:/'
  if (stripped.startsWith('/frontend/')) return `frontend:/${stripped.slice('/frontend/'.length)}`
  if (stripped === '/backend' || stripped.startsWith('/backend/')) return `backend:${stripped}`
  return `frontend:${stripped}`
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
      logger.warn('Skipping malformed routes.api key — expected "METHOD /api/path"', { key: rawKey })
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
}

/** @__internal Test-only hook — clear every per-domain override store. */
export function resetModuleContractOverridesForTests(): void {
  resetApiRouteOverridesForTests()
  clearStore(pageRouteOverrideStore)
  clearStore(subscriberOverrideStore)
  clearStore(workerOverrideStore)
  clearStore(cliOverrideStore)
  clearStore(injectionWidgetOverrideStore)
  clearStore(dashboardWidgetOverrideStore)
  clearStore(componentOverrideStore)
  clearStore(notificationTypeOverrideStore)
  clearStore(notificationHandlerOverrideStore)
  clearStore(apiInterceptorOverrideStore)
  clearStore(commandInterceptorOverrideStore)
  clearStore(responseEnricherOverrideStore)
  clearStore(pageGuardOverrideStore)
  clearStore(aclFeatureOverrideStore)
  clearStore(encryptionMapOverrideStore)
  clearStore(diOverrideStore)
  for (const key of Object.keys(setupOverridesByModule)) delete setupOverridesByModule[key]
}

/**
 * Resolve the final API-route override map. Resolution order (lowest →
 * highest precedence):
 *
 *   1. `modules.ts` inline (applied via the dispatcher).
 *   2. Programmatic (`applyApiRouteOverrides`).
 */
export function composeApiRouteOverrides(): ApiRouteOverridesMap {
  const modulesKeys = Object.keys(modulesConfigApiRouteOverrides)
  const programmaticKeys = Object.keys(programmaticApiRouteOverrides)
  if (modulesKeys.length === 0 && programmaticKeys.length === 0) {
    return EMPTY_OVERRIDE_MAP as ApiRouteOverridesMap
  }
  const out: ApiRouteOverridesMap = {}
  for (const k of modulesKeys) out[k] = modulesConfigApiRouteOverrides[k]
  for (const k of programmaticKeys) out[k] = programmaticApiRouteOverrides[k]
  return out
}

export function applyPageRouteOverrides(overrides: PageRouteOverridesMap): void {
  applyStoreOverrides(pageRouteOverrideStore, 'programmatic', overrides as OverrideMap<PageRouteOverrideDefinition>, {
    label: 'routes.pages',
    normalizeKey: normalizePageRouteOverrideKey,
  })
}

export function composePageRouteOverrides(): PageRouteOverridesMap {
  return composeStore(pageRouteOverrideStore) as PageRouteOverridesMap
}

export function applySubscriberOverrides(overrides: SubscriberOverridesMap): void {
  applyStoreOverrides(subscriberOverrideStore, 'programmatic', overrides as OverrideMap<ModuleSubscriber>, { label: 'events.subscribers' })
}

export function composeSubscriberOverrides(): SubscriberOverridesMap {
  return composeStore(subscriberOverrideStore) as SubscriberOverridesMap
}

export function applyWorkerOverrides(overrides: WorkerOverridesMap): void {
  applyStoreOverrides(workerOverrideStore, 'programmatic', overrides as OverrideMap<ModuleWorker>, { label: 'workers' })
}

export function composeWorkerOverrides(): WorkerOverridesMap {
  return composeStore(workerOverrideStore) as WorkerOverridesMap
}

export function applyCliOverrides(overrides: CliOverridesMap): void {
  applyStoreOverrides(cliOverrideStore, 'programmatic', overrides as OverrideMap<ModuleCli>, { label: 'cli' })
}

export function composeCliOverrides(): CliOverridesMap {
  return composeStore(cliOverrideStore) as CliOverridesMap
}

export function applyInjectionWidgetOverrides(overrides: InjectionWidgetOverridesMap): void {
  applyStoreOverrides(injectionWidgetOverrideStore, 'programmatic', overrides as OverrideMap<ModuleInjectionWidgetEntry>, { label: 'widgets.injection' })
}

export function composeInjectionWidgetOverrides(): InjectionWidgetOverridesMap {
  return composeStore(injectionWidgetOverrideStore) as InjectionWidgetOverridesMap
}

export function applyDashboardWidgetOverrides(overrides: DashboardWidgetOverridesMap): void {
  applyStoreOverrides(dashboardWidgetOverrideStore, 'programmatic', overrides as OverrideMap<ModuleDashboardWidgetEntry>, { label: 'widgets.dashboard' })
}

export function composeDashboardWidgetOverrides(): DashboardWidgetOverridesMap {
  return composeStore(dashboardWidgetOverrideStore) as DashboardWidgetOverridesMap
}

export function applyComponentOverrides(overrides: ComponentOverridesMap): void {
  applyStoreOverrides(componentOverrideStore, 'programmatic', overrides as OverrideMap<ComponentOverride | ComponentOverride[]>, { label: 'widgets.components' })
}

export function composeComponentOverrides(): ComponentOverridesMap {
  return composeStore(componentOverrideStore) as ComponentOverridesMap
}

export function applyNotificationTypeOverrides(overrides: NotificationTypeOverridesMap): void {
  applyStoreOverrides(notificationTypeOverrideStore, 'programmatic', overrides as OverrideMap<NotificationTypeDefinition>, { label: 'notifications.types' })
}

export function composeNotificationTypeOverrides(): NotificationTypeOverridesMap {
  return composeStore(notificationTypeOverrideStore) as NotificationTypeOverridesMap
}

export function applyNotificationHandlerOverrides(overrides: NotificationHandlerOverridesMap): void {
  applyStoreOverrides(notificationHandlerOverrideStore, 'programmatic', overrides as OverrideMap<NotificationHandler>, { label: 'notifications.handlers' })
}

export function composeNotificationHandlerOverrides(): NotificationHandlerOverridesMap {
  return composeStore(notificationHandlerOverrideStore) as NotificationHandlerOverridesMap
}

export function applyApiInterceptorOverrides(overrides: ApiInterceptorOverridesMap): void {
  applyStoreOverrides(apiInterceptorOverrideStore, 'programmatic', overrides as OverrideMap<ApiInterceptor>, { label: 'interceptors' })
}

export function composeApiInterceptorOverrides(): ApiInterceptorOverridesMap {
  return composeStore(apiInterceptorOverrideStore) as ApiInterceptorOverridesMap
}

export function applyCommandInterceptorOverrides(overrides: CommandInterceptorOverridesMap): void {
  applyStoreOverrides(commandInterceptorOverrideStore, 'programmatic', overrides as OverrideMap<CommandInterceptor>, { label: 'commandInterceptors' })
}

export function composeCommandInterceptorOverrides(): CommandInterceptorOverridesMap {
  return composeStore(commandInterceptorOverrideStore) as CommandInterceptorOverridesMap
}

export function applyResponseEnricherOverrides(overrides: ResponseEnricherOverridesMap): void {
  applyStoreOverrides(responseEnricherOverrideStore, 'programmatic', overrides as OverrideMap<ResponseEnricher>, { label: 'enrichers' })
}

export function composeResponseEnricherOverrides(): ResponseEnricherOverridesMap {
  return composeStore(responseEnricherOverrideStore) as ResponseEnricherOverridesMap
}

export function applyPageGuardOverrides(overrides: PageGuardOverridesMap): void {
  applyStoreOverrides(pageGuardOverrideStore, 'programmatic', overrides as OverrideMap<PageRouteMiddleware>, { label: 'guards' })
}

export function composePageGuardOverrides(): PageGuardOverridesMap {
  return composeStore(pageGuardOverrideStore) as PageGuardOverridesMap
}

export function applyAclFeatureOverrides(overrides: AclFeatureOverridesMap): void {
  applyStoreOverrides(aclFeatureOverrideStore, 'programmatic', overrides as OverrideMap<Exclude<AclFeatureOverride, null>>, { label: 'acl.features' })
}

export function composeAclFeatureOverrides(): AclFeatureOverridesMap {
  return composeStore(aclFeatureOverrideStore) as AclFeatureOverridesMap
}

export function applyEncryptionMapOverrides(overrides: EncryptionMapOverridesMap): void {
  applyStoreOverrides(encryptionMapOverrideStore, 'programmatic', overrides as OverrideMap<ModuleEncryptionMap>, { label: 'encryption.maps' })
}

export function composeEncryptionMapOverrides(): EncryptionMapOverridesMap {
  return composeStore(encryptionMapOverrideStore) as EncryptionMapOverridesMap
}

export function applyDiOverrides(overrides: DiOverridesMap): void {
  applyStoreOverrides(diOverrideStore, 'programmatic', overrides as OverrideMap<Exclude<DiBindingOverride, null>>, { label: 'di' })
}

export function composeDiOverrides(): DiOverridesMap {
  return composeStore(diOverrideStore) as DiOverridesMap
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
      const manifestKey = `${method} ${path}`
      const publicKey = path.startsWith('/api/')
        ? manifestKey
        : `${method} /api${path === '/' ? '' : path}`
      const key = Object.prototype.hasOwnProperty.call(overrides, manifestKey)
        ? manifestKey
        : Object.prototype.hasOwnProperty.call(overrides, publicKey)
          ? publicKey
          : null
      if (!key) {
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
        logger.warn('Skipping malformed routes.api override — expected { handler, metadata? } or null', { key })
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
      logger.warn('routes.api override did not match any registered API route — override skipped', { key })
    }
  }

  return result
}

export function applyPageOverridesToManifests<T extends BackendRouteManifestEntry | FrontendRouteManifestEntry>(
  routes: readonly T[],
  overrides: Readonly<PageRouteOverridesMap>,
  kind: 'backend' | 'frontend',
): T[] {
  if (!routes || routes.length === 0) return Array.from(routes)
  const normalizedOverrides: PageRouteOverridesMap = {}
  for (const [rawKey, value] of Object.entries(overrides)) {
    const key = normalizePageRouteOverrideKey(rawKey)
    if (!key) {
      logger.warn('Skipping malformed routes.pages key — expected "/backend/path" or "/frontend/path"', { key: rawKey })
      continue
    }
    normalizedOverrides[key] = value
  }
  const overrideKeys = Object.keys(normalizedOverrides).filter((key) => key.startsWith(`${kind}:`))
  if (overrideKeys.length === 0) return Array.from(routes)

  const consumed = new Set<string>()
  const result: T[] = []

  for (const entry of routes) {
    const path = entry.pattern ?? entry.path ?? '/'
    const key = `${kind}:${path.replace(/\/+$/, '') || '/'}`
    if (!Object.prototype.hasOwnProperty.call(normalizedOverrides, key)) {
      result.push(entry)
      continue
    }

    consumed.add(key)
    const override = normalizedOverrides[key]
    if (override === null) continue
    if (!override || typeof override !== 'object') {
      logger.warn('Skipping malformed routes.pages override — expected { load?, Component?, metadata? } or null', { key })
      result.push(entry)
      continue
    }

    const hasLoad = typeof override.load === 'function'
    const hasComponent = typeof override.Component === 'function'
    if (!hasLoad && !hasComponent && override.metadata === undefined) {
      logger.warn('Skipping malformed routes.pages override — expected a loader, component, metadata, or null', { key })
      result.push(entry)
      continue
    }

    const metadata = override.metadata && typeof override.metadata === 'object'
      ? override.metadata
      : {}
    const load = hasLoad
      ? override.load!
      : hasComponent
        ? async () => override.Component!
        : entry.load

    result.push({ ...entry, ...metadata, load })
  }

  warnStaleOverrides('routes.pages', Object.fromEntries(
    overrideKeys.map((key) => [key, normalizedOverrides[key]]),
  ), consumed)
  return result
}

function applyEntryListOverrides<TEntry extends { moduleId: string }, TValue>(
  entries: readonly TEntry[] | undefined,
  overrides: Readonly<OverrideMap<TValue>>,
  options: {
    listKey: keyof TEntry
    label: string
    getId: (value: TValue) => string | null
    isReplacement: (value: unknown) => value is TValue
  },
): TEntry[] | undefined {
  // Fast path: when no overrides are registered, return the input directly.
  // All known callers iterate the result (.forEach/.flatMap/.map/storage),
  // never mutate it. This avoids a per-request Array.from copy on hot paths
  // like executePageMiddleware → applyPageGuardOverridesToEntries.
  if (!entries || Object.keys(overrides).length === 0) return entries as TEntry[] | undefined
  const consumed = new Set<string>()
  let changed = false
  const result = entries.map((entry) => {
    const list = entry[options.listKey]
    if (!Array.isArray(list)) return entry
    const applied = applyArrayOverrides(list as TValue[], overrides, {
      label: options.label,
      getId: options.getId,
      isReplacement: options.isReplacement,
    })
    for (const key of applied.consumed) consumed.add(key)
    if (!applied.changed) return entry
    changed = true
    return { ...entry, [options.listKey]: applied.items ?? [] }
  })
  warnStaleOverrides(options.label, overrides, consumed)
  return changed ? result : Array.from(entries)
}

export function applyInjectionWidgetOverridesToEntries(
  entries: readonly ModuleInjectionWidgetEntry[],
  overrides: Readonly<InjectionWidgetOverridesMap> = composeInjectionWidgetOverrides(),
): ModuleInjectionWidgetEntry[] {
  const applied = applyArrayOverrides(entries, overrides as OverrideMap<ModuleInjectionWidgetEntry>, {
    label: 'widgets.injection',
    getId: (entry) => entry.key,
    isReplacement: isInjectionWidgetEntry,
  })
  warnStaleOverrides('widgets.injection', overrides, applied.consumed)
  return applied.items ?? []
}

export function applyDashboardWidgetOverridesToEntries(
  entries: readonly ModuleDashboardWidgetEntry[],
  overrides: Readonly<DashboardWidgetOverridesMap> = composeDashboardWidgetOverrides(),
): ModuleDashboardWidgetEntry[] {
  const applied = applyArrayOverrides(entries, overrides as OverrideMap<ModuleDashboardWidgetEntry>, {
    label: 'widgets.dashboard',
    getId: (entry) => entry.key,
    isReplacement: isDashboardWidgetEntry,
  })
  warnStaleOverrides('widgets.dashboard', overrides, applied.consumed)
  return applied.items ?? []
}

export function applyWorkerOverridesToDescriptors<T extends { id: string; queue: string; concurrency: number; handler: unknown }>(
  entries: readonly T[],
  overrides: Readonly<WorkerOverridesMap> = composeWorkerOverrides(),
): T[] {
  const applied = applyArrayOverrides(entries, overrides as OverrideMap<T>, {
    label: 'workers',
    getId: (entry) => entry.id,
    isReplacement: (value): value is T =>
      !!value
      && typeof value === 'object'
      && typeof (value as { id?: unknown }).id === 'string'
      && typeof (value as { queue?: unknown }).queue === 'string'
      && typeof (value as { concurrency?: unknown }).concurrency === 'number'
      && typeof (value as { handler?: unknown }).handler === 'function',
  })
  warnStaleOverrides('workers', overrides, applied.consumed)
  return applied.items ?? []
}

export function applyInjectionWidgetOverridesToTables(
  tables: readonly { moduleId: string; table: ModuleInjectionTable }[],
  overrides: Readonly<InjectionWidgetOverridesMap> = composeInjectionWidgetOverrides(),
): Array<{ moduleId: string; table: ModuleInjectionTable }> {
  const disabled = new Set(Object.entries(overrides).filter(([, value]) => value === null).map(([key]) => key))
  if (disabled.size === 0) return Array.from(tables)

  const filterSlot = (slot: unknown): unknown => {
    if (typeof slot === 'string') return disabled.has(slot) ? null : slot
    if (slot && typeof slot === 'object') {
      const widgetId = (slot as { widgetId?: unknown }).widgetId
      return typeof widgetId === 'string' && disabled.has(widgetId) ? null : slot
    }
    return slot
  }

  return tables.map((entry) => {
    const nextTable: ModuleInjectionTable = {}
    for (const [spotId, rawSlot] of Object.entries(entry.table)) {
      const filtered = Array.isArray(rawSlot)
        ? rawSlot.map(filterSlot).filter((slot): slot is NonNullable<typeof slot> => slot !== null)
        : filterSlot(rawSlot)
      if (Array.isArray(filtered)) {
        if (filtered.length > 0) nextTable[spotId] = filtered as ModuleInjectionTable[string]
      } else if (filtered !== null) {
        nextTable[spotId] = filtered as ModuleInjectionTable[string]
      }
    }
    return { ...entry, table: nextTable }
  })
}

export function applyComponentOverridesToEntries(
  entries: readonly { moduleId: string; componentOverrides: ComponentOverride[] }[],
  overrides: Readonly<ComponentOverridesMap> = composeComponentOverrides(),
): Array<{ moduleId: string; componentOverrides: ComponentOverride[] }> {
  const overrideKeys = Object.keys(overrides)
  if (overrideKeys.length === 0) return Array.from(entries)
  const consumed = new Set<string>()
  const additions: ComponentOverride[] = []
  const result = entries.map((entry) => {
    const next = entry.componentOverrides.filter((override) => {
      const id = override.target.componentId
      if (!Object.prototype.hasOwnProperty.call(overrides, id)) return true
      consumed.add(id)
      return false
    })
    return { ...entry, componentOverrides: next }
  })
  for (const key of overrideKeys) {
    const value = overrides[key]
    if (value === null) continue
    if (!isComponentOverrideValue(value)) {
      logger.warn('Skipping malformed widgets.components override — expected ComponentOverride, ComponentOverride[], or null', { key })
      continue
    }
    const values = Array.isArray(value) ? value : [value]
    for (const override of values) {
      if (override.target.componentId !== key) {
        logger.warn('Skipping malformed widgets.components override — target.componentId must match the override key', { key })
        continue
      }
      additions.push(override)
      consumed.add(key)
    }
  }
  if (additions.length > 0) {
    result.push({ moduleId: 'overrides', componentOverrides: additions })
  }
  warnStaleOverrides('widgets.components', overrides, consumed)
  return result
}

export function applyNotificationTypeOverridesToEntries(
  entries: readonly { moduleId: string; types: NotificationTypeDefinition[] }[],
  overrides: Readonly<NotificationTypeOverridesMap> = composeNotificationTypeOverrides(),
): Array<{ moduleId: string; types: NotificationTypeDefinition[] }> {
  return applyEntryListOverrides(entries, overrides as OverrideMap<NotificationTypeDefinition>, {
    listKey: 'types',
    label: 'notifications.types',
    getId: (entry) => entry.type,
    isReplacement: isNotificationType,
  }) ?? []
}

export function applyNotificationHandlerOverridesToEntries(
  entries: readonly { moduleId: string; handlers: NotificationHandler[] }[],
  overrides: Readonly<NotificationHandlerOverridesMap> = composeNotificationHandlerOverrides(),
): Array<{ moduleId: string; handlers: NotificationHandler[] }> {
  return applyEntryListOverrides(entries, overrides as OverrideMap<NotificationHandler>, {
    listKey: 'handlers',
    label: 'notifications.handlers',
    getId: (entry) => entry.id,
    isReplacement: isNotificationHandler,
  }) ?? []
}

export function applyApiInterceptorOverridesToEntries(
  entries: readonly { moduleId: string; interceptors: ApiInterceptor[] }[],
  overrides: Readonly<ApiInterceptorOverridesMap> = composeApiInterceptorOverrides(),
): Array<{ moduleId: string; interceptors: ApiInterceptor[] }> {
  return applyEntryListOverrides(entries, overrides as OverrideMap<ApiInterceptor>, {
    listKey: 'interceptors',
    label: 'interceptors',
    getId: (entry) => entry.id,
    isReplacement: isApiInterceptor,
  }) ?? []
}

export function applyCommandInterceptorOverridesToEntries(
  entries: readonly { moduleId: string; interceptors: CommandInterceptor[] }[],
  overrides: Readonly<CommandInterceptorOverridesMap> = composeCommandInterceptorOverrides(),
): Array<{ moduleId: string; interceptors: CommandInterceptor[] }> {
  return applyEntryListOverrides(entries, overrides as OverrideMap<CommandInterceptor>, {
    listKey: 'interceptors',
    label: 'commandInterceptors',
    getId: (entry) => entry.id,
    isReplacement: isCommandInterceptor,
  }) ?? []
}

export function applyResponseEnricherOverridesToEntries(
  entries: readonly { moduleId: string; enrichers: ResponseEnricher[] }[],
  overrides: Readonly<ResponseEnricherOverridesMap> = composeResponseEnricherOverrides(),
): Array<{ moduleId: string; enrichers: ResponseEnricher[] }> {
  return applyEntryListOverrides(entries, overrides as OverrideMap<ResponseEnricher>, {
    listKey: 'enrichers',
    label: 'enrichers',
    getId: (entry) => entry.id,
    isReplacement: isResponseEnricher,
  }) ?? []
}

export function applyPageGuardOverridesToEntries(
  entries: readonly PageMiddlewareRegistryEntry[],
  overrides: Readonly<PageGuardOverridesMap> = composePageGuardOverrides(),
): PageMiddlewareRegistryEntry[] {
  return applyEntryListOverrides(entries, overrides as OverrideMap<PageRouteMiddleware>, {
    listKey: 'middleware',
    label: 'guards',
    getId: (entry) => entry.id,
    isReplacement: isPageRouteMiddleware,
  }) ?? []
}

function applySetupOverride(setup: ModuleSetupConfig | undefined, override: SetupOverridesShape | undefined): ModuleSetupConfig | undefined {
  if (!override) return setup
  const next: ModuleSetupConfig = { ...(setup ?? {}) }
  if (override.defaultRoleFeatures) {
    next.defaultRoleFeatures = Object.fromEntries(
      Object.entries(override.defaultRoleFeatures).map(([role, features]) => [role, Array.from(features)]),
    )
  }
  if (override.defaultCustomerRoleFeatures) {
    next.defaultCustomerRoleFeatures = Object.fromEntries(
      Object.entries(override.defaultCustomerRoleFeatures).map(([role, features]) => [role, Array.from(features)]),
    )
  }
  if (override.seedDefaults === false) delete next.seedDefaults
  if (override.seedExamples === false) delete next.seedExamples
  if (override.onTenantCreated === false) delete next.onTenantCreated
  return next
}

export function applyModuleOverridesToModules(modules: readonly Module[]): Module[] {
  const subscriberOverrides = composeSubscriberOverrides()
  const workerOverrides = composeWorkerOverrides()
  const cliOverrides = composeCliOverrides()
  const aclOverrides = composeAclFeatureOverrides()
  const encryptionOverrides = composeEncryptionMapOverrides()
  const hasSetupOverrides = Object.keys(setupOverridesByModule).length > 0
  const hasAny =
    Object.keys(subscriberOverrides).length > 0
    || Object.keys(workerOverrides).length > 0
    || Object.keys(cliOverrides).length > 0
    || Object.keys(aclOverrides).length > 0
    || Object.keys(encryptionOverrides).length > 0
    || hasSetupOverrides

  if (!hasAny) return modules as Module[]

  const subscriberConsumed = new Set<string>()
  const workerConsumed = new Set<string>()
  const cliConsumed = new Set<string>()
  const aclConsumed = new Set<string>()
  const encryptionConsumed = new Set<string>()

  const result = modules.map((module) => {
    let next = module

    const subscribers = applyArrayOverrides(module.subscribers, subscriberOverrides as OverrideMap<ModuleSubscriber>, {
      label: 'events.subscribers',
      getId: (entry) => entry.id,
      isReplacement: isModuleSubscriber,
    })
    for (const key of subscribers.consumed) subscriberConsumed.add(key)
    if (subscribers.changed) next = { ...next, subscribers: subscribers.items }

    const workers = applyArrayOverrides(module.workers, workerOverrides as OverrideMap<ModuleWorker>, {
      label: 'workers',
      getId: (entry) => entry.id,
      isReplacement: isModuleWorker,
    })
    for (const key of workers.consumed) workerConsumed.add(key)
    if (workers.changed) next = { ...next, workers: workers.items }

    const cli = applyArrayOverrides(module.cli, cliOverrides as OverrideMap<ModuleCli>, {
      label: 'cli',
      getId: (entry) => entry.command,
      isReplacement: isModuleCli,
    })
    for (const key of cli.consumed) cliConsumed.add(key)
    if (cli.changed) next = { ...next, cli: cli.items }

    const features = applyArrayOverrides(module.features, aclOverrides as OverrideMap<NonNullable<Module['features']>[number]>, {
      label: 'acl.features',
      getId: getFeatureId,
      isReplacement: (value): value is NonNullable<Module['features']>[number] => getFeatureId(value) !== null,
    })
    for (const key of features.consumed) aclConsumed.add(key)
    if (features.changed) next = { ...next, features: features.items }

    const maps = applyArrayOverrides(module.defaultEncryptionMaps, encryptionOverrides as OverrideMap<ModuleEncryptionMap>, {
      label: 'encryption.maps',
      getId: (entry) => entry.entityId,
      isReplacement: isEncryptionMap,
    })
    for (const key of maps.consumed) encryptionConsumed.add(key)
    if (maps.changed) next = { ...next, defaultEncryptionMaps: maps.items }

    const setupOverride = setupOverridesByModule[module.id]
    if (setupOverride) {
      next = { ...next, setup: applySetupOverride(module.setup, setupOverride) }
    }

    return next
  })

  warnStaleOverrides('events.subscribers', subscriberOverrides, subscriberConsumed)
  warnStaleOverrides('workers', workerOverrides, workerConsumed)
  warnStaleOverrides('cli', cliOverrides, cliConsumed)
  warnStaleOverrides('acl.features', aclOverrides, aclConsumed)
  warnStaleOverrides('encryption.maps', encryptionOverrides, encryptionConsumed)

  return result
}

export function applyDiOverridesToContainer(container: {
  register: (registrations: Record<string, unknown>) => unknown
  unregister?: (name: string) => unknown
  registrations?: Record<string, unknown>
}): void {
  const overrides = composeDiOverrides()
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) {
      if (typeof container.unregister === 'function') {
        container.unregister(key)
      } else if (container.registrations && key in container.registrations) {
        delete container.registrations[key]
      }
      continue
    }
    if (value && typeof value === 'object' && typeof (value as DiBindingOverrideDefinition).register === 'function') {
      ;(value as DiBindingOverrideDefinition).register(container, key)
      continue
    }
    container.register({ [key]: value })
  }
}

/**
 * Dispatcher applier for the `'routes'` domain. Buckets every entry's
 * `overrides.routes.api` and `overrides.routes.pages` into the
 * `modules.ts` tier.
 */
function routesOverridesApplier(
  entries: ReadonlyArray<ModuleOverrideEntry<RoutesOverridesShape>>,
): void {
  for (const entry of entries) {
    const shape = entry.overrides
    if (!shape || typeof shape !== 'object') continue
    const api = shape.api
    if (api && typeof api === 'object') {
      for (const [rawKey, value] of Object.entries(api)) {
        const key = normalizeApiRouteOverrideKey(rawKey)
        if (!key) {
          logger.warn('Skipping malformed routes.api key — expected "METHOD /api/path"', { key: rawKey })
          continue
        }
        modulesConfigApiRouteOverrides[key] = value as ApiRouteOverride
      }
    }
    const pages = shape.pages
    if (pages && typeof pages === 'object' && Object.keys(pages).length > 0) {
      applyStoreOverrides(pageRouteOverrideStore, 'modules', pages as OverrideMap<PageRouteOverrideDefinition>, {
        label: 'routes.pages',
        normalizeKey: normalizePageRouteOverrideKey,
      })
    }
  }
}

function eventsOverridesApplier(entries: ReadonlyArray<ModuleOverrideEntry<EventsOverridesShape>>): void {
  for (const entry of entries) {
    const subscribers = entry.overrides?.subscribers
    applyStoreOverrides(subscriberOverrideStore, 'modules', subscribers as OverrideMap<ModuleSubscriber>, { label: 'events.subscribers' })
  }
}

function workersOverridesApplier(entries: ReadonlyArray<ModuleOverrideEntry<WorkerOverridesMap>>): void {
  for (const entry of entries) {
    applyStoreOverrides(workerOverrideStore, 'modules', entry.overrides as OverrideMap<ModuleWorker>, { label: 'workers' })
  }
}

function widgetsOverridesApplier(entries: ReadonlyArray<ModuleOverrideEntry<WidgetsOverridesShape>>): void {
  for (const entry of entries) {
    applyStoreOverrides(injectionWidgetOverrideStore, 'modules', entry.overrides?.injection as OverrideMap<ModuleInjectionWidgetEntry>, { label: 'widgets.injection' })
    applyStoreOverrides(componentOverrideStore, 'modules', entry.overrides?.components as OverrideMap<ComponentOverride | ComponentOverride[]>, { label: 'widgets.components' })
    applyStoreOverrides(dashboardWidgetOverrideStore, 'modules', entry.overrides?.dashboard as OverrideMap<ModuleDashboardWidgetEntry>, { label: 'widgets.dashboard' })
  }
}

function notificationsOverridesApplier(entries: ReadonlyArray<ModuleOverrideEntry<NotificationsOverridesShape>>): void {
  for (const entry of entries) {
    applyStoreOverrides(notificationTypeOverrideStore, 'modules', entry.overrides?.types as OverrideMap<NotificationTypeDefinition>, { label: 'notifications.types' })
    applyStoreOverrides(notificationHandlerOverrideStore, 'modules', entry.overrides?.handlers as OverrideMap<NotificationHandler>, { label: 'notifications.handlers' })
  }
}

function interceptorsOverridesApplier(entries: ReadonlyArray<ModuleOverrideEntry<ApiInterceptorOverridesMap>>): void {
  for (const entry of entries) {
    applyStoreOverrides(apiInterceptorOverrideStore, 'modules', entry.overrides as OverrideMap<ApiInterceptor>, { label: 'interceptors' })
  }
}

function commandInterceptorsOverridesApplier(entries: ReadonlyArray<ModuleOverrideEntry<CommandInterceptorOverridesMap>>): void {
  for (const entry of entries) {
    applyStoreOverrides(commandInterceptorOverrideStore, 'modules', entry.overrides as OverrideMap<CommandInterceptor>, { label: 'commandInterceptors' })
  }
}

function enrichersOverridesApplier(entries: ReadonlyArray<ModuleOverrideEntry<ResponseEnricherOverridesMap>>): void {
  for (const entry of entries) {
    applyStoreOverrides(responseEnricherOverrideStore, 'modules', entry.overrides as OverrideMap<ResponseEnricher>, { label: 'enrichers' })
  }
}

function guardsOverridesApplier(entries: ReadonlyArray<ModuleOverrideEntry<PageGuardOverridesMap>>): void {
  for (const entry of entries) {
    applyStoreOverrides(pageGuardOverrideStore, 'modules', entry.overrides as OverrideMap<PageRouteMiddleware>, { label: 'guards' })
  }
}

function cliOverridesApplier(entries: ReadonlyArray<ModuleOverrideEntry<CliOverridesMap>>): void {
  for (const entry of entries) {
    applyStoreOverrides(cliOverrideStore, 'modules', entry.overrides as OverrideMap<ModuleCli>, { label: 'cli' })
  }
}

function setupOverridesApplier(entries: ReadonlyArray<ModuleOverrideEntry<SetupOverridesShape>>): void {
  for (const entry of entries) {
    if (!entry.overrides || typeof entry.overrides !== 'object') continue
    setupOverridesByModule[entry.moduleId] = entry.overrides
  }
}

function aclOverridesApplier(entries: ReadonlyArray<ModuleOverrideEntry<AclOverridesShape>>): void {
  for (const entry of entries) {
    applyStoreOverrides(aclFeatureOverrideStore, 'modules', entry.overrides?.features as OverrideMap<Exclude<AclFeatureOverride, null>>, { label: 'acl.features' })
  }
}

function diOverridesApplier(entries: ReadonlyArray<ModuleOverrideEntry<DiOverridesMap>>): void {
  for (const entry of entries) {
    applyStoreOverrides(diOverrideStore, 'modules', entry.overrides as OverrideMap<Exclude<DiBindingOverride, null>>, { label: 'di' })
  }
}

function encryptionOverridesApplier(entries: ReadonlyArray<ModuleOverrideEntry<EncryptionOverridesShape>>): void {
  for (const entry of entries) {
    applyStoreOverrides(encryptionMapOverrideStore, 'modules', entry.overrides?.maps as OverrideMap<ModuleEncryptionMap>, { label: 'encryption.maps' })
  }
}

function registerBuiltInModuleOverrideAppliers(): void {
  registerModuleOverrideApplier<RoutesOverridesShape>('routes', routesOverridesApplier)
  registerModuleOverrideApplier<EventsOverridesShape>('events', eventsOverridesApplier)
  registerModuleOverrideApplier<WorkerOverridesMap>('workers', workersOverridesApplier)
  registerModuleOverrideApplier<WidgetsOverridesShape>('widgets', widgetsOverridesApplier)
  registerModuleOverrideApplier<NotificationsOverridesShape>('notifications', notificationsOverridesApplier)
  registerModuleOverrideApplier<ApiInterceptorOverridesMap>('interceptors', interceptorsOverridesApplier)
  registerModuleOverrideApplier<CommandInterceptorOverridesMap>('commandInterceptors', commandInterceptorsOverridesApplier)
  registerModuleOverrideApplier<ResponseEnricherOverridesMap>('enrichers', enrichersOverridesApplier)
  registerModuleOverrideApplier<PageGuardOverridesMap>('guards', guardsOverridesApplier)
  registerModuleOverrideApplier<CliOverridesMap>('cli', cliOverridesApplier)
  registerModuleOverrideApplier<SetupOverridesShape>('setup', setupOverridesApplier)
  registerModuleOverrideApplier<AclOverridesShape>('acl', aclOverridesApplier)
  registerModuleOverrideApplier<DiOverridesMap>('di', diOverridesApplier)
  registerModuleOverrideApplier<EncryptionOverridesShape>('encryption', encryptionOverridesApplier)
}

registerBuiltInModuleOverrideAppliers()
