import type { EntityId } from './entities'
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
let _moduleConfigs: QueryIndexModuleConfig[] = []
let _overrideEntries: QueryIndexOverridesShape[] = []
let _resolved: Map<string, boolean> | null = null

function resolve(): Map<string, boolean> {
  if (_resolved) return _resolved
  const resolved = new Map<string, boolean>()
  for (const config of _moduleConfigs) {
    for (const entity of config?.entities ?? []) {
      const entityId = typeof entity?.entityId === 'string' ? entity.entityId : ''
      if (!entityId) continue
      resolved.set(entityId, entity.project !== false)
    }
  }
  // App overrides are applied last so an app always wins over the module that
  // declared the entity — the whole point of being able to stop a core entity
  // type without forking the module that owns it.
  for (const shape of _overrideEntries) {
    for (const [entityId, override] of Object.entries(shape?.entities ?? {})) {
      if (!entityId) continue
      resolved.set(entityId, override != null && override.project !== false)
    }
  }
  _resolved = resolved
  return resolved
}

/**
 * Register the `query-index.ts` declarations discovered on enabled modules.
 * Called by `registerModules()` so CLI, worker and request runtimes all agree.
 */
export function registerQueryIndexModuleConfigs(configs: QueryIndexModuleConfig[]): void {
  _moduleConfigs = Array.isArray(configs) ? configs.filter((config): config is QueryIndexModuleConfig => !!config) : []
  _resolved = null
}

/** Register the `overrides.queryIndex` shapes declared in the app's `modules.ts`. */
export function applyQueryIndexOverrides(shapes: QueryIndexOverridesShape[]): void {
  _overrideEntries = Array.isArray(shapes) ? shapes.filter((shape): shape is QueryIndexOverridesShape => !!shape) : []
  _resolved = null
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
 */
export function isEntityTypeProjected(entityType: string): boolean {
  if (!entityType) return true
  const value = resolve().get(entityType)
  return value === undefined ? true : value
}

/** Every entity type explicitly switched off, for logs and operator tooling. */
export function listNonProjectedEntityTypes(): string[] {
  const stopped: string[] = []
  for (const [entityId, projected] of resolve()) {
    if (!projected) stopped.push(entityId)
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
  _moduleConfigs = []
  _overrideEntries = []
  _resolved = null
}
