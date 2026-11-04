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

describePostgres('conditional device deactivation persistence ordering (#8599)', () => {
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
      host: postgres.getHost(), port: postgres.getMappedPort(5432),
      dbName: 'devices_test', user: 'devices_test', password: 'devices_test', entities: [UserDevice],
    })
    await orm.schema.create()
    ctx = {
      container: { resolve: (name: string) => name === 'em' ? orm.em.fork() : {} },
      auth: null, systemActor: true, selectedOrganizationId: ORG, organizationIds: [ORG],
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
      tenantId: TENANT, organizationId: ORG, userId: USER, deviceId: 'installation', platform: 'ios',
      pushToken: TOKEN, pushProvider: 'expo', pushTokenUpdatedAt: VERSION,
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
  const deactivate = async () => command('deactivate').execute({ ...scope, expectedPushToken }, ctx)

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

  it.each(['rotated-token', TOKEN])('preserves a committed rotation while deactivation waits (token=%s)', async (newToken) => {
    const { em, row } = await lockDevice()
    const result = deactivate()
    try {
      await waitForBlockedWriter()
      row.pushToken = newToken
      row.pushTokenUpdatedAt = new Date(VERSION.getTime() + 1000)
      await em.flush()
      await em.commit()
      expect(await result).toEqual({ id: device.id, deactivated: false })
      expect((await readDevice()).deletedAt).toBeNull()
      expect(mockDeleted).not.toHaveBeenCalled()
      expect(mockEvent).not.toHaveBeenCalled()
      expect(await command('deactivate').buildLog?.({ result: { id: device.id, deactivated: false }, snapshots: {} } as never)).toBeNull()
    } finally {
      if (em.isInTransaction()) await em.rollback()
      await result.catch(() => undefined)
    }
  })

  it('deactivates an unchanged token exactly once and preserves deletion side effects', async () => {
    expect(await deactivate()).toEqual({ id: device.id, deactivated: true })
    expect(await deactivate()).toEqual({ id: device.id, deactivated: false })
    expect((await readDevice()).deletedAt).toBeInstanceOf(Date)
    expect(mockDeleted).toHaveBeenCalledTimes(1)
    expect(mockEvent).toHaveBeenCalledTimes(1)
    const log = await command('deactivate').buildLog?.({ result: { id: device.id, deactivated: true }, snapshots: { before: { id: device.id } } } as never)
    expect(log).toBeTruthy()
  })

  it('does not let an update rotate a device deleted while waiting for its lock', async () => {
    const { em, row } = await lockDevice()
    const update = Promise.resolve(command('update').execute({ ...scope, pushToken: 'fresh-token' }, ctx)).then(
      () => ({ failed: false }), () => ({ failed: true }),
    )
    try {
      await waitForBlockedWriter()
      row.deletedAt = new Date()
      await em.flush()
      await em.commit()
      expect(await update).toEqual({ failed: true })
      expect((await readDevice()).pushToken).toBe(TOKEN)
    } finally {
      if (em.isInTransaction()) await em.rollback()
      await update
    }
  })

  it('registration revives the device when deactivation commits before its locked read', async () => {
    const { em, row } = await lockDevice()
    const registration = Promise.resolve(command('register').execute({
      tenantId: TENANT, organizationId: ORG, userId: USER, deviceId: 'installation', platform: 'ios',
      pushToken: 'fresh-token', pushProvider: 'expo',
    }, ctx))
    try {
      await waitForBlockedWriter()
      row.deletedAt = new Date()
      await em.flush()
      await em.commit()
      expect(await registration).toEqual({ id: device.id, deviceId: 'installation', revived: true })
      const registered = await readDevice()
      expect(registered.deletedAt).toBeNull()
      expect(registered.pushToken).toBe('fresh-token')
    } finally {
      if (em.isInTransaction()) await em.rollback()
      await registration.catch(() => undefined)
    }
  })

  it.each([{ userId: '55555555-5555-4555-8555-555555555555' }, { organizationId: null }])('denies a mismatched conditional scope: %j', async (override) => {
    await expect(command('deactivate').execute({ ...scope, ...override, expectedPushToken }, ctx)).rejects.toThrow()
    expect((await readDevice()).deletedAt).toBeNull()
  })

  it('denies an authenticated caller with a different tenant scope', async () => {
    const caller = { ...ctx, systemActor: false, auth: { sub: USER, tenantId: '55555555-5555-4555-8555-555555555555', orgId: ORG } } as unknown as CommandRuntimeContext
    await expect(command('deactivate').execute({ ...scope, expectedPushToken }, caller)).rejects.toThrow()
    expect((await readDevice()).deletedAt).toBeNull()
  })

  it('denies an authenticated caller with a different organization scope', async () => {
    const caller = { ...ctx, selectedOrganizationId: '55555555-5555-4555-8555-555555555555' }
    await expect(command('deactivate').execute({ ...scope, expectedPushToken }, caller)).rejects.toThrow()
    expect((await readDevice()).deletedAt).toBeNull()
  })

  it('leaves a different tenant untouched', async () => {
    expect(await command('deactivate').execute({ ...scope, tenantId: '55555555-5555-4555-8555-555555555555', expectedPushToken }, ctx)).toEqual({ id: device.id, deactivated: false })
    expect((await readDevice()).deletedAt).toBeNull()
  })
})
