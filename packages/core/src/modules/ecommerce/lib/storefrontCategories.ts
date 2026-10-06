import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { sql } from 'kysely'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { CatalogProductCategory } from '@open-mercato/core/modules/catalog/data/entities'
import { compareCodeUnits } from '@open-mercato/core/modules/catalog/lib/productScopeKeys'
import type { EcommerceStorefrontCategoryTreeQuery } from '../data/validators'
import {
  STOREFRONT_CATEGORY_ENTITY_TYPE,
  isCategoryInAssortment,
  loadStorefrontTranslations,
  localeChain,
  localize,
  stringList,
  tryResolve,
  type TranslationMap,
} from './storefrontCatalogSupport'
import { queryStorefrontProductUniverse, type StorefrontFacetRuntime } from './storefrontFacets'
import { buildStorefrontProductScope } from './storefrontProductScope'
import type { StoreContext } from './types'

/**
 * Category tree and category landing (Storefront Public API rev 4 §4.3, §4.4).
 *
 * A category is visible to a buyer when it is active, every ancestor is active (so the tree can
 * reach it) and `isCategoryInAssortment` admits it. Counts are descendant-inclusive and taken over
 * the buyer's assortment universe (`buildStorefrontProductScope`: tenant, organization, active,
 * not deleted, inside the effective scope), so a restricted buyer never sees a count for products
 * they cannot browse. Nothing here depends on prices, so the results are keyed on
 * `assortmentScopeHash` by `storefrontCategoryCache.ts`.
 *
 * Query shape, uncached: categories, the scoped product ids, the category assignments of those
 * products, and one multi-entity translation query — four, regardless of tree size. A buyer whose
 * assortment is deny-all (`[]`, e.g. a closed `require_authentication` channel) costs none.
 */

export type StorefrontCategoryNode = {
  id: string
  name: string
  slug: string | null
  description: string | null
  depth: number
  parentId: string | null
  productCount: number
  hasChildren: boolean
  children: StorefrontCategoryNode[]
}

export type StorefrontCategoryTreeResponse = {
  tree: StorefrontCategoryNode[]
  effectiveLocale: string
}

export type StorefrontCategoryBreadcrumbEntry = { id: string; name: string; slug: string | null }

export type StorefrontCategoryChild = { id: string; name: string; slug: string | null; productCount: number }

export type StorefrontCategorySeo = { title: string | null; description: string | null; canonicalUrl: string | null }

export type StorefrontCategoryLanding = {
  id: string
  name: string
  slug: string | null
  description: string | null
  depth: number
  parentId: string | null
  ancestorIds: string[]
  breadcrumb: StorefrontCategoryBreadcrumbEntry[]
  children: StorefrontCategoryChild[]
  productCount: number
  seo: StorefrontCategorySeo
}

export type StorefrontCategoryLandingBlock = {
  category: StorefrontCategoryLanding
  effectiveLocale: string
}

type CategoryRow = {
  id: string
  name: string
  slug: string | null
  description: string | null
  depth: number
  parentId: string | null
  isActive: boolean
  ancestorIds: string[]
  descendantIds: string[]
}

type CategorySnapshot = {
  visible: Map<string, CategoryRow>
  counts: Map<string, number>
}

type CategoryAssignmentDatabase = {
  catalog_product_category_assignments: {
    product_id: string
    category_id: string
    tenant_id: string
    organization_id: string
  }
}

const EMPTY_SNAPSHOT: CategorySnapshot = { visible: new Map(), counts: new Map() }

function resolveRuntime(container: AwilixContainer, ctx: StoreContext): StorefrontFacetRuntime {
  const em = tryResolve<EntityManager>(container, 'em')
  const queryEngine = tryResolve<QueryEngine>(container, 'queryEngine')
  if (!em || !queryEngine) throw new Error('[internal] ecommerce storefront categories require em and queryEngine')
  return {
    ctx,
    em,
    queryEngine,
    scope: buildStorefrontProductScope(ctx),
    decryptionScope: { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
  }
}

function isDenyAll(ctx: StoreContext): boolean {
  const scope = ctx.buyer.assortmentScope
  return scope !== null && scope.length === 0
}

type CategoryLoadRuntime = Pick<StorefrontFacetRuntime, 'ctx' | 'em' | 'decryptionScope'>

export type StorefrontVisibleCategory = CategoryRow

async function loadCategoryRows(runtime: CategoryLoadRuntime): Promise<Map<string, CategoryRow>> {
  const { ctx } = runtime
  const rows = await findWithDecryption(
    runtime.em,
    CatalogProductCategory,
    { tenantId: ctx.tenantId, organizationId: ctx.organizationId, deletedAt: null },
    { fields: ['id', 'name', 'slug', 'description', 'depth', 'parentId', 'isActive', 'ancestorIds', 'descendantIds'] },
    runtime.decryptionScope,
  )
  return new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        name: row.name,
        slug: row.slug ?? null,
        description: row.description ?? null,
        depth: typeof row.depth === 'number' ? row.depth : 0,
        parentId: row.parentId ?? null,
        isActive: row.isActive !== false,
        ancestorIds: stringList(row.ancestorIds),
        descendantIds: stringList(row.descendantIds),
      },
    ]),
  )
}

