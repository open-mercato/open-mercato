import type { DataSyncAdapter } from './adapter'

/**
 * The page size a run gets when neither the caller nor the adapter names one.
 *
 * Also the value `runSyncSchema` bounded its old `.default(100)` against, and the
 * one the dashboard's Batch size field falls back to.
 */
export const DATA_SYNC_DEFAULT_BATCH_SIZE = 100

/** The bounds `runSyncSchema.batchSize` accepts, shared so a declaration cannot exceed the API. */
export const DATA_SYNC_MIN_BATCH_SIZE = 1
export const DATA_SYNC_MAX_BATCH_SIZE = 1000

/**
 * Adapter-declared page sizes, per entity type, as resolved by `api/options.ts`
 * and read by the dashboard to seed its Batch size field.
 *
 * The map is sparse: an entity type the adapter declares nothing for is omitted,
 * so an adapter that declares nothing serializes to `{}` and adds nothing to the
 * wire. "Not declared" and "core's default" therefore share one default.
 */
export type DefaultBatchSizeMap = Record<string, number>

/**
 * A declaration outside the API's own bounds is CLAMPED rather than discarded:
 * an adapter asking for 5000 wants the largest page it can get, and 1000 is
 * nearer that intent than 100. Anything that is not a positive integer — a
 * float, `NaN`, a string, `undefined` — is not an intent at all and falls back.
 */
function normalize(declared: unknown): number | null {
  if (typeof declared !== 'number' || !Number.isInteger(declared) || declared < 1) return null
  return Math.min(declared, DATA_SYNC_MAX_BATCH_SIZE)
}

/**
 * A hook that throws is treated as "not declared". `api/options.ts` evaluates
 * every registered adapter in one response, so an adapter with a broken hook
 * would otherwise take the options list — and with it the whole dashboard —
 * down for every other integration. The same guard covers the start paths,
 * where a throw would refuse a run over a knob that only sets its page size.
 */
function declaredFor(adapter: DataSyncAdapter, entityType: string): number | null {
  try {
    return normalize(adapter.defaultBatchSize?.(entityType))
  } catch {
    return null
  }
}

/**
 * Evaluates an adapter's declaration across the entity types it supports.
 *
 * The accumulator has a null prototype: assigning `__proto__` on a plain object
 * literal sets that object's prototype instead of creating an own property, so
 * an entity type under that name would serialize away and silently lose the
 * page size the adapter declared.
 */
export function resolveDefaultBatchSizeMap(adapter: DataSyncAdapter | null | undefined): DefaultBatchSizeMap {
  if (!adapter || typeof adapter.defaultBatchSize !== 'function') return {}
  const map: DefaultBatchSizeMap = Object.create(null)
  for (const entityType of adapter.supportedEntities ?? []) {
    const declared = declaredFor(adapter, entityType)
    if (declared !== null) map[entityType] = declared
  }
  return map
}

/**
 * The page size for one entity type, server-side — the value every start path
 * uses when its caller named none.
 */
export function defaultBatchSizeFor(
  adapter: DataSyncAdapter | null | undefined,
  entityType: string,
): number {
  if (!adapter) return DATA_SYNC_DEFAULT_BATCH_SIZE
  return declaredFor(adapter, entityType) ?? DATA_SYNC_DEFAULT_BATCH_SIZE
}

/**
 * Reads the resolved map for the selected entity type, defaulting to core's own
 * value for an entity type the map does not declare.
 *
 * The lookup is own-property only: an entity type named after something on
 * `Object.prototype` would otherwise read back an inherited value that is not a
 * page size at all.
 */
export function declaredDefaultBatchSize(
  map: DefaultBatchSizeMap | null | undefined,
  entityType: string,
): number {
  if (!map || !Object.prototype.hasOwnProperty.call(map, entityType)) return DATA_SYNC_DEFAULT_BATCH_SIZE
  return normalize(map[entityType]) ?? DATA_SYNC_DEFAULT_BATCH_SIZE
}
