import type { Knex } from 'knex'

type PurgeUnprocessedOptions = {
  entityType: string
  tenantId: string | null
  partitionIndex: number | null
  partitionCount: number | null
  startedAt: Date
}

export async function purgeUnprocessedPartitionIndexes(
  knex: Knex,
  options: PurgeUnprocessedOptions,
): Promise<void> {
  const { entityType, tenantId, partitionIndex, partitionCount, startedAt } = options
  await knex('entity_indexes')
    .where('entity_type', entityType)
    .modify((qb) => {
      qb.andWhereRaw('tenant_id is not distinct from ?', [tenantId ?? null])
      qb.andWhereRaw('organization_id is null')
      if (partitionIndex != null && partitionCount != null) {
        qb.andWhereRaw('mod(abs(hashtext(entity_id::text)), ?) = ?', [partitionCount, partitionIndex])
      }
    })
    .andWhere('updated_at', '<', startedAt)
    .del()
}
