/** @jest-environment node */
import { randomUUID } from 'node:crypto'
import { MikroORM } from '@mikro-orm/core'
import { PostgreSqlDriver, type EntityManager } from '@mikro-orm/postgresql'
import type { StartedTestContainer } from 'testcontainers'
import { CustomerGroup, CustomerGroupMembership } from '../../../data/entities'
import { countGroupMembershipsOutsideScope } from '../../../lib/customerScope'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string, fallback?: string) => fallback ?? key }),
}))

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip
const database = 'customer_groups_scope_test'

describeWithPostgres('customer group membership scope on PostgreSQL', () => {
  let postgres: StartedTestContainer | undefined
  let orm: MikroORM<PostgreSqlDriver, EntityManager>

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers')
    postgres = await new GenericContainer('postgres:16')
      .withEnvironment({ POSTGRES_DB: database, POSTGRES_USER: database, POSTGRES_PASSWORD: database })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start()
    orm = await MikroORM.init({
      driver: PostgreSqlDriver,
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      dbName: database,
      user: database,
      password: database,
      entities: [CustomerGroup, CustomerGroupMembership],
    })
    await orm.schema.create()
    await orm.em.fork().execute(
      'create table customer_entities (id uuid primary key, tenant_id uuid, organization_id uuid, deleted_at timestamptz)',
    )
  })

  afterAll(async () => {
    try {
      await orm?.close(true)
    } finally {
      await postgres?.stop()
    }
  })

  async function createGroup(em: EntityManager, tenantId = randomUUID()) {
    const group = em.create(CustomerGroup, { tenantId, code: randomUUID(), name: 'Group', kind: 'b2b', priority: 0 })
    await em.flush()
    return group
  }

  it('holds the target group lock through the membership write transaction', async () => {
    const writer = orm.em.fork()
    const observer = orm.em.fork()
    const group = await createGroup(writer)

    await writer.transactional(async (transaction) => {
      transaction.create(CustomerGroupMembership, {
        tenantId: group.tenantId, groupId: group.id, customerId: randomUUID(),
      })
      await transaction.flush()

      await expect(observer.execute(
        'select id from customer_groups where id = ? for update nowait', [group.id],
      )).rejects.toMatchObject({ code: '55P03' })
    })

    await expect(observer.count(CustomerGroupMembership, { tenantId: group.tenantId, groupId: group.id })).resolves.toBe(1)
  })

  it('requires a live target group when reassigning a membership', async () => {
    const writer = orm.em.fork()
    const group = await createGroup(writer)
    const retiredGroup = writer.create(CustomerGroup, {
      tenantId: group.tenantId, code: 'retired', name: 'Retired group', kind: 'b2b', priority: 10, deletedAt: new Date(),
    })
    const membership = writer.create(CustomerGroupMembership, {
      tenantId: group.tenantId, groupId: group.id, customerId: randomUUID(),
    })
    await writer.flush()

    membership.groupId = retiredGroup.id
    await expect(writer.flush()).rejects.toMatchObject({ status: 400 })
    await expect(orm.em.fork().count(CustomerGroupMembership, { id: membership.id, groupId: group.id })).resolves.toBe(1)
  })

  it('excludes hard-deleted customer references while counting existing customers outside scope', async () => {
    const writer = orm.em.fork()
    const group = await createGroup(writer)
    const authorizedOrg = randomUUID()
    const authorizedCustomer = randomUUID()
    const otherCustomer = randomUUID()
    await writer.execute(
      'insert into customer_entities values (?, ?, ?, now()), (?, ?, ?, null)',
      [authorizedCustomer, group.tenantId, authorizedOrg, otherCustomer, group.tenantId, randomUUID()],
    )
    for (const customerId of [authorizedCustomer, otherCustomer, randomUUID()]) {
      writer.create(CustomerGroupMembership, { tenantId: group.tenantId, groupId: group.id, customerId })
    }
    await writer.flush()

    await expect(countGroupMembershipsOutsideScope(writer, group.id, {
      tenantId: group.tenantId, organizationIds: [authorizedOrg],
    })).resolves.toBe(1)
    await expect(countGroupMembershipsOutsideScope(writer, group.id, {
      tenantId: group.tenantId, organizationIds: [],
    })).resolves.toBe(2)
  })
})
