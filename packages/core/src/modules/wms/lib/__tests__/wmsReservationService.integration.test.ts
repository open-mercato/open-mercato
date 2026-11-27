/** @jest-environment node */
import { randomUUID } from 'node:crypto'
import { MikroORM } from '@mikro-orm/core'
import { PostgreSqlDriver, type EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { StartedTestContainer } from 'testcontainers'
import * as wmsEntities from '../../data/entities'
import { InventoryBalance, InventoryReservation, Warehouse, WarehouseLocation } from '../../data/entities'
import { inventoryReservationCreateSchema, inventoryReservationReleaseSchema } from '../../data/validators'
import { WmsReservationService } from '../wmsReservationService'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn((em: { find: (...args: unknown[]) => unknown }, ...args: unknown[]) => em.find(...args.slice(0, 3))),
  findOneWithDecryption: jest.fn((em: { findOne: (...args: unknown[]) => unknown }, ...args: unknown[]) => em.findOne(...args.slice(0, 3))),
}))

jest.mock('../../events', () => ({
  emitWmsEvent: jest.fn(async () => undefined),
}))

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

const DATABASE_NAME = 'wms_reservation_service_test'
const DATABASE_USER = 'wms_reservation_service'
const DATABASE_PASSWORD = 'wms_reservation_service'

type TestOrm = MikroORM<PostgreSqlDriver, EntityManager<PostgreSqlDriver>>

type Fixture = {
  tenantId: string
  organizationId: string
  warehouseId: string
  balanceId: string
  catalogVariantId: string
}

class CallerRollback extends Error {}

const entityClasses = Object.values(wmsEntities).filter(
  (value): value is new (...args: never[]) => object => typeof value === 'function',
)

function buildContext(fixture: Fixture): CommandRuntimeContext {
  return {
    container: {
      resolve: (name: string) => {
        throw new Error(`[internal] unexpected resolve: ${name}`)
      },
    },
    auth: { sub: randomUUID(), tenantId: fixture.tenantId, orgId: fixture.organizationId },
    organizationScope: null,
    selectedOrganizationId: fixture.organizationId,
    organizationIds: [fixture.organizationId],
  } as unknown as CommandRuntimeContext
}

function buildMultiOrganizationContext(fixture: Fixture, organizationIds: string[]): CommandRuntimeContext {
  return {
    ...buildContext(fixture),
    organizationScope: {
      selectedId: fixture.organizationId,
      filterIds: organizationIds,
      allowedIds: organizationIds,
      tenantId: fixture.tenantId,
    },
    organizationIds,
  } as unknown as CommandRuntimeContext
}

// Models an admin with a PARENT org selected (`parentOrganizationId`) acting on
// a reservation that actually lives under the fixture's org, a descendant of
// that selection — `filterIds` carries the descendant-expanded read scope the
// directory module's `resolveOrganizationScope` would have resolved for that
// selection (M1 regression).
function buildParentOrgSelectedContext(fixture: Fixture, parentOrganizationId: string): CommandRuntimeContext {
  return {
    ...buildContext(fixture),
    auth: { sub: randomUUID(), tenantId: fixture.tenantId, orgId: parentOrganizationId },
    organizationScope: {
      selectedId: parentOrganizationId,
      filterIds: [parentOrganizationId, fixture.organizationId],
      allowedIds: [parentOrganizationId, fixture.organizationId],
      tenantId: fixture.tenantId,
    },
    selectedOrganizationId: parentOrganizationId,
    organizationIds: [parentOrganizationId, fixture.organizationId],
  } as unknown as CommandRuntimeContext
}

function buildReserveInput(fixture: Fixture, quantity: number, organizationId = fixture.organizationId) {
  return inventoryReservationCreateSchema.parse({
    tenantId: fixture.tenantId,
    organizationId,
    warehouseId: fixture.warehouseId,
    catalogVariantId: fixture.catalogVariantId,
    quantity,
    sourceType: 'order',
    sourceId: randomUUID(),
  })
}

