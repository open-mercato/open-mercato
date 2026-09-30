import type { EntityManager } from '@mikro-orm/postgresql'
import type { SubjectScope } from '../scope.js'
import type { AudienceOptionSource } from './field-catalog.js'

/**
 * The option lists behind the audience editor's dropdowns.
 *
 * Every one of these is a fact about THIS shop — its tags, its categories, its sales channels, the loyalty
 * tiers somebody configured. A hardcoded list would be wrong for every tenant but the one it was written
 * for, and an empty dropdown reads to an author as "we have no segments" rather than "this screen never
 * asked".
 *
 * Read shop-wide rather than per-customer, unlike the near-identical queries in `subject-document.ts`: the
 * question there is "what has this person bought", and the question here is "what could anybody pick".
 */
export type AudienceOption = { value: string; label: string }

/**
 * Capped, and the cap is the point.
 *
 * A dropdown of ten thousand categories is not a dropdown. Where a shop exceeds the cap the list is a
 * starting point rather than a promise, which is why the response says how many were returned and the
 * screen offers a free-text escape for anything not listed.
 */
const MAX_OPTIONS = 500

export type AudienceFieldOptions = Partial<Record<AudienceOptionSource, AudienceOption[]>>

async function slugs(em: EntityManager, sql: string, params: unknown[]): Promise<AudienceOption[]> {
  const rows = await em.getConnection().execute<Array<{ value: string | null; label: string | null }>>(sql, params)
  return rows
    .filter((row): row is { value: string; label: string | null } => !!row.value)
    .map((row) => ({ value: row.value, label: row.label || row.value }))
}

/** Column names checked against the live schema: `customer_tags` names its display column `label`, and has no `deleted_at`. */
export async function loadTagOptions(em: EntityManager, scope: SubjectScope): Promise<AudienceOption[]> {
  return slugs(
    em,
    `select slug as value, label as label
       from customer_tags
      where tenant_id = ? and organization_id = ?
      order by label
      limit ?`,
    [scope.tenantId, scope.organizationId, MAX_OPTIONS],
  )
}

/**
 * Inactive categories and channels are OFFERED, deliberately.
 *
 * An audience asks what somebody has bought, which is history: a category that was retired last month is
 * still the right way to reach the people who bought from it. Filtering on `is_active` would quietly make
 * those customers unreachable.
 */
export async function loadCategoryOptions(em: EntityManager, scope: SubjectScope): Promise<AudienceOption[]> {
  return slugs(
    em,
    `select slug as value, name as label
       from catalog_product_categories
      where tenant_id = ? and organization_id = ? and deleted_at is null and slug is not null
      order by name
      limit ?`,
    [scope.tenantId, scope.organizationId, MAX_OPTIONS],
  )
}

export async function loadChannelOptions(em: EntityManager, scope: SubjectScope): Promise<AudienceOption[]> {
  return slugs(
    em,
    `select code as value, name as label
       from sales_channels
      where tenant_id = ? and organization_id = ? and deleted_at is null and code is not null
      order by name
      limit ?`,
    [scope.tenantId, scope.organizationId, MAX_OPTIONS],
  )
}
