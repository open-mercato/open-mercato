import { EntitySchema, MikroORM } from '@mikro-orm/core'
import { PostgreSqlDriver } from '@mikro-orm/postgresql'
import { buildInteractionOccurredAtOrderBy } from '../interactionOrderBy'

const customerInteractionSchema = new EntitySchema({
  name: 'CustomerInteraction',
  tableName: 'customer_interactions',
  properties: {
    id: { type: 'string', primary: true },
    occurredAt: { type: 'Date', fieldName: 'occurred_at', nullable: true },
    createdAt: { type: 'Date', fieldName: 'created_at' },
  },
})

describe('buildInteractionOccurredAtOrderBy', () => {
  it.each(['asc', 'desc'] as const)('generates a stable nulls-last SQL order (%s)', async (sortDir) => {
    const orm = await MikroORM.init({
      driver: PostgreSqlDriver,
      dbName: 'test',
      entities: [customerInteractionSchema],
      connect: false,
    })

    try {
      const query = orm.em
        .createQueryBuilder('CustomerInteraction')
        .select('*')
        .orderBy(buildInteractionOccurredAtOrderBy(sortDir))
        .getQuery()

      expect(query).toContain(
        `order by occurred_at ${sortDir} nulls last, "c0"."created_at" ${sortDir}, "c0"."id" ${sortDir}`,
      )
    } finally {
      await orm.close(true)
    }
  })
})