async function rollbackAfter(orm: TestOrm, work: (trx: EntityManager) => Promise<unknown>): Promise<void> {
  await expect(
    orm.em.fork().transactional(async (trx) => {
      await work(trx as EntityManager)
      throw new CallerRollback('caller rolls back')
    }),
  ).rejects.toBeInstanceOf(CallerRollback)
}

describeWithPostgres('wmsReservationService inside a caller transaction (PostgreSQL)', () => {
  let postgres: StartedTestContainer | undefined
  let orm: TestOrm | undefined
  const service = new WmsReservationService()

  function activeOrm(): TestOrm {
    if (!orm) throw new Error('[internal] PostgreSQL test ORM unavailable')
    return orm
  }

  async function seedFixture(quantityOnHand: string): Promise<Fixture> {
    const em = activeOrm().em.fork()
    const tenantId = randomUUID()
    const organizationId = randomUUID()
    const catalogVariantId = randomUUID()
    const warehouse = em.create(Warehouse, { tenantId, organizationId, name: 'Main', code: `WH-${randomUUID()}` })
    const location = em.create(WarehouseLocation, { tenantId, organizationId, warehouse, code: 'BIN-1', type: 'bin' })
    const balance = em.create(InventoryBalance, {
      tenantId,
      organizationId,
      warehouse,
      location,
      catalogVariantId,
      quantityOnHand,
      quantityReserved: '0',
      quantityAllocated: '0',
    })
    await em.flush()
    return { tenantId, organizationId, warehouseId: warehouse.id, balanceId: balance.id, catalogVariantId }
  }

  async function readState(fixture: Fixture) {
    const em = activeOrm().em.fork()
    const balance = await em.findOneOrFail(InventoryBalance, { id: fixture.balanceId })
    const reservations = await em.find(InventoryReservation, { tenantId: fixture.tenantId })
    return { quantityReserved: Number(balance.quantityReserved), reservations }
  }

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers')
    postgres = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({ POSTGRES_DB: DATABASE_NAME, POSTGRES_USER: DATABASE_USER, POSTGRES_PASSWORD: DATABASE_PASSWORD })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
      .start()
    orm = await MikroORM.init({
      driver: PostgreSqlDriver,
      entities: entityClasses,
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      dbName: DATABASE_NAME,
      user: DATABASE_USER,
      password: DATABASE_PASSWORD,
    }) as TestOrm
    await orm.schema.create()
  }, 120_000)

  afterAll(async () => {
    await orm?.close(true)
    await postgres?.stop()
  }, 30_000)

  it('keeps the reservation and the balance change when the caller transaction commits', async () => {
    const fixture = await seedFixture('10')

    await activeOrm().em.fork().transactional(async (trx) => {
      await service.reserveInTransaction(trx as EntityManager, buildContext(fixture), buildReserveInput(fixture, 4))
    })

    const state = await readState(fixture)
    expect(state.quantityReserved).toBe(4)
    expect(state.reservations).toHaveLength(1)
    expect(state.reservations[0].status).toBe('active')
  })

  it('writes no reservation and no balance change when the caller transaction of a reserve rolls back', async () => {
    const fixture = await seedFixture('10')

    await rollbackAfter(activeOrm(), async (trx) => {
      const result = await service.reserveInTransaction(trx, buildContext(fixture), buildReserveInput(fixture, 4))
      expect(result.idempotentReplay).toBe(false)
    })

    const state = await readState(fixture)
    expect(state.quantityReserved).toBe(0)
    expect(state.reservations).toHaveLength(0)
  })

  it('leaves the reservation active and the balance reserved when the caller transaction of a release rolls back', async () => {
    const fixture = await seedFixture('10')
    const reserved = await service.reserveInTransaction(
      activeOrm().em.fork() as EntityManager,
      buildContext(fixture),
      buildReserveInput(fixture, 6),
    )

    await rollbackAfter(activeOrm(), async (trx) => {
      await service.releaseInTransaction(
        trx,
        buildContext(fixture),
        inventoryReservationReleaseSchema.parse({
          tenantId: fixture.tenantId,
          organizationId: fixture.organizationId,
          reservationId: reserved.reservationId,
          reason: 'caller rollback',
        }),
      )
    })

    const state = await readState(fixture)
    expect(state.quantityReserved).toBe(6)
    expect(state.reservations).toHaveLength(1)
    expect(state.reservations[0].status).toBe('active')
  })

  it('refuses a direct reserve whose input organization does not own the warehouse and writes nothing', async () => {
    const fixture = await seedFixture('10')
    const otherOrganizationId = randomUUID()
    const ctx = buildMultiOrganizationContext(fixture, [fixture.organizationId, otherOrganizationId])

    await expect(
      activeOrm().em.fork().transactional(async (trx) => {
        await service.reserveInTransaction(
          trx as EntityManager,
          ctx,
          buildReserveInput(fixture, 4, otherOrganizationId),
        )
      }),
    ).rejects.toMatchObject({ status: 404 })

    const state = await readState(fixture)
    expect(state.quantityReserved).toBe(0)
    expect(state.reservations).toHaveLength(0)
  })

  it('refuses a direct release whose input organization does not own the reservation and leaves it active', async () => {
    const fixture = await seedFixture('10')
    const otherOrganizationId = randomUUID()
    const reserved = await service.reserveInTransaction(
      activeOrm().em.fork() as EntityManager,
      buildContext(fixture),
      buildReserveInput(fixture, 6),
    )
    const ctx = buildMultiOrganizationContext(fixture, [fixture.organizationId, otherOrganizationId])

    await expect(
      activeOrm().em.fork().transactional(async (trx) => {
        await service.releaseInTransaction(
          trx as EntityManager,
          ctx,
          inventoryReservationReleaseSchema.parse({
            tenantId: fixture.tenantId,
            organizationId: otherOrganizationId,
            reservationId: reserved.reservationId,
            reason: 'cross-organization release',
          }),
        )
      }),
    ).rejects.toMatchObject({ status: 404 })

    const state = await readState(fixture)
    expect(state.quantityReserved).toBe(6)
    expect(state.reservations).toHaveLength(1)
    expect(state.reservations[0].status).toBe('active')
    expect(state.reservations[0].organizationId).toBe(fixture.organizationId)
  })

  it('releases a reservation owned by a descendant org when the actor has the parent org selected', async () => {
    const fixture = await seedFixture('10')
    const parentOrganizationId = randomUUID()
    const reserved = await service.reserveInTransaction(
      activeOrm().em.fork() as EntityManager,
      buildContext(fixture),
      buildReserveInput(fixture, 6),
    )
    const ctx = buildParentOrgSelectedContext(fixture, parentOrganizationId)

    await activeOrm().em.fork().transactional(async (trx) => {
      await service.releaseInTransaction(
        trx as EntityManager,
        ctx,
        inventoryReservationReleaseSchema.parse({
          tenantId: fixture.tenantId,
          organizationId: parentOrganizationId,
          reservationId: reserved.reservationId,
          reason: 'descendant-org release under parent selection',
        }),
      )
    })

    const state = await readState(fixture)
    expect(state.quantityReserved).toBe(0)
    expect(state.reservations).toHaveLength(1)
    expect(state.reservations[0].status).toBe('released')
    expect(state.reservations[0].organizationId).toBe(fixture.organizationId)
  })

  it('refuses a direct reserve for an organization outside the actor scope before any lookup', async () => {
    const fixture = await seedFixture('10')
    const otherOrganizationId = randomUUID()

    await expect(
      service.reserveInTransaction(
        activeOrm().em.fork() as EntityManager,
        buildContext(fixture),
        buildReserveInput(fixture, 4, otherOrganizationId),
      ),
    ).rejects.toMatchObject({ status: 403 })

    const state = await readState(fixture)
    expect(state.quantityReserved).toBe(0)
    expect(state.reservations).toHaveLength(0)
  })
})
