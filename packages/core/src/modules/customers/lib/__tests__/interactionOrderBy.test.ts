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
  it('generates MikroORM-compatible nulls-last SQL ordering', async () => {
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
        .orderBy(buildInteractionOccurredAtOrderBy('desc'))
        .getQuery()

      expect(query).toContain('order by occurred_at desc nulls last')
      expect(query).toContain('"c0"."created_at" desc')
    } finally {
      await orm.close(true)
    }
  })
})