function selectVisibleCategories(rows: Map<string, CategoryRow>, ctx: StoreContext): Map<string, CategoryRow> {
  const visible = new Map<string, CategoryRow>()
  for (const row of rows.values()) {
    if (!row.isActive) continue
    if (!row.ancestorIds.every((id) => rows.get(id)?.isActive === true)) continue
    const lineage = { id: row.id, ancestorIds: row.ancestorIds, descendantIds: row.descendantIds }
    if (!isCategoryInAssortment(lineage, ctx.buyer.assortmentScope)) continue
    visible.set(row.id, row)
  }
  return visible
}

/** The tenant's categories visible to the buyer (see the module header): one categories query. */
export async function loadStorefrontVisibleCategories(runtime: CategoryLoadRuntime): Promise<Map<string, StorefrontVisibleCategory>> {
  return selectVisibleCategories(await loadCategoryRows(runtime), runtime.ctx)
}

async function loadAssignedCategoryIds(
  runtime: StorefrontFacetRuntime,
  productIds: string[],
): Promise<Map<string, string[]>> {
  const { tenantId, organizationId } = runtime.decryptionScope
  const rows = await runtime.em
    .getKysely<CategoryAssignmentDatabase>()
    .selectFrom('catalog_product_category_assignments as ca')
    .select(['ca.product_id as product_id', 'ca.category_id as category_id'])
    .where(sql<boolean>`${sql.ref('ca.product_id')} = any(${productIds}::uuid[])`)
    .where('ca.tenant_id', '=', tenantId)
    .where('ca.organization_id', '=', organizationId)
    .execute()
  const byProduct = new Map<string, string[]>()
  for (const row of rows) {
    const bucket = byProduct.get(row.product_id) ?? []
    bucket.push(row.category_id)
    byProduct.set(row.product_id, bucket)
  }
  return byProduct
}

/**
 * Descendant-inclusive product counts: a product counts once for every category it is assigned to
 * and once for each ancestor of those, however many of its assignments share an ancestor.
 */
export function countProductsPerCategory(
  assignedByProduct: Map<string, string[]>,
  ancestorsOf: (categoryId: string) => string[] | null,
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const assigned of assignedByProduct.values()) {
    const reached = new Set<string>()
    for (const categoryId of assigned) {
      const ancestors = ancestorsOf(categoryId)
      if (!ancestors) continue
      reached.add(categoryId)
      for (const ancestorId of ancestors) reached.add(ancestorId)
    }
    for (const categoryId of reached) counts.set(categoryId, (counts.get(categoryId) ?? 0) + 1)
  }
  return counts
}

async function loadCategorySnapshot(runtime: StorefrontFacetRuntime): Promise<CategorySnapshot> {
  if (isDenyAll(runtime.ctx)) return EMPTY_SNAPSHOT
  const [rows, universe] = await Promise.all([
    loadCategoryRows(runtime),
    queryStorefrontProductUniverse(runtime, runtime.scope.filters),
  ])
  const visible = selectVisibleCategories(rows, runtime.ctx)
  if (visible.size === 0) return { visible, counts: new Map() }
  const productIds = Array.from(
    new Set(universe.flatMap((record) => (typeof record.id === 'string' ? [record.id] : []))),
  )
  if (productIds.length === 0) return { visible, counts: new Map() }
  const assigned = await loadAssignedCategoryIds(runtime, productIds)
  const counts = countProductsPerCategory(assigned, (categoryId) => rows.get(categoryId)?.ancestorIds ?? null)
  return { visible, counts }
}

function compareNodes(left: { name: string; id: string }, right: { name: string; id: string }): number {
  return left.name.localeCompare(right.name) || compareCodeUnits(left.id, right.id)
}

function localizedName(row: CategoryRow, translations: TranslationMap | undefined, locales: string[]): string {
  return localize(row.name, translations?.get(row.id), 'name', locales) ?? row.name
}

function localizedDescription(row: CategoryRow, translations: TranslationMap | undefined, locales: string[]): string | null {
  return localize(row.description, translations?.get(row.id), 'description', locales)
}

function childrenIndex(
  visible: Map<string, CategoryRow>,
  eligible: (row: CategoryRow) => boolean,
): Map<string | null, CategoryRow[]> {
  const index = new Map<string | null, CategoryRow[]>()
  for (const row of visible.values()) {
    if (!eligible(row)) continue
    const parentKey = row.parentId !== null && visible.has(row.parentId) ? row.parentId : null
    if (row.parentId !== null && parentKey === null) continue
    const bucket = index.get(parentKey) ?? []
    bucket.push(row)
    index.set(parentKey, bucket)
  }
  return index
}

