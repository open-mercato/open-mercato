/**
 * Real-PostgreSQL race harness for the two `wms.inventory.release` findings
 * from the #10896 review:
 *  - a trim that releases only the excess off a reservation is serialized by
 *    the same pessimistic lock a full release takes, so a second trim
 *    attempt racing the first with a now-stale demand figure is rejected
 *    instead of over-releasing or double-counting;
 *  - a release that asks to reject on allocation is serialized against a
 *    concurrent allocate on the same reservation, so a picker who allocates
 *    the reservation first is never silently released out from under.
 *
 * OM_PG_INTEGRATION=1 provisions a disposable PostgreSQL container in the
 * core CI job. Ordinary unit runs skip this suite. For a manual run, supply
 * an empty throwaway loopback database named with a race/test segment via
 * OM_WMS_RACE_DATABASE_URL:
 *
 *   docker run -d --rm --name om-wms-race -e POSTGRES_PASSWORD=race -e POSTGRES_USER=race \
 *     -e POSTGRES_DB=race -p 55474:5432 postgres:16-alpine
 *   OM_WMS_RACE_DATABASE_URL=postgres://race:race@127.0.0.1:55474/race \
 *     yarn workspace @open-mercato/core jest inventory-actions.release-trim-race.pg
 */
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy'
import { MikroORM, type EntityManager } from '@mikro-orm/postgresql'
import type { StartedTestContainer } from 'testcontainers'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { InventoryBalance, InventoryReservation, Warehouse, WarehouseLocation } from '../../data/entities'

jest.mock('../../events', () => ({ emitWmsEvent: jest.fn(async () => undefined) }))
jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  emitCrudSideEffects: jest.fn(async () => undefined),
}))

const MANUAL_DATABASE_URL = process.env.OM_WMS_RACE_DATABASE_URL ?? ''
const ROUNDS = Number(process.env.OM_WMS_RACE_ROUNDS ?? '20')
const TENANT_ID = '00000000-0000-4000-8000-0000000000bb'
const ORG_ID = '00000000-0000-4000-8000-0000000000cc'

const describeWithDatabase = process.env.OM_PG_INTEGRATION === '1' || MANUAL_DATABASE_URL ? describe : describe.skip

let orm: MikroORM
let postgres: StartedTestContainer | undefined

function validateManualDatabaseUrl(value: string): string {
  const url = new URL(value)
  const database = url.pathname.slice(1)
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol)
    || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || url.search
    || !/^[a-z][a-z0-9_-]*$/i.test(database)
    || !/(?:^|[_-])(?:race|test)(?:[_-]|$)/i.test(database)
  ) {
    throw new Error('[internal] race database must be an empty throwaway loopback PostgreSQL database with a race/test name and no URL query')
  }
  return value
}

function createCtx(em: EntityManager): CommandRuntimeContext {
  return {
    container: {
      resolve: <T,>(name: string): T => {
        if (name === 'em') return em as unknown as T
        if (name === 'dataEngine') return {} as T
        throw new Error(`[internal] unexpected resolve ${name}`)
      },
    },
    auth: null,
    organizationScope: null,
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
  } as unknown as CommandRuntimeContext
}

async function release(input: Record<string, unknown>) {
  const handler = commandRegistry.get('wms.inventory.release')!
  return handler.execute!({ organizationId: ORG_ID, tenantId: TENANT_ID, ...input }, createCtx(orm.em))
}

async function allocate(input: Record<string, unknown>) {
  const handler = commandRegistry.get('wms.inventory.allocate')!
  return handler.execute!({ organizationId: ORG_ID, tenantId: TENANT_ID, ...input }, createCtx(orm.em))
}

async function seedWarehouseAndLocation() {
  const em = orm.em.fork()
  const warehouse = em.create(Warehouse, {
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    name: 'Race warehouse',
    code: `RACE-WH-${randomUUID()}`,
  })
  const location = em.create(WarehouseLocation, {
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    warehouse,
    code: `RACE-BIN-${randomUUID()}`,
    type: 'bin',
  })
  await em.persist([warehouse, location]).flush()
  return { warehouseId: warehouse.id, locationId: location.id }
}

async function seedReservation(warehouseId: string, locationId: string, quantity: number) {
  const em = orm.em.fork()
  const catalogVariantId = randomUUID()
  const balance = em.create(InventoryBalance, {
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    warehouse: em.getReference(Warehouse, warehouseId),
    location: em.getReference(WarehouseLocation, locationId),
    catalogVariantId,
    quantityOnHand: String(quantity),
    quantityReserved: String(quantity),
    quantityAllocated: '0',
  })
  await em.persist(balance).flush()
  const reservation = em.create(InventoryReservation, {
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    warehouse: em.getReference(Warehouse, warehouseId),
    catalogVariantId,
    quantity: String(quantity),
    sourceType: 'order',
    sourceId: randomUUID(),
    status: 'active',
    metadata: {
      allocatedBuckets: [
        { balanceId: balance.id, locationId, lotId: null, serialNumber: null, quantity },
      ],
      allocationState: 'reserved',
    },
  })
  await em.persist(reservation).flush()
  return { reservationId: reservation.id, balanceId: balance.id }
}

async function readBalance(balanceId: string): Promise<InventoryBalance> {
  return orm.em.fork().findOneOrFail(InventoryBalance, { id: balanceId })
}

