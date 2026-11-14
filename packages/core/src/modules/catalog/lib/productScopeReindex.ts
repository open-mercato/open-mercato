import type { EntityManager } from '@mikro-orm/postgresql'
import { sql, type Kysely } from 'kysely'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { PRODUCT_SCOPE_KEYS_ENTITY_TYPE, readJsonIdList } from './productScopeKeys'

const logger = createLogger('catalog').child({ component: 'product-scope-reindex' })

/**
 * Above this many affected products a category hierarchy change requests one scoped
 * `query_index.reindex` job for `catalog:catalog_product` instead of per-record upserts.
 */
export const PRODUCT_SCOPE_REINDEX_UPSERT_LIMIT = 500

export type CategoryScopeChangePayload = {
  id?: unknown
  tenantId?: unknown
  organizationId?: unknown
  hierarchyChanged?: unknown
  previousDescendantIds?: unknown
}

export type ProductScopeReindexContext = {
  resolve: <T = unknown>(name: string) => T
}

type EventBusLike = {
  emitEvent: (event: string, payload: unknown, options?: Record<string, unknown>) => Promise<void>
}

type CategoryScopeTarget = {
  categoryId: string
  tenantId: string
  organizationId: string
  extraCategoryIds: string[]
}

export type ProductScopeReindexResult =
  | { mode: 'skipped'; productCount: 0 }
  | { mode: 'upsert'; productCount: number }
  | { mode: 'reindex'; productCount: number }

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function parseCategoryScopeTarget(payload: CategoryScopeChangePayload | null | undefined): CategoryScopeTarget | null {
  const categoryId = readNonEmptyString(payload?.id)
  const tenantId = readNonEmptyString(payload?.tenantId)
  const organizationId = readNonEmptyString(payload?.organizationId)
  if (!categoryId || !tenantId || !organizationId) return null
  return {
    categoryId,
    tenantId,
    organizationId,
    extraCategoryIds: readJsonIdList(payload?.previousDescendantIds),
  }
}

export async function collectCategorySubtreeProductIds(
  db: Kysely<any>,
  target: CategoryScopeTarget,
  limit: number,
): Promise<string[]> {
  const category = (await db
    .selectFrom('catalog_product_categories')
    .select(['id', 'descendant_ids'])
    .where('id', '=', target.categoryId)
    .where('tenant_id', '=', target.tenantId)
    .where('organization_id', '=', target.organizationId)
    .executeTakeFirst()) as { id: string; descendant_ids: unknown } | undefined

  const categoryIds = Array.from(new Set([
    target.categoryId,
    ...readJsonIdList(category?.descendant_ids),
    ...target.extraCategoryIds,
  ]))

  const rows = (await db
    .selectFrom('catalog_product_category_assignments as a')
    .innerJoin('catalog_products as p', 'p.id', 'a.product_id')
    .select('a.product_id as product_id')
    .distinct()
    .where('a.category_id', 'in', categoryIds)
    .where('a.tenant_id', '=', target.tenantId)
    .where('a.organization_id', '=', target.organizationId)
    .where(sql<boolean>`${sql.ref('p.deleted_at')} is null`)
    .limit(limit + 1)
    .execute()) as Array<{ product_id: string }>

  return rows.map((row) => String(row.product_id))
}

/**
 * Re-projects `scope_keys` for every product assigned anywhere in a category's subtree
 * (Storefront Public API §3.3, R16). Runs from persistent `catalog.category.*` subscribers,
 * i.e. in the events worker, never in the request that changed the hierarchy.
 */
export async function reindexProductsForCategorySubtree(
  payload: CategoryScopeChangePayload | null | undefined,
  ctx: ProductScopeReindexContext,
  limit: number = PRODUCT_SCOPE_REINDEX_UPSERT_LIMIT,
): Promise<ProductScopeReindexResult> {
  const target = parseCategoryScopeTarget(payload)
  if (!target) {
    logger.warn('Category scope change without id/tenant/organization; product scope keys not refreshed', {
      categoryId: readNonEmptyString(payload?.id),
    })
    return { mode: 'skipped', productCount: 0 }
  }
  const em = ctx.resolve<EntityManager>('em')
  const db = em.getKysely() as Kysely<any>
  const bus = ctx.resolve<EventBusLike>('eventBus')
  const productIds = await collectCategorySubtreeProductIds(db, target, limit)
  if (!productIds.length) return { mode: 'skipped', productCount: 0 }

  if (productIds.length > limit) {
    await bus.emitEvent(
      'query_index.reindex',
      {
        entityType: PRODUCT_SCOPE_KEYS_ENTITY_TYPE,
        tenantId: target.tenantId,
        organizationId: target.organizationId,
      },
      { persistent: true, deliverInline: false },
    )
    return { mode: 'reindex', productCount: productIds.length }
  }

  for (const productId of productIds) {
    await bus.emitEvent('query_index.upsert_one', {
      entityType: PRODUCT_SCOPE_KEYS_ENTITY_TYPE,
      recordId: productId,
      tenantId: target.tenantId,
      organizationId: target.organizationId,
      crudAction: 'updated',
    })
  }
  return { mode: 'upsert', productCount: productIds.length }
}