function collectTreeIds(
  index: Map<string | null, CategoryRow[]>,
  parentKey: string | null,
  levels: number,
  into: string[],
): void {
  if (levels <= 0) return
  for (const row of index.get(parentKey) ?? []) {
    into.push(row.id)
    collectTreeIds(index, row.id, levels - 1, into)
  }
}

/**
 * `GET /categories`: the visible tree below `parentId` (the roots when omitted), `depth` levels
 * deep (all levels when omitted). Empty categories are dropped unless `includeEmpty`; a node
 * beyond `depth` is not expanded but still reports `hasChildren`. An unknown, hidden or
 * out-of-assortment `parentId` yields an empty tree, exactly like a nonexistent one.
 */
export async function getStorefrontCategoryTree(
  container: AwilixContainer,
  ctx: StoreContext,
  query: Pick<EcommerceStorefrontCategoryTreeQuery, 'parentId' | 'depth' | 'includeEmpty'>,
): Promise<StorefrontCategoryTreeResponse> {
  const runtime = resolveRuntime(container, ctx)
  const { visible, counts } = await loadCategorySnapshot(runtime)
  const includeEmpty = query.includeEmpty === true
  const index = childrenIndex(visible, (row) => includeEmpty || (counts.get(row.id) ?? 0) > 0)
  const parentKey = query.parentId ?? null
  if (parentKey !== null && !visible.has(parentKey)) return { tree: [], effectiveLocale: ctx.effectiveLocale }
  const levels = query.depth ?? Number.POSITIVE_INFINITY
  const ids: string[] = []
  collectTreeIds(index, parentKey, levels, ids)
  const translations = (
    await loadStorefrontTranslations(runtime.em, ctx, [{ entityType: STOREFRONT_CATEGORY_ENTITY_TYPE, ids }])
  ).get(STOREFRONT_CATEGORY_ENTITY_TYPE)
  const locales = localeChain(ctx)

  const build = (parent: string | null, remaining: number): StorefrontCategoryNode[] => {
    if (remaining <= 0) return []
    return (index.get(parent) ?? [])
      .map((row) => ({ row, name: localizedName(row, translations, locales) }))
      .sort((left, right) => compareNodes({ name: left.name, id: left.row.id }, { name: right.name, id: right.row.id }))
      .map(({ row, name }) => ({
        id: row.id,
        name,
        slug: row.slug,
        description: localizedDescription(row, translations, locales),
        depth: row.depth,
        parentId: row.parentId,
        productCount: counts.get(row.id) ?? 0,
        hasChildren: (index.get(row.id)?.length ?? 0) > 0,
        children: build(row.id, remaining - 1),
      }))
  }
  return { tree: build(parentKey, levels), effectiveLocale: ctx.effectiveLocale }
}

/**
 * The category block of `GET /categories/:slug`. `null` for a slug that matches no visible
 * category — nonexistent, inactive, deleted, another tenant's, outside the buyer's assortment, or
 * under an inactive ancestor — all through the same single categories query, so the three cases
 * cannot be told apart by cost or by answer.
 */
export async function getStorefrontCategoryLanding(
  container: AwilixContainer,
  ctx: StoreContext,
  slug: string,
): Promise<StorefrontCategoryLandingBlock | null> {
  const runtime = resolveRuntime(container, ctx)
  const { visible, counts } = await loadCategorySnapshot(runtime)
  const row = Array.from(visible.values()).find((candidate) => candidate.slug === slug)
  if (!row) return null
  const ancestors = row.ancestorIds.flatMap((id) => {
    const ancestor = visible.get(id)
    return ancestor ? [ancestor] : []
  })
  const children = Array.from(visible.values()).filter(
    (candidate) => candidate.parentId === row.id && (counts.get(candidate.id) ?? 0) > 0,
  )
  const translations = (
    await loadStorefrontTranslations(runtime.em, ctx, [
      {
        entityType: STOREFRONT_CATEGORY_ENTITY_TYPE,
        ids: [row.id, ...ancestors.map((ancestor) => ancestor.id), ...children.map((child) => child.id)],
      },
    ])
  ).get(STOREFRONT_CATEGORY_ENTITY_TYPE)
  const locales = localeChain(ctx)
  return {
    category: {
      id: row.id,
      name: localizedName(row, translations, locales),
      slug: row.slug,
      description: localizedDescription(row, translations, locales),
      depth: row.depth,
      parentId: row.parentId,
      ancestorIds: ancestors.map((ancestor) => ancestor.id),
      breadcrumb: [...ancestors, row].map((entry) => ({
        id: entry.id,
        name: localizedName(entry, translations, locales),
        slug: entry.slug,
      })),
      children: children
        .map((child) => ({
          id: child.id,
          name: localizedName(child, translations, locales),
          slug: child.slug,
          productCount: counts.get(child.id) ?? 0,
        }))
        .sort(compareNodes),
      productCount: counts.get(row.id) ?? 0,
      seo: { title: null, description: null, canonicalUrl: null },
    },
    effectiveLocale: ctx.effectiveLocale,
  }
}
