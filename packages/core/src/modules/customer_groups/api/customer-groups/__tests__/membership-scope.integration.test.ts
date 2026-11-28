/** @jest-environment node */
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { MikroORM } from '@mikro-orm/core'
import { PostgreSqlDriver, type EntityManager } from '@mikro-orm/postgresql'
import type { StartedTestContainer } from 'testcontainers'
import { CustomerGroup, CustomerGroupMembership, CustomerGroupTerms, bindAuthorizedMembershipUpdate } from '../../../data/entities'
import { countGroupMembershipsOutsideScope } from '../../../lib/customerScope'
import { lockCustomerGroup } from '../../../lib/groupLock'
import { cascadeGroupDelete } from '../crud'

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
      entities: [CustomerGroup, CustomerGroupMembership, CustomerGroupTerms],
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

  it('refuses a reassignment waiting for a concurrent source-group removal', async () => {
    const writer = orm.em.fork()
    const group = await createGroup(writer)
    const destination = writer.create(CustomerGroup, {
      tenantId: group.tenantId, code: randomUUID(), name: 'Destination', kind: 'b2b', priority: 10,
    })
    const membership = writer.create(CustomerGroupMembership, {
      tenantId: group.tenantId, groupId: group.id, customerId: randomUUID(),
    })
    await writer.flush()

    const updater = orm.em.fork()
    const current = await updater.findOneOrFail(CustomerGroupMembership, { id: membership.id })
    const deleter = orm.em.fork()
    const observer = orm.em.fork()
    await deleter.begin()
    let result: Promise<PromiseSettledResult<void>[]> | undefined
    let waiting = false
    try {
      await lockCustomerGroup(deleter, group.tenantId, group.id)
      const deletedAt = new Date()
      await deleter.nativeUpdate(CustomerGroup, { id: group.id, tenantId: group.tenantId }, { deletedAt })
      await deleter.nativeUpdate(CustomerGroupMembership, { id: membership.id, tenantId: group.tenantId }, { deletedAt })
      current.groupId = destination.id
      result = Promise.allSettled([updater.flush()])

      const deadline = Date.now() + 5000
      while (!waiting && Date.now() < deadline) {
        const [row] = await observer.execute<Array<{ waiting: boolean }>>(
          "select exists (select 1 from pg_locks where not granted) as waiting",
        )
        waiting = row.waiting
        if (!waiting) await delay(25)
      }
      await deleter.commit()
    } finally {
      if (deleter.isInTransaction()) await deleter.rollback()
    }

    expect(waiting).toBe(true)
    expect(await result).toEqual([expect.objectContaining({
      status: 'rejected',
      reason: expect.objectContaining({ status: 400 }),
    })])
    const persisted = await observer.findOneOrFail(CustomerGroupMembership, { id: membership.id })
    expect(persisted.groupId).toBe(group.id)
    expect(persisted.deletedAt).toBeInstanceOf(Date)
  }, 30_000)

  it('rechecks the authorized customer after acquiring the source lock for a field-only update', async () => {
    const writer = orm.em.fork()
    const group = await createGroup(writer)
    const sourceOrganizationId = randomUUID()
    const sourceCustomerId = randomUUID()
    const otherOrganizationId = randomUUID()
    const otherCustomerId = randomUUID()
    await writer.execute(
      'insert into customer_entities values (?, ?, ?, null), (?, ?, ?, null)',
      [sourceCustomerId, group.tenantId, sourceOrganizationId, otherCustomerId, group.tenantId, otherOrganizationId],
    )
    const membership = writer.create(CustomerGroupMembership, {
      tenantId: group.tenantId, organizationId: sourceOrganizationId, groupId: group.id, customerId: sourceCustomerId,
    })
    await writer.flush()

    const updater = orm.em.fork()
    const current = await updater.findOneOrFail(CustomerGroupMembership, { id: membership.id })
    await bindAuthorizedMembershipUpdate(current, {
      id: membership.id, groupId: group.id, customerId: sourceCustomerId,
    })

    const mover = orm.em.fork()
    await mover.transactional(async (transaction) => {
      await lockCustomerGroup(transaction, group.tenantId, group.id)
      await transaction.nativeUpdate(CustomerGroupMembership, { id: membership.id, tenantId: group.tenantId }, {
        customerId: otherCustomerId, organizationId: otherOrganizationId,
      })
    })

    current.notes = 'Updated note'
    await expect(updater.flush()).rejects.toMatchObject({ status: 404 })
    const persisted = await orm.em.fork().findOneOrFail(CustomerGroupMembership, { id: membership.id })
    expect(persisted).toMatchObject({ customerId: otherCustomerId, organizationId: otherOrganizationId, notes: null })
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

  it('locks a retired group during scoped cascade cleanup of an orphan membership', async () => {
    const writer = orm.em.fork()
    const observer = orm.em.fork()
    const group = await createGroup(writer)
    const membership = writer.create(CustomerGroupMembership, {
      tenantId: group.tenantId, groupId: group.id, customerId: randomUUID(),
    })
    await writer.flush()
    group.deletedAt = new Date()
    await writer.flush()

    const removed = await cascadeGroupDelete(writer, group.tenantId, group.id, async (transaction) => {
      await expect(countGroupMembershipsOutsideScope(transaction, group.id, {
        tenantId: group.tenantId, organizationIds: [randomUUID()],
      })).resolves.toBe(0)
      await expect(observer.execute(
        'select id from customer_groups where id = ? for update nowait', [group.id],
      )).rejects.toMatchObject({ code: '55P03' })
    })

    expect(removed.map(({ id }) => id)).toEqual([membership.id])
    await expect(observer.count(CustomerGroupMembership, { id: membership.id, deletedAt: null })).resolves.toBe(0)
  })
})
