/** @jest-environment node */
import { randomUUID } from 'node:crypto'
import { MikroORM } from '@mikro-orm/core'
import { PostgreSqlDriver, type EntityManager } from '@mikro-orm/postgresql'
import type { StartedTestContainer } from 'testcontainers'
import { WebhookDeliveryEntity, WebhookEntity } from '../../data/entities'
import { processWebhookDeliveryJob } from '../delivery'

jest.mock('../../events', () => ({
  emitWebhooksEvent: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

jest.mock('../queue', () => ({
  enqueueWebhookDelivery: jest.fn(async () => 'job-1'),
  enqueueWebhookDeliveryFromJob: jest.fn(async () => 'job-2'),
}))

jest.mock('../integration-state', () => ({
  isWebhookIntegrationEnabled: jest.fn(async () => true),
  WEBHOOK_INTEGRATION_DISABLED_MESSAGE: 'disabled',
}))

jest.mock('../url-safety', () => {
  class UnsafeWebhookUrlError extends Error {}
  return {
    assertSafeWebhookDeliveryUrl: jest.fn(async () => undefined),
    safeWebhookFetch: jest.fn(),
    UnsafeWebhookUrlError,
  }
})

import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { enqueueWebhookDeliveryFromJob } from '../queue'
import { safeWebhookFetch } from '../url-safety'

const findOneWithDecryptionMock = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>
const enqueueFromJobMock = enqueueWebhookDeliveryFromJob as jest.MockedFunction<typeof enqueueWebhookDeliveryFromJob>
const safeWebhookFetchMock = safeWebhookFetch as jest.MockedFunction<typeof safeWebhookFetch>

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

const DATABASE_NAME = 'webhooks_delivery_claim_test'
const DATABASE_USER = 'webhooks_delivery_claim'
const DATABASE_PASSWORD = 'webhooks_delivery_claim'
const CONCURRENT_WORKERS = 8
const SEND_DURATION_MS = 300
const WEBHOOK_TIMEOUT_MS = 5_000

type TestOrm = MikroORM<PostgreSqlDriver, EntityManager<PostgreSqlDriver>>

type Seeded = { webhookId: string; deliveryId: string; tenantId: string; organizationId: string }

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

function createBarrier(parties: number): () => Promise<void> {
  let arrived = 0
  let open: () => void = () => undefined
  const opened = new Promise<void>((resolve) => {
    open = resolve
  })
  return async () => {
    arrived += 1
    if (arrived >= parties) open()
    await opened
  }
}

type FindOneArgs = [EntityManager, typeof WebhookEntity, Record<string, unknown>]

describeWithPostgres('processWebhookDeliveryJob claim on real Postgres', () => {
  let postgres: StartedTestContainer | null = null
  let orm: TestOrm | null = null

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers')
    postgres = await new GenericContainer('postgres:16')
      .withEnvironment({
        POSTGRES_DB: DATABASE_NAME,
        POSTGRES_USER: DATABASE_USER,
        POSTGRES_PASSWORD: DATABASE_PASSWORD,
      })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start()
    orm = await MikroORM.init<PostgreSqlDriver, EntityManager<PostgreSqlDriver>>({
      driver: PostgreSqlDriver,
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      dbName: DATABASE_NAME,
      user: DATABASE_USER,
      password: DATABASE_PASSWORD,
      entities: [WebhookEntity, WebhookDeliveryEntity],
      debug: false,
      pool: { min: 0, max: CONCURRENT_WORKERS + 2 },
    })
    await orm.schema.create()
  }, 120_000)

  afterAll(async () => {
    await Promise.allSettled([orm?.close(true)])
    await Promise.allSettled([postgres?.stop()])
  })

  beforeEach(() => {
    jest.clearAllMocks()
    findOneWithDecryptionMock.mockImplementation(((...args: FindOneArgs) => args[0].findOne(args[1], args[2])) as never)
    safeWebhookFetchMock.mockImplementation(async () => {
      await sleep(SEND_DURATION_MS)
      return new Response('ok', { status: 200 })
    })
  })

  function requireOrm(): TestOrm {
    if (!orm) throw new Error('[internal] ORM not started')
    return orm
  }

  async function seed(delivery: Partial<WebhookDeliveryEntity> = {}, webhook: Partial<WebhookEntity> = {}): Promise<Seeded> {
    const em = requireOrm().em.fork()
    const tenantId = randomUUID()
    const organizationId = randomUUID()
    const createdWebhook = em.create(WebhookEntity, {
      name: 'Claim test',
      url: 'https://example.com/hook',
      secret: 'whsec_dGVzdC1zZWNyZXQtZm9yLWNsYWltLXRlc3Q=',
      subscribedEvents: ['customers.person.created'],
      httpMethod: 'POST',
      maxRetries: 3,
      timeoutMs: WEBHOOK_TIMEOUT_MS,
      isActive: true,
      organizationId,
      tenantId,
      ...webhook,
    })
    await em.flush()
    const now = new Date()
    const createdDelivery = em.create(WebhookDeliveryEntity, {
      webhookId: createdWebhook.id,
      eventType: 'customers.person.created',
      messageId: `msg_${randomUUID()}`,
      payload: { type: 'customers.person.created', timestamp: now.toISOString(), data: { id: 'person-1' } },
      status: 'pending',
      attemptNumber: 0,
      maxAttempts: 3,
      targetUrl: createdWebhook.url,
      organizationId,
      tenantId,
      enqueuedAt: now,
      createdAt: now,
      updatedAt: now,
      ...delivery,
    })
    await em.flush()
    return { webhookId: createdWebhook.id, deliveryId: createdDelivery.id, tenantId, organizationId }
  }

  async function readDelivery(seeded: Seeded): Promise<WebhookDeliveryEntity> {
    const row = await requireOrm().em.fork().findOne(WebhookDeliveryEntity, { id: seeded.deliveryId })
    if (!row) throw new Error('[internal] delivery row missing')
    return row
  }

  function runJob(seeded: Seeded, scheduleRetries = false) {
    return processWebhookDeliveryJob(
      requireOrm().em.fork(),
      { deliveryId: seeded.deliveryId, tenantId: seeded.tenantId, organizationId: seeded.organizationId },
      { scheduleRetries },
    )
  }

  function holdWorkersBeforeClaim(parties: number): void {
    const arrive = createBarrier(parties)
    findOneWithDecryptionMock.mockImplementation((async (...args: FindOneArgs) => {
      await arrive()
      return args[0].findOne(args[1], args[2])
    }) as never)
  }

  it('sends a delivery once when several workers process the same job concurrently', async () => {
    const seeded = await seed()
    holdWorkersBeforeClaim(CONCURRENT_WORKERS)

    await Promise.all(Array.from({ length: CONCURRENT_WORKERS }, () => runJob(seeded)))

    expect(safeWebhookFetchMock).toHaveBeenCalledTimes(1)
    const row = await readDelivery(seeded)
    expect(row.status).toBe('delivered')
    expect(row.attemptNumber).toBe(1)
  }, 30_000)

  it('does not re-send or rewrite a delivery that already finished', async () => {
    const deliveredAt = new Date()
    const delivered = await seed({ status: 'delivered', attemptNumber: 1, deliveredAt })
    const deactivated = await seed({ status: 'delivered', attemptNumber: 1, deliveredAt }, { isActive: false })

    await expect(runJob(delivered)).resolves.toBeNull()
    await expect(runJob(deactivated)).resolves.toBeNull()

    expect(safeWebhookFetchMock).not.toHaveBeenCalled()
    expect((await readDelivery(delivered)).status).toBe('delivered')
    const deactivatedRow = await readDelivery(deactivated)
    expect(deactivatedRow.status).toBe('delivered')
    expect(deactivatedRow.errorMessage ?? null).toBeNull()
  }, 30_000)

  it('leaves a delivery another worker is still sending alone and rechecks it after the lease', async () => {
    const seeded = await seed({ status: 'sending', lastAttemptAt: new Date() }, { isActive: false })

    await expect(runJob(seeded, true)).resolves.toBeNull()

    expect(safeWebhookFetchMock).not.toHaveBeenCalled()
    const row = await readDelivery(seeded)
    expect(row.status).toBe('sending')
    expect(row.attemptNumber).toBe(0)
    expect(row.errorMessage ?? null).toBeNull()
    expect(enqueueFromJobMock).toHaveBeenCalledWith(
      { deliveryId: seeded.deliveryId, tenantId: seeded.tenantId, organizationId: seeded.organizationId },
      WEBHOOK_TIMEOUT_MS + 16_000,
    )
  }, 30_000)

  it('returns a claimed delivery to pending when processing throws, so a queue retry can send it', async () => {
    const seeded = await seed()
    const em = requireOrm().em.fork()
    jest.spyOn(em, 'flush').mockRejectedValueOnce(new Error('connection reset'))
    const job = { deliveryId: seeded.deliveryId, tenantId: seeded.tenantId, organizationId: seeded.organizationId }

    await expect(processWebhookDeliveryJob(em, job, { scheduleRetries: false })).rejects.toThrow('connection reset')
    expect((await readDelivery(seeded)).status).toBe('pending')
    expect(safeWebhookFetchMock).not.toHaveBeenCalled()

    await runJob(seeded)

    expect(safeWebhookFetchMock).toHaveBeenCalledTimes(1)
    const row = await readDelivery(seeded)
    expect(row.status).toBe('delivered')
    expect(row.attemptNumber).toBe(1)
  }, 30_000)

  it('stores a failed attempt as pending for its retry', async () => {
    const seeded = await seed()
    safeWebhookFetchMock.mockResolvedValueOnce(new Response('down', { status: 503 }))

    await runJob(seeded)

    const row = await readDelivery(seeded)
    expect(row.status).toBe('pending')
    expect(row.attemptNumber).toBe(1)
    expect(row.nextRetryAt).toBeInstanceOf(Date)
  }, 30_000)

  it('does not send a scheduled retry before it is due and rechecks it then', async () => {
    const nextRetryAt = new Date(Date.now() + 120_000)
    const scheduled = await seed({ attemptNumber: 1, nextRetryAt })
    const due = await seed({ attemptNumber: 1, nextRetryAt: new Date(Date.now() - 1_000) })

    await expect(runJob(scheduled, true)).resolves.toBeNull()

    expect(safeWebhookFetchMock).not.toHaveBeenCalled()
    const scheduledRow = await readDelivery(scheduled)
    expect(scheduledRow.status).toBe('pending')
    expect(scheduledRow.attemptNumber).toBe(1)
    expect(scheduledRow.nextRetryAt?.getTime()).toBe(nextRetryAt.getTime())
    expect(enqueueFromJobMock).toHaveBeenCalledTimes(1)
    const [, recheckDelayMs] = enqueueFromJobMock.mock.calls[0]
    expect(recheckDelayMs).toBeGreaterThan(110_000)
    expect(recheckDelayMs).toBeLessThanOrEqual(121_000)

    await expect(runJob(due)).resolves.toEqual({ status: 'delivered', deliveryId: due.deliveryId })
    expect(safeWebhookFetchMock).toHaveBeenCalledTimes(1)
    expect((await readDelivery(due)).attemptNumber).toBe(2)
  }, 30_000)

  it('reclaims a delivery whose sending worker stopped past its timeout', async () => {
    const seeded = await seed({ status: 'sending', lastAttemptAt: new Date(Date.now() - WEBHOOK_TIMEOUT_MS - 60_000) })
    holdWorkersBeforeClaim(CONCURRENT_WORKERS)

    await Promise.all(Array.from({ length: CONCURRENT_WORKERS }, () => runJob(seeded)))

    expect(safeWebhookFetchMock).toHaveBeenCalledTimes(1)
    const row = await readDelivery(seeded)
    expect(row.status).toBe('delivered')
    expect(row.attemptNumber).toBe(1)
  }, 30_000)
})