async function readReservation(reservationId: string): Promise<InventoryReservation> {
  return orm.em.fork().findOneOrFail(InventoryReservation, { id: reservationId })
}

describeWithDatabase('wms.inventory.release vs trim/allocate contenders (real Postgres)', () => {
  beforeAll(async () => {
    let clientUrl: string
    if (MANUAL_DATABASE_URL) {
      clientUrl = validateManualDatabaseUrl(MANUAL_DATABASE_URL)
    } else {
      const { GenericContainer, Wait } = await import('testcontainers')
      postgres = await new GenericContainer('postgres:16-alpine')
        .withEnvironment({ POSTGRES_DB: 'race', POSTGRES_USER: 'race', POSTGRES_PASSWORD: 'race' })
        .withExposedPorts(5432)
        .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
        .withStartupTimeout(60_000)
        .start()
      clientUrl = `postgresql://race:race@${postgres.getHost()}:${postgres.getMappedPort(5432)}/race`
    }
    orm = await MikroORM.init({
      clientUrl,
      entities: [Warehouse, WarehouseLocation, InventoryBalance, InventoryReservation],
      metadataProvider: ReflectMetadataProvider,
      allowGlobalContext: true,
      debug: false,
      pool: { min: 0, max: 10 },
    })
    await orm.schema.create()
    await import('../inventory-actions')
  }, 120_000)

  afterAll(async () => {
    try {
      await orm?.close(true)
    } finally {
      await postgres?.stop({ timeout: 10_000 })
    }
  }, 30_000)

  it('serializes two concurrent trims so the second, racing on a now-stale excess, is rejected instead of over-releasing', async () => {
    const { warehouseId, locationId } = await seedWarehouseAndLocation()
    const { reservationId, balanceId } = await seedReservation(warehouseId, locationId, 10)

    const results = await Promise.allSettled([
      release({ reservationId, reason: 'sales.order.lines_changed', quantity: 6, rejectIfAllocated: true }),
      release({ reservationId, reason: 'sales.order.lines_changed', quantity: 6, rejectIfAllocated: true }),
    ])

    // Both contenders read the same 10-unit reservation and independently
    // compute a 6-unit excess. Whichever acquires the lock first succeeds
    // (10 -> 4); by the time the second acquires it, the reservation only
    // holds 4, so its stale 6-unit request is rejected rather than driving
    // the balance negative or double-releasing the same stock.
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const rejection = results.find((result) => result.status === 'rejected') as PromiseRejectedResult
    expect(rejection.reason).toMatchObject({ status: 422, body: { error: 'invalid_release_quantity' } })

    const reservation = await readReservation(reservationId)
    const balance = await readBalance(balanceId)
    expect(reservation.status).toBe('active')
    expect(Number(reservation.quantity)).toBe(4)
    expect(Number(balance.quantityReserved)).toBe(4)
    expect(Number(balance.quantityAllocated)).toBe(0)
  })

  it('serializes a trim release against a concurrent allocate so a picker who allocates first is never released out from under', async () => {
    const outcomes: Array<'allocate-won' | 'trim-won'> = []
    const jitter = () => new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 8)))

    for (let round = 0; round < ROUNDS; round += 1) {
      const { warehouseId, locationId } = await seedWarehouseAndLocation()
      const { reservationId, balanceId } = await seedReservation(warehouseId, locationId, 10)

      const [allocateResult, releaseResult] = await Promise.allSettled([
        jitter().then(() => allocate({ reservationId })),
        jitter().then(() => release({ reservationId, reason: 'sales.order.lines_changed', quantity: 4, rejectIfAllocated: true })),
      ])

      const reservation = await readReservation(reservationId)
      const balance = await readBalance(balanceId)

      // Allocate succeeds whichever reservation quantity it lands on (the
      // full 10 if it wins the lock first, or the trimmed 6 if the release
      // committed first), so the release's own outcome is the only reliable
      // signal for who actually got there first.
      if (releaseResult.status === 'rejected') {
        outcomes.push('allocate-won')
        // The picker allocated the full 10 units first. The trim's release
        // must have found the reservation allocated under its own lock and
        // backed off completely rather than decrementing picked stock.
        expect(releaseResult.reason).toMatchObject({
          status: 409,
          body: { error: 'invalid_reservation_state' },
        })
        expect(allocateResult.status).toBe('fulfilled')
        expect(reservation.metadata).toMatchObject({ allocationState: 'allocated' })
        expect(Number(reservation.quantity)).toBe(10)
        expect(Number(balance.quantityAllocated)).toBe(10)
        expect(Number(balance.quantityReserved)).toBe(0)
      } else {
        outcomes.push('trim-won')
        // The trim released its 4-unit excess off the still-reserved stock
        // before the picker's allocate call landed; the picker then
        // legitimately allocated what remained.
        expect(allocateResult.status).toBe('fulfilled')
        expect(Number(reservation.quantity)).toBe(6)
        expect(Number(balance.quantityReserved)).toBe(0)
        expect(Number(balance.quantityAllocated)).toBe(6)
      }
    }

    // Every round above re-asserts the invariant for whichever side won;
    // this just surfaces the split for a human checking the test wasn't
    // accidentally exercising only one branch.
    process.stdout.write(`RACE_OUTCOMES ${JSON.stringify(
      outcomes.reduce<Record<string, number>>((acc, outcome) => {
        acc[outcome] = (acc[outcome] ?? 0) + 1
        return acc
      }, {}),
    )}\n`)
  }, 60_000)
})
