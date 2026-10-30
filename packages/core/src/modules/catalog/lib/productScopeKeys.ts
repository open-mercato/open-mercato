import { sql, type Kysely, type RawBuilder } from 'kysely'
import type {
  IndexDocEnricher,
  IndexDocEnricherContext,
  IndexDocEnricherRecord,
  IndexDocEnrichment,
} from '@open-mercato/core/modules/query_index/lib/doc-enrichers'

/**
 * Denormalized assortment keys on the `catalog:catalog_product` index document
 * (Storefront Public API §3.3, decision D9).
 *
 * `scope_keys` is a sorted, de-duplicated jsonb string array:
 * - `cat:<uuid>` for every assigned, non-deleted category AND each of its `ancestor_ids`
 *   (so "a category includes its descendants" is a plain overlap test);
 * - `tag:<uuid>` for every assigned tag.
 *
 * Ids only — never encrypted, never translated. A document whose `scope_keys` is `null`
 * (enricher failure) or absent (not reindexed since the enricher shipped) is NOT indexed:
 * consumers MUST fail closed on it, never read it as "no assignments" — see
 * `isProductScopeIndexed`.
 */
export const PRODUCT_SCOPE_KEYS_ENTITY_TYPE = 'catalog:catalog_product'
export const PRODUCT_SCOPE_KEYS_DOC_KEY = 'scope_keys'
export const PRODUCT_SCOPE_KEYS_ENRICHER_ID = 'catalog.product_scope_keys'
export const PRODUCT_SCOPE_CATEGORY_PREFIX = 'cat:'
export const PRODUCT_SCOPE_TAG_PREFIX = 'tag:'

export function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

export function categoryScopeKey(categoryId: string): string {
  return `${PRODUCT_SCOPE_CATEGORY_PREFIX}${categoryId}`
}

export function tagScopeKey(tagId: string): string {
  return `${PRODUCT_SCOPE_TAG_PREFIX}${tagId}`
}

export type ProductScopeKeyInput = {
  categories: ReadonlyArray<{ categoryId: string; ancestorIds: readonly string[] }>
  tagIds: readonly string[]
}

export function buildProductScopeKeys(input: ProductScopeKeyInput): string[] {
  const keys = new Set<string>()
  for (const category of input.categories) {
    if (category.categoryId) keys.add(categoryScopeKey(category.categoryId))
    for (const ancestorId of category.ancestorIds) {
      if (ancestorId) keys.add(categoryScopeKey(ancestorId))
    }
  }
  for (const tagId of input.tagIds) {
    if (tagId) keys.add(tagScopeKey(tagId))
  }
  return Array.from(keys).sort(compareCodeUnits)
}

export function isProductScopeIndexed(doc: Readonly<Record<string, unknown>> | null | undefined): boolean {
  if (!doc) return false
  const keys = doc[PRODUCT_SCOPE_KEYS_DOC_KEY]
  if (!Array.isArray(keys)) return false
  return keys.every((entry) => typeof entry === 'string')
}

export function readJsonIdList(value: unknown): string[] {
  let parsed: unknown = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      return []
    }
  }
  if (!Array.isArray(parsed)) return []
  return parsed.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
}

type ScopeFilter = { tenantId: string | null; organizationId: string | null }

function scopeEquals(column: string, value: string | null): RawBuilder<boolean> {
  return value === null
    ? sql<boolean>`${sql.ref(column)} is null`
    : sql<boolean>`${sql.ref(column)} = ${value}`
}

type CategoryAssignmentRow = { product_id: string; category_id: string; ancestor_ids: unknown }
type TagAssignmentRow = { product_id: string; tag_id: string }

/**
 * Computes `scope_keys` for a batch of products in two queries (category assignments joined
 * with their categories, then tag assignments). Every requested product gets an entry — a
 * product without assignments maps to `[]`, which is "indexed, no keys", not "unknown".
 */
export async function computeProductScopeKeys(
  db: Kysely<any>,
  productIds: readonly string[],
  scope: ScopeFilter,
): Promise<Map<string, string[]>> {
  const ids = Array.from(new Set(productIds.filter((id) => typeof id === 'string' && id.length > 0)))
  const result = new Map<string, string[]>()
  if (!ids.length) return result

  const categoryRows = (await db
    .selectFrom('catalog_product_category_assignments as a')
    .innerJoin('catalog_product_categories as c', 'c.id', 'a.category_id')
    .select(['a.product_id as product_id', 'a.category_id as category_id', 'c.ancestor_ids as ancestor_ids'])
    .where('a.product_id', 'in', ids)
    .where('c.deleted_at', 'is', null)
    .where(scopeEquals('a.tenant_id', scope.tenantId))
    .where(scopeEquals('a.organization_id', scope.organizationId))
    .where(scopeEquals('c.tenant_id', scope.tenantId))
    .where(scopeEquals('c.organization_id', scope.organizationId))
    .execute()) as CategoryAssignmentRow[]

  const tagRows = (await db
    .selectFrom('catalog_product_tag_assignments as t')
    .select(['t.product_id as product_id', 't.tag_id as tag_id'])
    .where('t.product_id', 'in', ids)
    .where(scopeEquals('t.tenant_id', scope.tenantId))
    .where(scopeEquals('t.organization_id', scope.organizationId))
    .execute()) as TagAssignmentRow[]

  const inputs = new Map<string, { categories: Array<{ categoryId: string; ancestorIds: string[] }>; tagIds: string[] }>()
  for (const id of ids) inputs.set(id, { categories: [], tagIds: [] })
  for (const row of categoryRows) {
    const entry = inputs.get(String(row.product_id))
    if (!entry) continue
    entry.categories.push({ categoryId: String(row.category_id), ancestorIds: readJsonIdList(row.ancestor_ids) })
  }
  for (const row of tagRows) {
    const entry = inputs.get(String(row.product_id))
    if (!entry) continue
    entry.tagIds.push(String(row.tag_id))
  }
  for (const [id, input] of inputs) result.set(id, buildProductScopeKeys(input))
  return result
}

export const catalogProductScopeKeysEnricher: IndexDocEnricher = {
  id: PRODUCT_SCOPE_KEYS_ENRICHER_ID,
  entityType: PRODUCT_SCOPE_KEYS_ENTITY_TYPE,
  keys: [PRODUCT_SCOPE_KEYS_DOC_KEY],
  async enrich(
    records: readonly IndexDocEnricherRecord[],
    ctx: IndexDocEnricherContext,
  ): Promise<Map<string, IndexDocEnrichment>> {
    const keysByProduct = await computeProductScopeKeys(
      ctx.db,
      records.map((record) => record.recordId),
      { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
    )
    const out = new Map<string, IndexDocEnrichment>()
    for (const [productId, keys] of keysByProduct) {
      out.set(productId, { [PRODUCT_SCOPE_KEYS_DOC_KEY]: keys })
    }
    return out
  },
}
