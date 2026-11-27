/** @jest-environment node */
import { randomUUID } from 'node:crypto'
import { MikroORM } from '@mikro-orm/core'
import { PostgreSqlDriver } from '@mikro-orm/postgresql'
import type { StartedTestContainer } from 'testcontainers'
import { GatewayTransaction } from '../../data/entities'
import { GET } from '../transactions/route'

const mockResolve = jest.fn()
const mockGetAuth = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({ resolve: mockResolve })),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuth(...args),
}))

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

type ListBody = { items: Array<{ id: string }>; total: number; totalPages: number }

describeWithPostgres('payment transactions list paging against PostgreSQL', () => {
  let postgres: StartedTestContainer | undefined
  let orm: MikroORM<PostgreSqlDriver> | undefined
  const queryLog: string[] = []

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers')
    postgres = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({ POSTGRES_DB: 'payments', POSTGRES_USER: 'payments', POSTGRES_PASSWORD: 'payments' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
      .start()
    orm = await MikroORM.init({
      driver: PostgreSqlDriver,
      entities: [GatewayTransaction],
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      dbName: 'payments', user: 'payments', password: 'payments',
      debug: ['query'],
      logger: (message) => { queryLog.push(message) },
    })
    await orm.schema.create()
  }, 120_000)

  afterAll(async () => {
    await orm?.close(true)
    await postgres?.stop()
  }, 30_000)

  it('returns every transaction exactly once when walking pages over a shared createdAt', async () => {
    const activeOrm = orm
    if (!activeOrm) throw new Error('[internal] PostgreSQL test ORM unavailable')
    const tenantId = randomUUID()
    const organizationId = randomUUID()
    const em = activeOrm.em.fork()
    const rows = Array.from({ length: 30 }, () => em.create(GatewayTransaction, {
      tenantId, organizationId, paymentId: randomUUID(), providerKey: 'mock', amount: '10.0000', currencyCode: 'USD',
    }))
    await em.flush()
    const seededIds = rows.map((row) => row.id).sort()
    try {
      await em.nativeUpdate(GatewayTransaction, { organizationId, tenantId }, { createdAt: new Date('2026-11-13T10:00:00.000Z') })
      mockGetAuth.mockResolvedValue({ sub: randomUUID(), tenantId, orgId: organizationId })
      mockResolve.mockImplementation((key: string) => {
        if (key === 'em') return activeOrm.em.fork({ clear: true })
        throw new Error(`[internal] unexpected resolve(${key})`)
      })

      const walkedIds: string[] = []
      for (let page = 1; page <= 6; page += 1) {
        const response = await GET(new Request(`http://localhost/api/payment_gateways/transactions?page=${page}&pageSize=5`))
        expect(response.status).toBe(200)
        const body = (await response.json()) as ListBody
        expect(body.total).toBe(30)
        expect(body.totalPages).toBe(6)
        walkedIds.push(...body.items.map((item) => item.id))
      }

      expect(walkedIds).toHaveLength(30)
      expect([...walkedIds].sort()).toEqual(seededIds)
    } finally {
      await em.nativeDelete(GatewayTransaction, { organizationId, tenantId })
    }
  }, 30_000)

  it.each(['createdAt', 'updatedAt', 'unifiedStatus', 'amount', 'providerKey'] as const)(
    'orders %s before paging and excludes foreign or deleted rows', async (sortField) => {
      const activeOrm = orm
      if (!activeOrm) throw new Error('[internal] PostgreSQL test ORM unavailable')
      const tenantId = randomUUID()
      const organizationId = randomUUID()
      const em = activeOrm.em.fork()
      const fixtures = [
        { amount: '100', providerKey: 'zeta', unifiedStatus: 'pending' },
        { amount: '2', providerKey: 'alpha', unifiedStatus: 'captured' },
        { amount: '10', providerKey: 'mock', unifiedStatus: 'authorized' },
        { amount: '10', providerKey: 'mock', unifiedStatus: 'authorized' },
      ]
      const rows = fixtures.map((fixture, index) => em.create(GatewayTransaction, {
        ...fixture, tenantId, organizationId, paymentId: randomUUID(), currencyCode: 'USD',
        createdAt: new Date(`2026-11-0${index + 1}T10:00:00Z`),
        updatedAt: new Date(`2026-11-0${4 - index}T10:00:00Z`),
      }))
      const excluded = [
        em.create(GatewayTransaction, { ...fixtures[0], tenantId: randomUUID(), organizationId, paymentId: randomUUID(), currencyCode: 'USD' }),
        em.create(GatewayTransaction, { ...fixtures[0], tenantId, organizationId: randomUUID(), paymentId: randomUUID(), currencyCode: 'USD' }),
        em.create(GatewayTransaction, { ...fixtures[0], tenantId, organizationId, paymentId: randomUUID(), currencyCode: 'USD', deletedAt: new Date() }),
      ]
      await em.flush()
      try {
        mockGetAuth.mockResolvedValue({ sub: randomUUID(), tenantId, orgId: organizationId })
        mockResolve.mockImplementation((key: string) => {
          if (key === 'em') return activeOrm.em.fork({ clear: true })
          throw new Error(`[internal] unexpected resolve(${key})`)
        })
        for (const sortDir of ['asc', 'desc']) {
          const expected = [...rows].sort((left, right) => {
            const leftValue = sortField === 'amount' ? Number(left.amount) : left[sortField]
            const rightValue = sortField === 'amount' ? Number(right.amount) : right[sortField]
            const comparison = leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : left.id.localeCompare(right.id)
            return sortDir === 'asc' ? comparison : -comparison
          })
          const walkedIds: string[] = []
          for (const page of [1, 2]) {
            queryLog.length = 0
            const response = await GET(new Request(`http://localhost/api/payment_gateways/transactions?sortField=${sortField}&sortDir=${sortDir}&page=${page}&pageSize=2`))
            expect(response.status).toBe(200)
            expect(queryLog.filter((message) => message.includes('select '))).toHaveLength(2)
            const body = await response.json() as ListBody
            expect(body.total).toBe(4)
            walkedIds.push(...body.items.map((item) => item.id))
          }
          expect(walkedIds).toEqual(expected.map((row) => row.id))
        }
      } finally {
        await em.nativeDelete(GatewayTransaction, { id: [...rows, ...excluded].map((row) => row.id) })
      }
    },
  )
})
