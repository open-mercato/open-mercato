/**
 * `AvailabilityPolicy` resolution chain — six levels, most specific wins.
 *
 * @see .ai/specs/2026-08-14-availability-contract.md §5.2
 *
 * Resolution design (documented here because §5.2 does not fully spell it
 * out — see PLAN.md § Key design decisions):
 *
 * - Boolean columns (`isStockManaged`, `allowBackorder`, `hideWhenOutOfStock`,
 *   `isActive`) are NOT NULL, so a matched row's own value is always
 *   concrete — there is no "unset" to fall through. The single most specific
 *   EXISTING row decides every boolean field.
 * - Nullable columns (`backorderLeadTimeDays`, `preorderReleaseAt`,
 *   `lowStockThreshold`, `minOrderQuantity`, `maxOrderQuantity`,
 *   `quantityIncrement`) genuinely cascade: a matched row that leaves the
 *   field `null` defers to the next-less-specific row, per US-A2's "which
 *   level currently decides each field" requirement.
 *
 * `resolveMany()` exists so `wms`'s batched `check()` (§4.2/R4 — one policy
 * lookup regardless of item count) can soft-resolve this service and still
 * issue exactly one query for the whole batch, rather than one per item.
 * `resolve()` is `resolveMany([scope])[0]`, so single-item callers (the admin
 * check tool, the resolve-preview endpoint) are unaffected.
 */

import type { EntityManager } from '@mikro-orm/postgresql'
import { AvailabilityPolicy } from '../data/entities'
import { tryResolve } from './tryResolve'

export type PolicyResolutionScope = {
  tenantId: string
  organizationId: string
  storeId?: string | null
  productId: string
  variantId?: string | null
}

export type ResolvedField<T> = {
  value: T
  /** The `AvailabilityPolicy` row id that decided, or `null` for the module default. */
  policySourceId: string | null
}

export type ResolvedAvailabilityPolicy = {
  isStockManaged: ResolvedField<boolean>
  allowBackorder: ResolvedField<boolean>
  backorderLeadTimeDays: ResolvedField<number | null>
  preorderReleaseAt: ResolvedField<Date | null>
  lowStockThreshold: ResolvedField<number | null>
  minOrderQuantity: ResolvedField<number | null>
  maxOrderQuantity: ResolvedField<number | null>
  quantityIncrement: ResolvedField<number | null>
  hideWhenOutOfStock: ResolvedField<boolean>
  isActive: ResolvedField<boolean>
}

/** The six chain levels, most specific first. `null` = "no row matched this level". */
export type PolicyChainLevel =
  | 'variant_store'
  | 'variant'
  | 'product_store'
  | 'product'
  | 'store_default'
  | 'module_default'

export const POLICY_CHAIN_LEVELS: PolicyChainLevel[] = [
  'variant_store',
  'variant',
  'product_store',
  'product',
  'store_default',
  'module_default',
]

const NULLABLE_FIELDS = [
  'backorderLeadTimeDays',
  'preorderReleaseAt',
  'lowStockThreshold',
  'minOrderQuantity',
  'maxOrderQuantity',
  'quantityIncrement',
] as const

const BOOLEAN_FIELDS = ['isStockManaged', 'allowBackorder', 'hideWhenOutOfStock', 'isActive'] as const

function candidateFilters(scope: PolicyResolutionScope): Array<Record<string, unknown>> {
  const storeId = scope.storeId ?? null
  const variantId = scope.variantId ?? null
  const filters: Array<Record<string, unknown>> = []
  if (variantId) {
    filters.push({ variantId, storeId })
    filters.push({ variantId, storeId: null })
  }
  filters.push({ productId: scope.productId, variantId: null, storeId })
  filters.push({ productId: scope.productId, variantId: null, storeId: null })
  filters.push({ productId: null, variantId: null, storeId })
  return filters
}

/** Picks the (up to) five candidate rows for one scope out of a shared, already-loaded candidate pool. */
function matchChainRows(scope: PolicyResolutionScope, pool: AvailabilityPolicy[]): Array<AvailabilityPolicy | null> {
  const storeId = scope.storeId ?? null
  const variantId = scope.variantId ?? null
  const findMatch = (predicate: (row: AvailabilityPolicy) => boolean) => pool.find(predicate) ?? null

  const rows: Array<AvailabilityPolicy | null> = []
  if (variantId) {
    rows.push(findMatch((r) => r.variantId === variantId && (r.storeId ?? null) === storeId))
    rows.push(findMatch((r) => r.variantId === variantId && (r.storeId ?? null) === null))
  }
  rows.push(findMatch((r) => r.productId === scope.productId && !r.variantId && (r.storeId ?? null) === storeId))
  rows.push(findMatch((r) => r.productId === scope.productId && !r.variantId && (r.storeId ?? null) === null))
  rows.push(findMatch((r) => !r.productId && !r.variantId && (r.storeId ?? null) === storeId))
  return rows
}

