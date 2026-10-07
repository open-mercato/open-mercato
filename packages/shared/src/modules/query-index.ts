import type { EntityId } from './entities'
import { getSearchModuleConfigs } from './search'
import { createLogger } from '../lib/logger'

const logger = createLogger('shared').child({ component: 'query-index-registry' })

// =============================================================================
// Declaration shape
// =============================================================================

/**
 * How one entity type participates in the `query_index` read projection.
 */
export type QueryIndexEntityConfig = {
  /** Entity identifier, e.g. `'sales:sales_order_line'`. */
  entityId: EntityId
  /**
   * Whether records of this entity type are projected into `entity_indexes`.
   *
   * Default `true`: omitting the entity — or declaring nothing at all — leaves
   * the historical behaviour, where every entity a write path names earns a row.
   * Set `false` and no write path will ever write one, and the query engine will
   * answer the entity from its base table.
   */
  project?: boolean
}

/**
 * Module-level query-index configuration, declared in a module's `query-index.ts`.
 *
 * ```ts
 * // src/modules/sales/query-index.ts
 * import type { QueryIndexModuleConfig } from '@open-mercato/shared/modules/query-index'
 *
 * const config: QueryIndexModuleConfig = {
 *   entities: [{ entityId: 'sales:sales_order_line', project: false }],
 * }
 * export default config
 * ```
 */
export type QueryIndexModuleConfig = {
  entities: QueryIndexEntityConfig[]
}

/**
 * App-level shape, declared under `overrides.queryIndex` on any entry of the
 * app's `modules.ts`. `null` is the shorthand for `{ project: false }`, matching
 * the "`null` disables" convention the other override domains use.
 *
 * ```ts
 * { id: 'sales', overrides: { queryIndex: { entities: { 'sales:sales_order_line': null } } } }
 * ```
 */
export type QueryIndexEntityOverride = { project: boolean } | null

export type QueryIndexOverridesShape = {
  entities?: Record<string, QueryIndexEntityOverride>
}

// =============================================================================
// Registry
// =============================================================================

// Module declarations and app overrides are kept apart on purpose: bootstrap
// dispatches `modules.ts` overrides before the module registry first-loads, so a
// single merged map would be overwritten by whichever half registered last.
//
// The state lives on `globalThis`, not in module-local variables: this is a
// publishable cross-package registry — `registerModules()` and the override
// applier write it from `@open-mercato/shared`, `@open-mercato/core`'s
// `query_index` code reads it — and standalone builds can evaluate `shared`
// through more than one chunk (`src` and `dist`, or tsx/esbuild duplication in
// a worker). A writer landing in one instance while the reader saw an empty
// policy in another would project the entity type in one runtime and stop it in
// the other, which is exactly the partial coverage this switch exists to avoid.
// See `.ai/lessons.md`, "Global registries in publishable packages must use
// `globalThis`".
const GLOBAL_QUERY_INDEX_POLICY_STATE_KEY = '__openMercatoQueryIndexProjectionPolicyState__'

type QueryIndexPolicyState = {
  moduleConfigs: QueryIndexModuleConfig[]
  overrideEntries: QueryIndexOverridesShape[]
  resolved: Map<string, boolean> | null
  /** Entity types already reported as refused, so the warning is logged once per process. */
  refused: Set<string>
}

function getPolicyState(): QueryIndexPolicyState {
  const existing = (globalThis as Record<string, unknown>)[GLOBAL_QUERY_INDEX_POLICY_STATE_KEY]
  if (existing && typeof existing === 'object') {
    const typed = existing as QueryIndexPolicyState
    if ('moduleConfigs' in typed && 'overrideEntries' in typed) return typed
  }
  const initial: QueryIndexPolicyState = {
    moduleConfigs: [],
    overrideEntries: [],
    resolved: null,
    refused: new Set<string>(),
  }
  ;(globalThis as Record<string, unknown>)[GLOBAL_QUERY_INDEX_POLICY_STATE_KEY] = initial
  return initial
}

function resolveDeclarations(state: QueryIndexPolicyState): Map<string, boolean> {
  if (state.resolved) return state.resolved
  const resolved = new Map<string, boolean>()
  for (const config of state.moduleConfigs) {
    for (const entity of config?.entities ?? []) {
      const entityId = typeof entity?.entityId === 'string' ? entity.entityId : ''
      if (!entityId) continue
      resolved.set(entityId, entity.project !== false)
    }
  }
  // App overrides are applied last so an app always wins over the module that
  // declared the entity — the whole point of being able to stop a core entity
  // type without forking the module that owns it.
  for (const shape of state.overrideEntries) {
    for (const [entityId, override] of Object.entries(shape?.entities ?? {})) {
      if (!entityId) continue
      resolved.set(entityId, override != null && override.project !== false)
    }
  }
  state.resolved = resolved
  return resolved
}

