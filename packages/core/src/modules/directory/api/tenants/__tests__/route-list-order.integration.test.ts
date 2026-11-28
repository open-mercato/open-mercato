/** @jest-environment node */
import { randomUUID } from 'node:crypto'
import { MikroORM } from '@mikro-orm/core'
import { PostgreSqlDriver } from '@mikro-orm/postgresql'
import type { StartedTestContainer } from 'testcontainers'
import { Organization, Tenant } from '../../../data/entities'
import { GET } from '../route'

const mockResolve = jest.fn()
const mockGetAuth = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({ resolve: mockResolve })),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuth(...args),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn(async () => ({})),
  buildCustomFieldFiltersFromQuery: jest.fn(async () => ({})),
}))

jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: () => ({ GET: jest.fn(), POST: jest.fn(), PUT: jest.fn(), DELETE: jest.fn() }),
  logCrudAccess: jest.fn(async () => {}),
}))

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

type ListBody = { items: Array<{ id: string }>; total: number; totalPages: number }

describeWithPostgres('directory tenants list paging against PostgreSQL', () => {
  let postgres: StartedTestContainer | undefined
  let orm: MikroORM<PostgreSqlDriver> | undefined
  let seededIds: string[] = []

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers')
    postgres = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({ POSTGRES_DB: 'directory', POSTGRES_USER: 'directory', POSTGRES_PASSWORD: 'directory' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
      .start()
    orm = await MikroORM.init({
      driver: PostgreSqlDriver,
      entities: [Tenant, Organization],
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      dbName: 'directory',
      user: 'directory',
      password: 'directory',
    })
    await orm.schema.create()
    const em = orm.em.fork()
    const rows = Array.from({ length: 30 }, () => em.create(Tenant, { name: 'Shared Tenant Name' }))
    await em.flush()
    const timestamp = new Date('2026-01-15T10:00:00.000Z')
    await em.nativeUpdate(Tenant, { id: { $in: rows.map((row) => row.id) } }, { createdAt: timestamp, updatedAt: timestamp })
    await em.getConnection().execute('analyze tenants')
    seededIds = rows.map((row) => row.id).sort((left, right) => left.localeCompare(right))
  }, 120_000)

  afterAll(async () => {
    await orm?.em.fork().nativeDelete(Tenant, { id: { $in: seededIds } })
    await orm?.close(true)
    await postgres?.stop()
  }, 30_000)

  it.each([
    ['name', 'asc'],
    ['name', 'desc'],
    ['createdAt', 'asc'],
    ['updatedAt', 'desc'],
  ])('returns every tenant exactly once when walking pages over a shared %s (%s)', async (sortField, sortDir) => {
    const activeOrm = orm
    if (!activeOrm) throw new Error('[internal] PostgreSQL test ORM unavailable')
    mockGetAuth.mockResolvedValue({ sub: randomUUID(), tenantId: randomUUID(), isSuperAdmin: true })
    mockResolve.mockImplementation((key: string) => {
      if (key === 'em') return activeOrm.em.fork({ clear: true })
      throw new Error(`[internal] unexpected resolve(${key})`)
    })

    const walkedIds: string[] = []
    for (let page = 1; page <= 6; page += 1) {
      const response = await GET(new Request(`http://localhost/api/directory/tenants?page=${page}&pageSize=5&sortField=${sortField}&sortDir=${sortDir}`))
      expect(response.status).toBe(200)
      const body = (await response.json()) as ListBody
      expect(body.total).toBe(30)
      expect(body.totalPages).toBe(6)
      walkedIds.push(...body.items.map((item) => item.id))
    }

    expect(walkedIds).toHaveLength(30)
    expect([...walkedIds].sort((left, right) => left.localeCompare(right))).toEqual(seededIds)
  }, 30_000)
})
