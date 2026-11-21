import { sql, type RawBuilder } from 'kysely'

const CUSTOMER_PROFILE_ENTITY_TYPES = new Set([
  'customers:customer_person_profile',
  'customers:customer_company_profile',
])

export function isCustomerProfileEntityType(entityType: string): boolean {
  return CUSTOMER_PROFILE_ENTITY_TYPES.has(entityType)
}

export function customerProfileParentActive(profileTable: string): RawBuilder<boolean> {
  return sql<boolean>`exists (select 1 from ${sql.table('customer_entities')} as ${sql.id('parent_entity')} where ${sql.ref('parent_entity.id')} = ${sql.ref(`${profileTable}.entity_id`)} and ${sql.ref('parent_entity.deleted_at')} is null)`
}
