import type { AssortmentScope, EffectiveAssortmentScope } from '@open-mercato/shared/lib/catalog-visibility'
import type { Where } from '@open-mercato/shared/lib/query/types'
import type { SearchIndexDocCondition, SearchIndexDocFilter } from '@open-mercato/shared/modules/search'
import {
  PRODUCT_SCOPE_KEYS_DOC_KEY,
  categoryScopeKey,
  compareCodeUnits,
  tagScopeKey,
} from '@open-mercato/core/modules/catalog/lib/productScopeKeys'
import type { BuyerContext, StoreContext } from './types'

/**
 * The query-engine inputs every storefront product query composes (Storefront Public API §3.3).
 * Spread it into the `QueryOptions` of a `catalog:catalog_product` query and combine any further
 * filters through `composeStorefrontProductFilters` — never by spreading `filters`, which would let
 * a caller's key replace a clause of the invariant.
 */
export type StorefrontProductScope = {
  tenantId: string
  organizationId: string
  withDeleted: false
  filters: Where
}

export type StorefrontProductScopeContext = Pick<StoreContext, 'tenantId' | 'organizationId'> & {
  buyer: Pick<BuyerContext, 'assortmentScope'>
}

type ScopeLeaf = { where: Where; condition: SearchIndexDocCondition }

type BranchConditions = {
  inclusions: string[][]
  exclusions: Set<string>
  excludedProductIds: Set<string>
}

function sortedUnique(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort(compareCodeUnits)
}

function nonEmptyIds(ids: string[] | undefined): string[] {
  return (ids ?? []).filter((id) => typeof id === 'string' && id.length > 0)
}

function collectBranchConditions(scope: AssortmentScope, into: BranchConditions): void {
  const categoryIds = nonEmptyIds(scope.categoryIds)
  if (categoryIds.length > 0) into.inclusions.push(sortedUnique(categoryIds.map(categoryScopeKey)))
  const tagIds = nonEmptyIds(scope.tagIds)
  if (tagIds.length > 0) into.inclusions.push(sortedUnique(tagIds.map(tagScopeKey)))
  for (const id of nonEmptyIds(scope.excludeCategoryIds)) into.exclusions.add(categoryScopeKey(id))
  for (const id of nonEmptyIds(scope.excludeTagIds)) into.exclusions.add(tagScopeKey(id))
  for (const id of nonEmptyIds(scope.excludeProductIds)) into.excludedProductIds.add(id)
  for (const nested of scope.allOf ?? []) collectBranchConditions(nested, into)
}

/**
 * One AND-scope as a deduplicated leaf map keyed by a canonical form. Every branch requires the
 * product to be scope-indexed (`scope_keys` present), so a document that was never enriched or
 * whose enrichment failed cannot match any restricted scope (fail closed, §3.3 backfill rule).
 * Category and tag exclusions share one `noverlap` leaf: their keys live in disjoint `cat:`/`tag:`
 * namespaces, so `NOT overlap(cats) AND NOT overlap(tags)` equals `NOT overlap(cats ∪ tags)`.
 */
function branchLeaves(scope: AssortmentScope): Map<string, ScopeLeaf> {
  const conditions: BranchConditions = { inclusions: [], exclusions: new Set(), excludedProductIds: new Set() }
  collectBranchConditions(scope, conditions)
  const leaves = new Map<string, ScopeLeaf>()
  const key = PRODUCT_SCOPE_KEYS_DOC_KEY
  leaves.set('indexed', { where: { [key]: { $exists: true } }, condition: { op: 'exists', key } })
  for (const keys of conditions.inclusions) {
    leaves.set(`overlap:${JSON.stringify(keys)}`, {
      where: { [key]: { $overlap: keys } },
      condition: { op: 'overlap', key, values: keys },
    })
  }
  if (conditions.exclusions.size > 0) {
    const keys = sortedUnique(conditions.exclusions)
    leaves.set(`noverlap:${JSON.stringify(keys)}`, {
      where: { [key]: { $noverlap: keys } },
      condition: { op: 'noverlap', key, values: keys },
    })
  }
  if (conditions.excludedProductIds.size > 0) {
    const ids = sortedUnique(conditions.excludedProductIds)
    leaves.set(`nin:${JSON.stringify(ids)}`, { where: { id: { $nin: ids } }, condition: { op: 'recordIdNotIn', values: ids } })
  }
  return leaves
}

function scopeBranches(scope: AssortmentScope[]): ScopeLeaf[][] {
  return absorbBranches(scope.map(branchLeaves)).map((leaves) => Array.from(leaves.values()))
}

