import type { DataSyncAdapter, DataSyncStartControl } from './adapter'

/**
 * Keyed by the union rather than listed, so adding a control to
 * {@link DataSyncStartControl} fails to compile here instead of silently
 * dropping out of the resolution loop and the client-side read.
 */
const START_CONTROL_KEYS: Record<DataSyncStartControl, true> = { fullSync: true, batchSize: true }

export const DATA_SYNC_START_CONTROLS = Object.keys(START_CONTROL_KEYS) as readonly DataSyncStartControl[]

export type StartControlApplicability = Record<DataSyncStartControl, boolean>

/**
 * Which manual-start controls apply, per entity type, as resolved by
 * `api/options.ts` and read by the dashboard.
 *
 * The map is sparse: an entity type whose controls all apply is omitted, so an
 * adapter that declares nothing serializes to `{}` and adds nothing to the
 * wire. "Not declared" and "nothing restricted" therefore share one default.
 */
export type StartControlMap = Record<string, StartControlApplicability>

function allApplicable(): StartControlApplicability {
  return { fullSync: true, batchSize: true }
}

/**
 * A predicate that throws is treated as "applies". `api/options.ts` evaluates
 * every registered adapter in one response, so an adapter with a broken
 * predicate would otherwise take the options list — and with it the whole
 * dashboard — down for every other integration.
 */
function isApplicable(
  adapter: DataSyncAdapter,
  control: DataSyncStartControl,
  entityType: string,
): boolean {
  try {
    return adapter.supportsStartControl?.(control, entityType) !== false
  } catch {
    return true
  }
}

/**
 * Evaluates an adapter's declaration across the entity types it supports.
 *
 * The accumulator has a null prototype: assigning `__proto__` on a plain object
 * literal sets that object's prototype instead of creating an own property, so
 * an entity type under that name would serialize away and silently lose the
 * restriction the adapter declared.
 */
export function resolveStartControlMap(adapter: DataSyncAdapter | null | undefined): StartControlMap {
  if (!adapter || typeof adapter.supportsStartControl !== 'function') return {}
  const map: StartControlMap = Object.create(null)
  for (const entityType of adapter.supportedEntities ?? []) {
    const applicability = allApplicable()
    let restricted = false
    for (const control of DATA_SYNC_START_CONTROLS) {
      if (isApplicable(adapter, control, entityType)) continue
      applicability[control] = false
      restricted = true
    }
    if (restricted) map[entityType] = applicability
  }
  return map
}

/**
 * Reads the resolved map for the selected entity type, defaulting to "every
 * control applies" for an entity type the map does not restrict.
 *
 * The lookup is own-property only: an entity type named after something on
 * `Object.prototype` would otherwise read back an inherited value whose
 * `fullSync` is `undefined`, hiding a control the adapter never restricted.
 */
export function applicableStartControls(
  map: StartControlMap | null | undefined,
  entityType: string,
): StartControlApplicability {
  if (!map || !Object.prototype.hasOwnProperty.call(map, entityType)) return allApplicable()
  const declared = map[entityType]
  const applicability = allApplicable()
  for (const control of DATA_SYNC_START_CONTROLS) {
    if (declared?.[control] === false) applicability[control] = false
  }
  return applicability
}