/**
 * Whether search still indexes this entity type.
 *
 * Read at call time rather than folded into the resolved map: search configs are
 * registered after the module registry during bootstrap, so a memoised answer
 * could be computed before the search module had declared anything.
 */
function hasEnabledSearchConfig(entityType: string): boolean {
  for (const config of getSearchModuleConfigs()) {
    for (const entity of config?.entities ?? []) {
      if (entity?.entityId !== entityType) continue
      if (entity.enabled !== false) return true
    }
  }
  return false
}

function warnRefusedOnce(state: QueryIndexPolicyState, entityType: string): void {
  if (state.refused.has(entityType)) return
  state.refused.add(entityType)
  logger.warn(
    'Refusing to stop query-index projection for an entity type that search still indexes',
    {
      entityType,
      reason:
        'fulltext and vector indexing are driven from the projection write path, and search-result ' +
        'presenters are built from entity_indexes.doc; stopping the projection would quietly return ' +
        'stale, unpresented search results',
      remedy: `set \`enabled: false\` for ${entityType} in the owning module's search.ts (or drop it from the search config) before stopping its projection`,
    },
  )
}

/**
 * Register the `query-index.ts` declarations discovered on enabled modules.
 * Called by `registerModules()` so CLI, worker and request runtimes all agree.
 */
export function registerQueryIndexModuleConfigs(configs: QueryIndexModuleConfig[]): void {
  const state = getPolicyState()
  state.moduleConfigs = Array.isArray(configs)
    ? configs.filter((config): config is QueryIndexModuleConfig => !!config)
    : []
  state.resolved = null
}

/** Register the `overrides.queryIndex` shapes declared in the app's `modules.ts`. */
export function applyQueryIndexOverrides(shapes: QueryIndexOverridesShape[]): void {
  const state = getPolicyState()
  state.overrideEntries = Array.isArray(shapes)
    ? shapes.filter((shape): shape is QueryIndexOverridesShape => !!shape)
    : []
  state.resolved = null
  const stopped = listNonProjectedEntityTypes()
  if (stopped.length) {
    logger.info('Query index projection disabled for entity types', { entityTypes: stopped })
  }
}

/**
 * Whether `entity_indexes` carries rows for this entity type.
 *
 * Unknown entity types are projected, so an app that declares nothing keeps the
 * behaviour it had before this switch existed.
 *
 * A declaration that would stop an entity type search still indexes is refused
 * with a warning rather than honoured: `search.index_record` and
 * `query_index.vectorize_one` are emitted from the projection write path, and
 * the presenter enricher reads `entity_indexes.doc`, so honouring it would leave
 * the fulltext and vector indexes stale and strip presenters from the hits that
 * remain — all without an error.
 */
export function isEntityTypeProjected(entityType: string): boolean {
  if (!entityType) return true
  const state = getPolicyState()
  if (resolveDeclarations(state).get(entityType) !== false) return true
  if (!hasEnabledSearchConfig(entityType)) return false
  warnRefusedOnce(state, entityType)
  return true
}

/** Every entity type explicitly switched off, for logs and operator tooling. */
export function listNonProjectedEntityTypes(): string[] {
  const stopped: string[] = []
  for (const entityId of resolveDeclarations(getPolicyState()).keys()) {
    if (!isEntityTypeProjected(entityId)) stopped.push(entityId)
  }
  return stopped.sort((left, right) => left.localeCompare(right))
}

/** Drop the entity types this app does not project from a list of candidates. */
export function filterProjectedEntityTypes(entityTypes: string[]): string[] {
  if (!Array.isArray(entityTypes) || entityTypes.length === 0) return []
  return entityTypes.filter((entityType) => isEntityTypeProjected(entityType))
}

/** @__internal Test-only hook — forget every declaration and override. */
export function resetQueryIndexProjectionPolicyForTests(): void {
  const state = getPolicyState()
  state.moduleConfigs = []
  state.overrideEntries = []
  state.resolved = null
  state.refused = new Set<string>()
}