function resolveFromRows(
  rows: Array<AvailabilityPolicy | null>,
  isStockManagedModuleDefault: boolean,
): ResolvedAvailabilityPolicy {
  const firstRow = rows.find((row): row is AvailabilityPolicy => row != null) ?? null
  const result = {} as ResolvedAvailabilityPolicy

  for (const field of BOOLEAN_FIELDS) {
    if (firstRow) {
      ;(result as any)[field] = { value: (firstRow as any)[field], policySourceId: firstRow.id }
    } else {
      ;(result as any)[field] = { value: false, policySourceId: null }
    }
  }

  // is_stock_managed's module default is dynamic (wms + profile existence), not a flat `false`.
  if (!firstRow) result.isStockManaged = { value: isStockManagedModuleDefault, policySourceId: null }
  // is_active's module default is "active" (nothing to deactivate).
  if (!firstRow) result.isActive = { value: true, policySourceId: null }

  for (const field of NULLABLE_FIELDS) {
    let resolved: ResolvedField<unknown> = { value: null, policySourceId: null }
    for (const row of rows) {
      if (row && (row as any)[field] != null) {
        resolved = { value: (row as any)[field], policySourceId: row.id }
        break
      }
    }
    ;(result as any)[field] = resolved
  }

  return result
}

/** `is_stock_managed`'s module default: true when `wms` is enabled and a `ProductInventoryProfile` exists for the item. */
export async function resolveIsStockManagedModuleDefault(
  em: EntityManager,
  container: { resolve: <T = unknown>(name: string) => T },
  scope: { tenantId: string; organizationId: string; productId: string; variantId?: string | null },
): Promise<boolean> {
  const ProductInventoryProfile = tryResolve<new () => unknown>(container, 'ProductInventoryProfile')
  if (!ProductInventoryProfile) return false

  const baseFilter = {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    catalogProductId: scope.productId,
    deletedAt: null,
  }

  if (scope.variantId) {
    const variantRow = await em.findOne(ProductInventoryProfile as any, { ...baseFilter, catalogVariantId: scope.variantId })
    if (variantRow) return true
  }

  const productRow = await em.findOne(ProductInventoryProfile as any, { ...baseFilter, catalogVariantId: null })
  return !!productRow
}

/** Batched module-default check for `resolveMany` — one query for every scope that might need it. */
async function resolveIsStockManagedModuleDefaultMany(
  em: EntityManager,
  container: { resolve: <T = unknown>(name: string) => T },
  scopes: PolicyResolutionScope[],
): Promise<Map<string, boolean>> {
  const ProductInventoryProfile = tryResolve<new () => unknown>(container, 'ProductInventoryProfile')
  const results = new Map<string, boolean>()
  if (!ProductInventoryProfile || scopes.length === 0) return results

  const first = scopes[0]
  const productIds = Array.from(new Set(scopes.map((s) => s.productId)))
  const rows = (await em.find(ProductInventoryProfile as any, {
    tenantId: first.tenantId,
    organizationId: first.organizationId,
    deletedAt: null,
    catalogProductId: { $in: productIds },
  } as any)) as Array<{ catalogProductId: string; catalogVariantId: string | null }>

  const exists = new Set(rows.map((row) => `${row.catalogProductId}:${row.catalogVariantId ?? ''}`))
  for (const scope of scopes) {
    const variantHit = scope.variantId ? exists.has(`${scope.productId}:${scope.variantId}`) : false
    const productHit = exists.has(`${scope.productId}:`)
    results.set(scopeKey(scope), variantHit || productHit)
  }
  return results
}

function scopeKey(scope: PolicyResolutionScope): string {
  return `${scope.productId}:${scope.variantId ?? ''}:${scope.storeId ?? ''}`
}

export interface PolicyResolutionService {
  resolve(em: EntityManager, scope: PolicyResolutionScope): Promise<ResolvedAvailabilityPolicy>
  resolveMany(em: EntityManager, scopes: PolicyResolutionScope[]): Promise<ResolvedAvailabilityPolicy[]>
}

export function createPolicyResolutionService(container: {
  resolve: <T = unknown>(name: string) => T
}): PolicyResolutionService {
  async function resolveMany(em: EntityManager, scopes: PolicyResolutionScope[]): Promise<ResolvedAvailabilityPolicy[]> {
    if (scopes.length === 0) return []

    const first = scopes[0]
    const seen = new Set<string>()
    const orFilters: Array<Record<string, unknown>> = []
    for (const scope of scopes) {
      for (const filter of candidateFilters(scope)) {
        const key = JSON.stringify(filter)
        if (seen.has(key)) continue
        seen.add(key)
        orFilters.push(filter)
      }
    }

    const pool = orFilters.length
      ? await em.find(AvailabilityPolicy, {
          tenantId: first.tenantId,
          organizationId: first.organizationId,
          deletedAt: null,
          $or: orFilters as any,
        })
      : []

    // Only scopes that resolve to no row at all need the dynamic is_stock_managed
    // module default — batch just those.
    const rowsByScope = scopes.map((scope) => matchChainRows(scope, pool))
    const needsModuleDefault = scopes.filter((scope, index) => !rowsByScope[index].some((row) => row != null))
    const moduleDefaults = await resolveIsStockManagedModuleDefaultMany(em, container, needsModuleDefault)

    return scopes.map((scope, index) =>
      resolveFromRows(rowsByScope[index], moduleDefaults.get(scopeKey(scope)) ?? false),
    )
  }

  return {
    async resolve(em, scope) {
      const [result] = await resolveMany(em, [scope])
      return result
    },
    resolveMany,
  }
}