function isSubset(smaller: Map<string, ScopeLeaf>, larger: Map<string, ScopeLeaf>): boolean {
  if (smaller.size > larger.size) return false
  for (const key of smaller.keys()) if (!larger.has(key)) return false
  return true
}

/**
 * Absorption (`A OR (A AND B) = A`): a branch whose leaves are a superset of another branch's is
 * implied by it and dropped, as is any repeat of an identical branch. Besides keeping the SQL
 * small, this guarantees no disjunct becomes empty when `normalizeFilters` lifts the clauses all
 * disjuncts share — it treats such an emptied disjunct as absent instead of as TRUE.
 */
function absorbBranches(branches: Map<string, ScopeLeaf>[]): Map<string, ScopeLeaf>[] {
  return branches.filter((branch, index) =>
    !branches.some((other, otherIndex) => {
      if (otherIndex === index || !isSubset(other, branch)) return false
      return other.size < branch.size || otherIndex < index
    }),
  )
}

/**
 * Translates a resolved `EffectiveAssortmentScope` into a query-engine `Where` over the product's
 * index document (`buyer-scoped-catalog-visibility.md` §3.3 DNF): branches are OR'd; within a branch
 * `categoryIds` and `tagIds` each become `scope_keys overlap`, the exclusions `scope_keys noverlap`
 * and `id nin`, and every `allOf` entry is AND'ed in recursively.
 *
 * `null` (unrestricted) yields `null` — no scope clause, so not-yet-indexed products stay visible.
 * `[]` (deny-all) yields an empty `overlap`, which the engine compiles to `false`; it is never an
 * empty `$or`, which the filter normalizer would drop and thereby widen the query.
 *
 * `scope_keys` carries each assigned category's ancestors, so a scope granting category X matches
 * products assigned to any descendant of X — the "includes descendants" rule (§4.1).
 */
export function buildAssortmentScopeFilter(scope: EffectiveAssortmentScope): Where | null {
  if (scope === null) return null
  if (scope.length === 0) return { [PRODUCT_SCOPE_KEYS_DOC_KEY]: { $overlap: [] } }
  const conjunctions = scopeBranches(scope).map((leaves) => ({ $and: leaves.map((leaf) => leaf.where) }))
  return conjunctions.length === 1 ? conjunctions[0] : { $or: conjunctions }
}

const ACTIVE_PRODUCT_CONDITION: SearchIndexDocCondition = { op: 'eq', key: 'is_active', value: true }

/**
 * The storefront invariant as a search-strategy predicate over the product's index document
 * (Storefront Public API §8.2, D19): the same DNF branches as `buildAssortmentScopeFilter`, each
 * AND'ed with `is_active`, so the `tokens` and `pgvector` strategies evaluate scope inside the
 * ranking query. Tenant and organization travel as `SearchOptions` scoping; deleted products have
 * no live index row. `null` scope keeps only the active condition; `[]` yields an empty
 * disjunction, which matches nothing.
 */
export function buildStorefrontSearchIndexDocFilter(ctx: StorefrontProductScopeContext): SearchIndexDocFilter {
  const scope = ctx.buyer.assortmentScope
  if (scope === null) return { anyOf: [[ACTIVE_PRODUCT_CONDITION]] }
  return {
    anyOf: scopeBranches(scope).map((leaves) => [ACTIVE_PRODUCT_CONDITION, ...leaves.map((leaf) => leaf.condition)]),
  }
}

/**
 * The assortment invariant (§3.3): tenant and organization of the store context, not deleted,
 * active, and inside the buyer's effective assortment (`channel ∩ buyer`, already intersected
 * into `ctx.buyer.assortmentScope`). Throws when the context lacks a tenant or organization.
 */
export function buildStorefrontProductScope(ctx: StorefrontProductScopeContext): StorefrontProductScope {
  const { tenantId, organizationId } = ctx
  if (!tenantId || !organizationId) {
    throw new Error('[internal] buildStorefrontProductScope requires tenantId and organizationId')
  }
  const invariant: Where = {
    tenant_id: tenantId,
    organization_id: organizationId,
    deleted_at: null,
    is_active: true,
  }
  const scopeFilter = buildAssortmentScopeFilter(ctx.buyer.assortmentScope)
  return {
    tenantId,
    organizationId,
    withDeleted: false,
    filters: scopeFilter ? { ...invariant, $and: [scopeFilter] } : invariant,
  }
}

/** AND-combines the storefront scope with endpoint filters without letting either replace the other's clauses. */
export function composeStorefrontProductFilters(scope: StorefrontProductScope, extra?: Where | null): Where {
  if (!extra || Object.keys(extra).length === 0) return scope.filters
  return { $and: [scope.filters, extra] }
}
