/** @jest-environment node */
import { createHash } from 'node:crypto'
import { LockMode } from '@mikro-orm/core'
import { MikroORM, PostgreSqlDriver, type EntityManager } from '@mikro-orm/postgresql'
import type { StartedTestContainer } from 'testcontainers'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { UserDevice } from '../data/entities'

const mockCommands = new Map<string, CommandHandler>()
const mockDeleted = jest.fn()
const mockEvent = jest.fn()
jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand: (command: CommandHandler) => mockCommands.set(command.id, command),
}))
jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  emitCrudSideEffects: (...args: unknown[]) => mockDeleted(...args),
  emitCrudUndoSideEffects: jest.fn(),
}))
jest.mock('../events', () => ({ emitDevicesEvent: (...args: unknown[]) => mockEvent(...args) }))

const TENANT = '33333333-3333-4333-8333-333333333333'
const USER = '44444444-4444-4444-8444-444444444444'
const ORG = '22222222-2222-4222-8222-222222222222'
const VERSION = new Date('2026-11-01T00:00:00.000Z')
const TOKEN = 'dead-provider-token-12345678'
const expectedPushToken = { hash: createHash('sha256').update(TOKEN).digest('hex'), updatedAt: VERSION }
const describePostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

describePostgres('conditional device deactivation', () => {
  let postgres: StartedTestContainer
  let orm: MikroORM<PostgreSqlDriver>
  let device: UserDevice
  let ctx: CommandRuntimeContext
  let scope: { id: string; tenantId: string; userId: string; organizationId: string }

  beforeAll(async () => {
    await import('../commands/index')
    const { GenericContainer, Wait } = await import('testcontainers')
    postgres = await new GenericContainer('postgres:16')
      .withEnvironment({ POSTGRES_DB: 'devices_test', POSTGRES_USER: 'devices_test', POSTGRES_PASSWORD: 'devices_test' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
      .start()
    orm = await MikroORM.init({
      driver: PostgreSqlDriver,
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      dbName: 'devices_test',
      user: 'devices_test',
      password: 'devices_test',
      entities: [UserDevice],
    })
    await orm.schema.create()
    ctx = {
      container: { resolve: (name: string) => (name === 'em' ? orm.em.fork() : {}) },
      auth: null,
      systemActor: true,
      selectedOrganizationId: ORG,
      organizationIds: [ORG],
    } as unknown as CommandRuntimeContext
  }, 60000)

  afterAll(async () => {
    await orm?.close(true)
    await postgres?.stop()
  })

  beforeEach(async () => {
    mockDeleted.mockClear()
    mockEvent.mockClear()
    await orm.em.fork().nativeDelete(UserDevice, {})
    const em = orm.em.fork()
    device = em.create(UserDevice, {
      tenantId: TENANT,
      organizationId: ORG,
      userId: USER,
      deviceId: 'installation',
      platform: 'ios',
      pushToken: TOKEN,
      pushProvider: 'expo',
      pushTokenUpdatedAt: VERSION,
    })
    em.persist(device)
    await em.flush()
    scope = { id: device.id, tenantId: TENANT, userId: USER, organizationId: ORG }
  })

  const command = (id: string) => {
    const handler = mockCommands.get(`devices.user_devices.${id}`)
    if (!handler) throw new Error('[internal] Device command missing')
    return handler
  }
  const readDevice = () => orm.em.fork().findOneOrFail(UserDevice, device.id)
  const deactivate = () => command('deactivate').execute({ ...scope, expectedPushToken }, ctx)

  async function lockDevice(): Promise<{ em: EntityManager; row: UserDevice }> {
    const em = orm.em.fork()
    await em.begin()
    const row = await em.findOneOrFail(UserDevice, device.id, { lockMode: LockMode.PESSIMISTIC_WRITE })
    return { em, row }
  }

  async function waitForBlockedWriter(): Promise<void> {
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      const rows = await orm.em.getConnection().execute<Array<{ count: number }>>(
        "select count(*)::int as count from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'",
      )
      if (rows[0].count > 0) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error('[internal] Expected concurrent writer to wait for row lock')
  }

  it('preserves a committed rotation while the deactivation waits for the row lock', async () => {
    const { em, row } = await lockDevice()
    const result = deactivate()
    try {
      await waitForBlockedWriter()
      row.pushToken = 'fresh-token'
      row.pushTokenUpdatedAt = new Date(VERSION.getTime() + 1000)
      await em.flush()
      await em.commit()
      expect(await result).toEqual({ id: device.id, deactivated: false })
      expect((await readDevice()).deletedAt).toBeNull()
      expect(mockDeleted).not.toHaveBeenCalled()
      expect(mockEvent).not.toHaveBeenCalled()
    } finally {
      if (em.isInTransaction()) await em.rollback()
      await result.catch(() => undefined)
    }
  })

  async function holdDeactivation(): Promise<EntityManager> {
    const { em, row } = await lockDevice()
    row.deletedAt = new Date()
    await em.flush()
    return em
  }

  it('revives the device with the fresh token when registration waits on a deactivation in flight', async () => {
    const em = await holdDeactivation()
    const result = command('register').execute(
      {
        tenantId: TENANT,
        organizationId: ORG,
        userId: USER,
        deviceId: 'installation',
        platform: 'ios',
        pushToken: 'fresh-token',
        pushProvider: 'expo',
      },
      ctx,
    )
    try {
      await waitForBlockedWriter()
      await em.commit()
      expect(await result).toEqual({ id: device.id, deviceId: 'installation', revived: true })
      const stored = await readDevice()
      expect(stored.deletedAt).toBeNull()
      expect(stored.pushToken).toBe('fresh-token')
    } finally {
      if (em.isInTransaction()) await em.rollback()
      await result.catch(() => undefined)
    }
  })

  it('rejects a token update that waited on a deactivation in flight', async () => {
    const em = await holdDeactivation()
    const result = command('update').execute({ ...scope, pushToken: 'fresh-token' }, ctx)
    try {
      await waitForBlockedWriter()
      await em.commit()
      await expect(result).rejects.toThrow('Device not found')
      const stored = await readDevice()
      expect(stored.deletedAt).toBeInstanceOf(Date)
      expect(stored.pushToken).toBe(TOKEN)
    } finally {
      if (em.isInTransaction()) await em.rollback()
      await result.catch(() => undefined)
    }
  })

  it('deactivates an unchanged token exactly once and keeps the deletion side effects', async () => {
    expect(await deactivate()).toEqual({ id: device.id, deactivated: true })
    expect(await deactivate()).toEqual({ id: device.id, deactivated: false })
    expect((await readDevice()).deletedAt).toBeInstanceOf(Date)
    expect(mockDeleted).toHaveBeenCalledTimes(1)
    expect(mockEvent).toHaveBeenCalledTimes(1)
    expect(
      await command('deactivate').buildLog?.({
        result: { id: device.id, deactivated: false },
        snapshots: {},
      } as never),
    ).toBeNull()
  })

  it('leaves a rotated token active when the rotation committed before the call', async () => {
    const em = orm.em.fork()
    const row = await em.findOneOrFail(UserDevice, device.id)
    row.pushToken = 'fresh-token'
    row.pushTokenUpdatedAt = new Date(VERSION.getTime() + 1000)
    await em.flush()

    expect(await deactivate()).toEqual({ id: device.id, deactivated: false })
    expect((await readDevice()).deletedAt).toBeNull()
    expect(mockDeleted).not.toHaveBeenCalled()
  })

  it('keeps the unconditional behaviour when no token guard is supplied', async () => {
    expect(await command('deactivate').execute(scope, ctx)).toEqual({ id: device.id })
    expect((await readDevice()).deletedAt).toBeInstanceOf(Date)
  })

  it('denies a conditional call whose declared scope does not match the device', async () => {
    await expect(
      command('deactivate').execute({ ...scope, userId: '55555555-5555-4555-8555-555555555555', expectedPushToken }, ctx),
    ).rejects.toThrow()
    expect((await readDevice()).deletedAt).toBeNull()
  })

  it('reports no deactivation for a device outside the caller tenant', async () => {
    expect(
      await command('deactivate').execute(
        { ...scope, tenantId: '55555555-5555-4555-8555-555555555555', expectedPushToken },
        ctx,
      ),
    ).toEqual({ id: device.id, deactivated: false })
    expect((await readDevice()).deletedAt).toBeNull()
  })
})
