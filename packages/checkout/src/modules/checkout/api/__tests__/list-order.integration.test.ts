/** @jest-environment node */
import { randomUUID } from 'node:crypto'
import { MikroORM } from '@mikro-orm/core'
import { PostgreSqlDriver, type EntityManager } from '@mikro-orm/postgresql'
import type { StartedTestContainer } from 'testcontainers'
import { CheckoutLink, CheckoutLinkTemplate, CheckoutTransaction } from '../../data/entities'
import { GET as getLinks } from '../links/route'
import { GET as getTemplates } from '../templates/route'
import { GET as getTransactions } from '../transactions/route'

const mockAdminContext = jest.fn()

jest.mock('../helpers', () => ({
  requireAdminContext: (...args: unknown[]) => mockAdminContext(...args),
  userHasCheckoutFeature: jest.fn(async () => true),
  handleCheckoutRouteError: (error: unknown) => {
    throw error
  },
}))

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

type ListBody = { items: Array<{ id: string }>; total: number; totalPages: number }
type Scope = { tenantId: string; organizationId: string }

const ROW_COUNT = 30
const PAGE_SIZE = 5
const SHARED_CREATED_AT = new Date('2026-01-15T10:00:00.000Z')

describeWithPostgres('checkout admin list paging against PostgreSQL', () => {
  let postgres: StartedTestContainer | undefined
  let orm: MikroORM<PostgreSqlDriver> | undefined

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers')
    postgres = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({ POSTGRES_DB: 'checkout', POSTGRES_USER: 'checkout', POSTGRES_PASSWORD: 'checkout' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
      .start()
    orm = await MikroORM.init({
      driver: PostgreSqlDriver,
      entities: [CheckoutLinkTemplate, CheckoutLink, CheckoutTransaction],
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      dbName: 'checkout',
      user: 'checkout',
      password: 'checkout',
    })
    await orm.schema.create()
  }, 120_000)

  afterAll(async () => {
    await orm?.close(true)
    await postgres?.stop()
  }, 30_000)

  function activeOrm(): MikroORM<PostgreSqlDriver> {
    if (!orm) throw new Error('[internal] PostgreSQL test ORM unavailable')
    return orm
  }

  async function walkPages(path: string, handler: (req: Request) => Promise<Response>, scope: Scope): Promise<string[]> {
    const db = activeOrm()
    mockAdminContext.mockImplementation(async () => ({
      auth: { sub: randomUUID(), tenantId: scope.tenantId, orgId: scope.organizationId },
      container: {},
      em: db.em.fork({ clear: true }),
      commandBus: {},
    }))
    const walkedIds: string[] = []
    const pageCount = ROW_COUNT / PAGE_SIZE
    for (let page = 1; page <= pageCount; page += 1) {
      const response = await handler(new Request(`http://localhost/api/checkout/${path}?page=${page}&pageSize=${PAGE_SIZE}`))
      expect(response.status).toBe(200)
      const body = (await response.json()) as ListBody
      expect(body.total).toBe(ROW_COUNT)
      expect(body.totalPages).toBe(pageCount)
      walkedIds.push(...body.items.map((item) => item.id))
    }
    return walkedIds
  }

  function sorted(ids: string[]): string[] {
    return [...ids].sort((left, right) => left.localeCompare(right))
  }

  async function analyze(em: EntityManager, table: string): Promise<void> {
    await em.getConnection().execute(`analyze ${table}`)
  }

  it('returns every template exactly once when walking pages over a shared createdAt', async () => {
    const scope = { tenantId: randomUUID(), organizationId: randomUUID() }
    const em = activeOrm().em.fork()
    try {
      const rows = Array.from({ length: ROW_COUNT }, (_, index) => em.create(CheckoutLinkTemplate, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        name: `Template ${index}`,
        pricingMode: 'fixed',
      }))
      await em.flush()
      await em.nativeUpdate(CheckoutLinkTemplate, scope, { createdAt: SHARED_CREATED_AT })
      await analyze(em, 'checkout_link_templates')

      const walkedIds = await walkPages('templates', getTemplates, scope)

      expect(walkedIds).toHaveLength(ROW_COUNT)
      expect(sorted(walkedIds)).toEqual(sorted(rows.map((row) => row.id)))
    } finally {
      await em.nativeDelete(CheckoutLinkTemplate, scope)
    }
  }, 30_000)

  it('returns every pay link exactly once when walking pages over a shared createdAt', async () => {
    const scope = { tenantId: randomUUID(), organizationId: randomUUID() }
    const em = activeOrm().em.fork()
    try {
      const rows = Array.from({ length: ROW_COUNT }, (_, index) => em.create(CheckoutLink, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        name: `Link ${index}`,
        slug: `link-${scope.organizationId}-${index}`,
        pricingMode: 'fixed',
      }))
      await em.flush()
      await em.nativeUpdate(CheckoutLink, scope, { createdAt: SHARED_CREATED_AT })
      await analyze(em, 'checkout_links')

      const walkedIds = await walkPages('links', getLinks, scope)

      expect(walkedIds).toHaveLength(ROW_COUNT)
      expect(sorted(walkedIds)).toEqual(sorted(rows.map((row) => row.id)))
    } finally {
      await em.nativeDelete(CheckoutLink, scope)
    }
  }, 30_000)

  it('returns every transaction exactly once when walking pages over a shared createdAt', async () => {
    const scope = { tenantId: randomUUID(), organizationId: randomUUID() }
    const linkId = randomUUID()
    const em = activeOrm().em.fork()
    try {
      const rows = Array.from({ length: ROW_COUNT }, (_, index) => em.create(CheckoutTransaction, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        linkId,
        status: 'completed',
        amount: '10.00',
        currencyCode: 'EUR',
        idempotencyKey: `key-${index}`,
      }))
      await em.flush()
      await em.nativeUpdate(CheckoutTransaction, scope, { createdAt: SHARED_CREATED_AT })
      await analyze(em, 'checkout_transactions')

      const walkedIds = await walkPages('transactions', getTransactions, scope)

      expect(walkedIds).toHaveLength(ROW_COUNT)
      expect(sorted(walkedIds)).toEqual(sorted(rows.map((row) => row.id)))
    } finally {
      await em.nativeDelete(CheckoutTransaction, scope)
    }
  }, 30_000)
})
