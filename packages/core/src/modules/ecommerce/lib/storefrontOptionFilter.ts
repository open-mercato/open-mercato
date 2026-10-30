import { sql } from 'kysely'
import type { EntityManager } from '@mikro-orm/postgresql'

type OptionFilterDatabase = {
  catalog_product_variants: {
    product_id: string
    tenant_id: string
    organization_id: string
    is_active: boolean
    deleted_at: Date | null
    option_values: unknown
  }
}

export type StorefrontOptionFilterScope = { tenantId: string; organizationId: string }

/**
 * The ids of the products with an active variant matching every `options[code]` value list, or
 * `null` when more than `cap` products match. One query that reads at most `cap + 1` product ids —
 * no variant is loaded or decrypted — so a broad option filter on the public listing stays bounded.
 */
export async function queryStorefrontOptionProductIds(
  em: EntityManager,
  scope: StorefrontOptionFilterScope,
  options: Record<string, string[]>,
  cap: number,
): Promise<string[] | null> {
  const limit = Math.max(1, cap)
  let query = em
    .getKysely<OptionFilterDatabase>()
    .selectFrom('catalog_product_variants as v')
    .select('v.product_id as product_id')
    .distinct()
    .where('v.tenant_id', '=', scope.tenantId)
    .where('v.organization_id', '=', scope.organizationId)
    .where('v.is_active', '=', true)
    .where('v.deleted_at', 'is', null)
  for (const [code, values] of Object.entries(options)) {
    query = query.where(sql<boolean>`${sql.ref('v.option_values')} ->> ${code} = any(${values}::text[])`)
  }
  const rows = await query.limit(limit + 1).execute()
  if (rows.length > limit) return null
  return rows.map((row) => row.product_id)
}
