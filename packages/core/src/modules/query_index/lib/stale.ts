import type { Knex } from 'knex'

type PurgeOrphansOptions = {
  entityType: string
  tenantId?: string | null
  organizationId?: string | null
  partitionIndex: number | null
  partitionCount: number | null
  startedAt: Date
}

export async function purgeOrphans(
  knex: Knex,
  options: PurgeOrphansOptions,
): Promise<void> {
  const { entityType, tenantId, partitionIndex, partitionCount, startedAt } = options
  await knex('entity_indexes')
    .where('entity_type', entityType)
    .modify((qb) => {
      if (tenantId !== undefined) {
        qb.andWhereRaw('tenant_id is not distinct from ?', [tenantId ?? null])
      }
      if (options.organizationId !== undefined) {
        qb.andWhereRaw('organization_id is not distinct from ?', [options.organizationId ?? null])
      }
      if (partitionIndex != null && partitionCount != null) {
        qb.andWhereRaw('mod(abs(hashtext(entity_id::text)), ?) = ?', [partitionCount, partitionIndex])
      }
    })
    .andWhere('updated_at', '<', startedAt)
    .del()
}
