import type { Knex } from 'knex'

type PurgeStaleOptions = {
  entityType: string
  table: string
  tenantId: string | null
  partitionIndex: number
  partitionCount: number
}

export async function purgeStalePartitionIndexes(
  knex: Knex,
  options: PurgeStaleOptions,
): Promise<void> {
  const { entityType, table, tenantId, partitionIndex, partitionCount } = options

  await knex('entity_indexes as ei')
    .leftJoin({ b: table }, function join() {
      this.on('ei.entity_id', knex.raw('b.id::text'))
      if (tenantId !== null) {
        this.andOn(knex.raw('b.tenant_id is not distinct from ?', [tenantId]))
      }
    })
    .where('ei.entity_type', entityType)
    .modify((qb) => {
      qb.andWhereRaw('mod(abs(hashtext(ei.entity_id::text)), ?) = ?', [partitionCount, partitionIndex])
      qb.andWhereRaw('ei.tenant_id is not distinct from ?', [tenantId ?? null])
      qb.andWhereRaw('ei.organization_id is null')
    })
    .whereNull('b.id')
    .del()
}

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
