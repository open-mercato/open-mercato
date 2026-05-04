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
}

/** Phase 2/3 — routes (api + pages). Stubbed until wired. */
export interface RoutesOverridesShape {
  api?: Record<string, unknown>
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
