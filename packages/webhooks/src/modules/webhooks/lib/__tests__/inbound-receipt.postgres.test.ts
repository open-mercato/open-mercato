import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createQueue } from '@open-mercato/queue'
import { processInboundDispatchJob, type InboundDispatchJob } from '../inbound-dispatch'
import { registerWebhookHandler } from '../inbound-registry'
import { MikroORM } from '@mikro-orm/postgresql'
import { WebhookIngestionEntity, WebhookInboundReceiptEntity } from '../../data/entities'
import { Migration20261028234000_webhooks } from '../../migrations/Migration20261028234000_webhooks'
import { Migration20261018124142_webhooks } from '../../migrations/Migration20261018124142_webhooks'

const mockEnqueue = jest.fn()
const mockEmit = jest.fn()
const mockStartWorker = jest.fn()

jest.mock('../queue', () => ({
  enqueueInboundDispatch: (...args: unknown[]) => mockEnqueue(...args),
  ensureLocalInboundQueueWorkerStarted: () => mockStartWorker(),
}))
jest.mock('../../events', () => ({
  emitWebhooksEvent: (...args: unknown[]) => mockEmit(...args),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (em: MikroORM['em'], ...args: Parameters<MikroORM['em']['findOne']>) => em.findOne(...args),
}))

import { receiveInboundWebhook } from '../inbound-receipt'

const databaseUrl = process.env.OM_WEBHOOKS_TEST_DATABASE_URL
const describePostgres = databaseUrl ? describe : describe.skip

describePostgres.each([1, 8])('inbound receipt PostgreSQL transactions with pool size %i', (poolSize) => {
  let orm: MikroORM
  const schema = `webhook_receipts_${randomUUID().replaceAll('-', '')}`
  const tenantId = randomUUID()
  const organizationId = randomUUID()
  const input = {
    endpointId: 'receipt_test',
    messageId: 'signed-message',
    providerKey: 'receipt_test',
    eventType: 'payment.succeeded',
    payload: { payment: 'test' },
    headers: { 'webhook-id': 'signed-message' },
    tenantId,
    organizationId,
  }

  beforeAll(async () => {
    orm = await MikroORM.init({
      entities: [WebhookInboundReceiptEntity, WebhookIngestionEntity],
      clientUrl: databaseUrl,
      schema,
      pool: { min: 0, max: poolSize },
    })
    await orm.schema.create()
  })

  afterAll(async () => {
    if (!orm) return
    try {
      await orm.schema.drop()
      await orm.schema.execute(`drop schema if exists "${schema}"`)
    } finally {
      await orm.close(true)
    }
  })

  beforeEach(async () => {
    jest.resetAllMocks()
    mockEnqueue.mockResolvedValue('job-1')
    mockEmit.mockResolvedValue(undefined)
    mockStartWorker.mockResolvedValue(undefined)
    await orm.em.fork().nativeDelete(WebhookInboundReceiptEntity, {})
    await orm.em.fork().nativeDelete(WebhookIngestionEntity, {})
  })

  async function receipt() {
    return orm.em.fork().findOneOrFail(WebhookInboundReceiptEntity, {
      endpointId: input.endpointId,
      messageId: input.messageId,
      tenantId,
      organizationId,
    })
  }

  it('commits ingestion before enqueue and preserves it through a rejected enqueue', async () => {
    mockEnqueue.mockRejectedValueOnce(new Error('queue unavailable'))
    const sourceInput = { ...input, sourceKey: input.endpointId }

    await expect(receiveInboundWebhook(orm.em.fork(), sourceInput)).rejects.toThrow('queue unavailable')
    expect(await receipt()).toMatchObject({ dispatchQueued: false, receivedEventPublished: false })
    const ingestion = await orm.em.fork().findOneOrFail(WebhookIngestionEntity, {
      id: (await receipt()).ingestionId, tenantId, organizationId,
    })
    expect(ingestion.payload).toEqual(input.payload)
    await expect(receiveInboundWebhook(orm.em.fork(), sourceInput)).resolves.toBe(false)
    await expect(receiveInboundWebhook(orm.em.fork(), sourceInput)).resolves.toBe(true)

    expect(mockEnqueue).toHaveBeenCalledTimes(2)
    expect(mockEnqueue.mock.calls[0][0]).toEqual(mockEnqueue.mock.calls[1][0])
    expect(mockEmit).toHaveBeenCalledTimes(1)
    expect(await orm.em.fork().count(WebhookIngestionEntity, {})).toBe(1)
  })

  it('releases the checkpoint connection before startup reads the receipt and ingestion', async () => {
    mockStartWorker.mockImplementationOnce(async () => {
      const saved = await receipt()
      expect(saved.dispatchQueued).toBe(true)
      const ingestion = await orm.em.fork().findOneOrFail(WebhookIngestionEntity, {
        id: saved.ingestionId, tenantId, organizationId,
      })
      expect(ingestion.payload).toEqual(input.payload)
    })

    await expect(receiveInboundWebhook(orm.em.fork(), {
      ...input, sourceKey: input.endpointId,
    })).resolves.toBe(false)
    expect(mockStartWorker).toHaveBeenCalledTimes(1)
  })

  it('acknowledges completed source duplicates independently of local worker availability', async () => {
    const sourceInput = { ...input, sourceKey: input.endpointId }
    await expect(receiveInboundWebhook(orm.em.fork(), sourceInput)).resolves.toBe(false)
    mockStartWorker.mockRejectedValueOnce(new Error('local worker unavailable'))

    await expect(receiveInboundWebhook(orm.em.fork(), sourceInput)).resolves.toBe(true)
    expect(mockStartWorker).toHaveBeenCalledTimes(1)
    expect(mockEnqueue).toHaveBeenCalledTimes(1)
    expect(mockEmit).toHaveBeenCalledTimes(1)
  })

  it('commits source dispatch independently of a failed received-event publication', async () => {
    mockEmit.mockRejectedValueOnce(new Error('event queue unavailable'))
    const sourceInput = { ...input, sourceKey: input.endpointId }

    await expect(receiveInboundWebhook(orm.em.fork(), sourceInput)).rejects.toThrow('event queue unavailable')
    expect(await receipt()).toMatchObject({ dispatchQueued: true, receivedEventPublished: false })
    await expect(receiveInboundWebhook(orm.em.fork(), sourceInput)).resolves.toBe(false)
    await expect(receiveInboundWebhook(orm.em.fork(), sourceInput)).resolves.toBe(true)

    expect(mockEnqueue).toHaveBeenCalledTimes(1)
    expect(mockEmit).toHaveBeenCalledTimes(2)
  })

  it('keeps pending source dispatch retryable when a retry resolves to a legacy adapter', async () => {
    mockEnqueue.mockRejectedValueOnce(new Error('queue unavailable'))
    const sourceInput = { ...input, sourceKey: input.endpointId }

    await expect(receiveInboundWebhook(orm.em.fork(), sourceInput)).rejects.toThrow('queue unavailable')
    await expect(receiveInboundWebhook(orm.em.fork(), input)).rejects.toThrow('Inbound receipt dispatch is not queued')
    expect(mockEmit).not.toHaveBeenCalled()
    expect(await receipt()).toMatchObject({ dispatchQueued: false, receivedEventPublished: false })
    await expect(receiveInboundWebhook(orm.em.fork(), sourceInput)).resolves.toBe(false)
    expect(mockEnqueue).toHaveBeenCalledTimes(2)
    expect(mockEmit).toHaveBeenCalledTimes(1)
  })

  it('serializes concurrent legacy retries, including recovery after publication failure', async () => {
    mockEmit.mockRejectedValueOnce(new Error('event queue unavailable'))
    const outcomes = await Promise.allSettled(Array.from({ length: 8 }, () =>
      receiveInboundWebhook(orm.em.fork(), input)))

    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled' && !outcome.value)).toHaveLength(1)
    expect(mockEmit).toHaveBeenCalledTimes(2)
    expect(mockEnqueue).not.toHaveBeenCalled()
    expect(await receipt()).toMatchObject({ receivedEventPublished: true })
    await expect(receiveInboundWebhook(orm.em.fork(), input)).resolves.toBe(true)
  })

  it.each([false, true])('serializes concurrent source retries after enqueue failure: %s', async (failFirst) => {
    if (failFirst) mockEnqueue.mockRejectedValueOnce(new Error('queue unavailable'))
    const outcomes = await Promise.allSettled(Array.from({ length: 8 }, () =>
      receiveInboundWebhook(orm.em.fork(), { ...input, sourceKey: input.endpointId })))

    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(failFirst ? 1 : 0)
    expect(outcomes.some((outcome) => outcome.status === 'fulfilled' && !outcome.value)).toBe(true)
    expect(mockEnqueue).toHaveBeenCalledTimes(failFirst ? 2 : 1)
    expect(mockEmit).toHaveBeenCalledTimes(1)
    expect(await orm.em.fork().count(WebhookIngestionEntity, {})).toBe(1)
    expect(await orm.em.fork().count(WebhookInboundReceiptEntity, {})).toBe(1)
  })

  it('preserves historical completed receipts and rejects collisions from another tenant', async () => {
    const em = orm.em.fork()
    em.persist(em.create(WebhookInboundReceiptEntity, {
      endpointId: input.endpointId,
      messageId: input.messageId,
      providerKey: input.providerKey,
      tenantId,
      organizationId,
      createdAt: new Date(),
    }))
    await em.flush()

    await expect(receiveInboundWebhook(orm.em.fork(), input)).resolves.toBe(true)
    await expect(receiveInboundWebhook(orm.em.fork(), {
      ...input, tenantId: randomUUID(), organizationId: randomUUID(),
    })).rejects.toThrow('Inbound receipt not found in verified scope')
    expect(mockEnqueue).not.toHaveBeenCalled()
    expect(mockEmit).not.toHaveBeenCalled()
  })

  function deferred() {
    let resolve!: () => void
    const promise = new Promise<void>((complete) => { resolve = complete })
    return { promise, resolve }
  }

  async function within<Result>(operation: Promise<Result>, timeoutMs = 1_000): Promise<Result> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('[internal] Unrelated query could not acquire the pool')), timeoutMs)
      })])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  it.each(['dispatch', 'received_event'])('releases the pool while %s is blocked, including concurrent receipts', async (stage) => {
    const entered = deferred()
    const release = deferred()
    const publisher = stage === 'dispatch' ? mockEnqueue : mockEmit
    publisher.mockImplementation(async () => { entered.resolve(); await release.promise; return 'job-1' })
    const deliveryInput = { ...input, ...(stage === 'dispatch' ? { sourceKey: input.endpointId } : {}) }
    const operations = Array.from({ length: 4 }, (_, index) => receiveInboundWebhook(orm.em.fork(), {
      ...deliveryInput, messageId: `blocked-${index}`,
    }))
    try {
      await within(entered.promise)
      await expect(within(orm.em.fork().getConnection().execute('select 1 as available'))).resolves.toEqual([{ available: 1 }])
    } finally {
      release.resolve()
      await Promise.all(operations)
    }
    expect(publisher).toHaveBeenCalledTimes(4)
  })

  it.each(['dispatch', 'received_event'])('fences an expired %s owner from completing or clearing its successor', async (stage) => {
    const firstEntered = deferred()
    const secondEntered = deferred()
    const releaseFirst = deferred()
    const releaseSecond = deferred()
    const publisher = stage === 'dispatch' ? mockEnqueue : mockEmit
    publisher.mockImplementationOnce(async () => { firstEntered.resolve(); await releaseFirst.promise; return 'job-1' })
      .mockImplementationOnce(async () => { secondEntered.resolve(); await releaseSecond.promise; return 'job-1' })
    const deliveryInput = { ...input, ...(stage === 'dispatch' ? { sourceKey: input.endpointId } : {}) }
    const first = receiveInboundWebhook(orm.em.fork(), deliveryInput)
    const firstOutcome = first.then(() => null, (error: unknown) => error)
    await within(firstEntered.promise)
    const staleToken = (await receipt()).deliveryClaimToken
    await orm.em.fork().nativeUpdate(WebhookInboundReceiptEntity, { id: (await receipt()).id, tenantId, organizationId }, {
      deliveryClaimExpiresAt: new Date(Date.now() - 1),
    })
    const second = receiveInboundWebhook(orm.em.fork(), deliveryInput)
    try {
      await within(secondEntered.promise)
      const successor = await receipt()
      expect(successor.deliveryClaimToken).not.toBe(staleToken)
      releaseFirst.resolve()
      expect(await firstOutcome).toEqual(expect.objectContaining({ message: expect.stringContaining('claim expired') }))
      expect((await receipt()).deliveryClaimToken).toBe(successor.deliveryClaimToken)
      expect(stage === 'dispatch' ? (await receipt()).dispatchQueued : (await receipt()).receivedEventPublished).toBe(false)
    } finally {
      releaseFirst.resolve()
      releaseSecond.resolve()
      await second
    }
    expect(await receipt()).toMatchObject({ dispatchQueued: true, receivedEventPublished: true, deliveryClaimToken: null })
    expect(publisher.mock.calls[0][stage === 'dispatch' ? 1 : 2].jobId
      ?? publisher.mock.calls[0][2].enqueue.jobId).toBe(
      publisher.mock.calls[1][stage === 'dispatch' ? 1 : 2].jobId ?? publisher.mock.calls[1][2].enqueue.jobId,
    )
  })

  it.each(['dispatch', 'received_event'])('keeps %s retryable after a deadline and late publication', async (stage) => {
    const entered = deferred()
    const release = deferred()
    const publisher = stage === 'dispatch' ? mockEnqueue : mockEmit
    publisher.mockImplementationOnce(async () => { entered.resolve(); await release.promise; return 'job-1' })
    const deliveryInput = { ...input, ...(stage === 'dispatch' ? { sourceKey: input.endpointId } : {}) }
    const startedAt = Date.now()
    const operation = receiveInboundWebhook(orm.em.fork(), deliveryInput)
    const outcome = operation.then(() => null, (error: unknown) => error)
    await within(entered.promise)
    try {
      await expect(within(orm.em.fork().getConnection().execute('select 1 as available'))).resolves.toEqual([{ available: 1 }])
      expect(await outcome).toEqual(expect.objectContaining({ message: expect.stringContaining('outcome is uncertain') }))
      expect(Date.now() - startedAt).toBeLessThan(6_500)
      expect(stage === 'dispatch' ? (await receipt()).dispatchQueued : (await receipt()).receivedEventPublished).toBe(false)
      expect((await receipt()).deliveryClaimToken).toBeNull()
      release.resolve()
      await new Promise((resolve) => setImmediate(resolve))
      expect(stage === 'dispatch' ? (await receipt()).dispatchQueued : (await receipt()).receivedEventPublished).toBe(false)
      await expect(receiveInboundWebhook(orm.em.fork(), deliveryInput)).resolves.toBe(false)
      expect(await receipt()).toMatchObject({ dispatchQueued: true, receivedEventPublished: true })
    } finally {
      release.resolve()
    }
  }, 10_000)

  const itWithRedis = process.env.OM_QUEUE_TEST_REDIS_URL ? it : it.skip
  itWithRedis('recovers twenty timed-out Redis deliveries without duplicate active or completed handlers', async () => {
    const redisUrl = process.env.OM_QUEUE_TEST_REDIS_URL!
    const queue = createQueue<InboundDispatchJob>(`webhook-recovery-${randomUUID()}`, 'async', {
      connection: { url: redisUrl }, concurrency: 2,
    })
    const entered = deferred()
    const release = deferred()
    const processed = deferred()
    let active = 0
    let peakActive = 0
    let executions = 0
    const unregister = registerWebhookHandler({
      meta: { source: input.endpointId, event: '*', id: 'receipt:test' },
      handler: async () => ({ default: async () => {
        active += 1
        peakActive = Math.max(peakActive, active)
        executions += 1
        entered.resolve()
        await release.promise
        active -= 1
      } }),
    })
    mockEnqueue.mockImplementation((job: InboundDispatchJob, options: { jobId: string; timeoutMs: number }) => queue.enqueue(job, options))
    const sourceInput = { ...input, sourceKey: input.endpointId }
    try {
      await queue.getJobCounts()
      execFileSync('redis-cli', ['-u', redisUrl, 'CLIENT', 'PAUSE', '6000', 'WRITE'])
      const deliveries = Array.from({ length: 20 }, () => receiveInboundWebhook(orm.em.fork(), sourceInput))
      const outcomes = Promise.allSettled(deliveries)
      await new Promise((resolve) => setTimeout(resolve, 100))
      await expect(within(orm.em.fork().getConnection().execute('select 1 as available'))).resolves.toEqual([{ available: 1 }])
      expect((await outcomes).filter((outcome) => outcome.status === 'rejected')).toHaveLength(20)
      expect(await receipt()).toMatchObject({ dispatchQueued: false, receivedEventPublished: false })
      execFileSync('redis-cli', ['-u', redisUrl, 'CLIENT', 'UNPAUSE'])
      await expect(receiveInboundWebhook(orm.em.fork(), sourceInput)).resolves.toBe(false)
      expect((await queue.getJobCounts()).waiting).toBe(1)
      await queue.process(async (job) => {
        await processInboundDispatchJob(orm.em.fork(), job.payload, { resolve: <Result,>() => undefined as Result })
        processed.resolve()
      })
      await within(entered.promise)
      await Promise.all(Array.from({ length: 8 }, () => receiveInboundWebhook(orm.em.fork(), sourceInput)))
      const savedJob = mockEnqueue.mock.calls[0][0] as InboundDispatchJob
      const savedOptions = mockEnqueue.mock.calls[0][1] as { jobId: string }
      await queue.enqueue(savedJob, savedOptions)
      expect(peakActive).toBe(1)
      expect(executions).toBe(1)
      release.resolve()
      await within(processed.promise)
      async function drain() {
        while (true) {
          const counts = await queue.getJobCounts()
          if (counts.waiting + counts.active === 0) return
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
      }
      await within(drain())
      await queue.enqueue(savedJob, savedOptions)
      await within(drain())
      expect(executions).toBe(1)
      expect(peakActive).toBe(1)
      expect(await orm.em.fork().findOneOrFail(WebhookIngestionEntity, { id: savedJob.ingestionId, tenantId, organizationId }))
        .toMatchObject({ status: 'processed', handlerCount: 1 })
    } finally {
      release.resolve()
      execFileSync('redis-cli', ['-u', redisUrl, 'CLIENT', 'UNPAUSE'])
      unregister()
      await queue.clear()
      await queue.close()
    }
  }, 15_000)

  it('adds nullable claim columns without changing historical completion flags', async () => {
    await receiveInboundWebhook(orm.em.fork(), input)
    const table = `"${schema}"."webhook_inbound_receipts"`
    await orm.schema.execute(`alter table ${table} drop column "delivery_claim_token", drop column "delivery_claim_stage", drop column "delivery_claim_expires_at"`)
    const migration = new Migration20261028234000_webhooks(orm.em.getDriver(), orm.config)
    await migration.up()
    for (const query of migration.getQueries()) {
      if (typeof query !== 'string') throw new Error('[internal] Expected SQL migration statement')
      await orm.schema.execute(query.replace('"webhook_inbound_receipts"', table))
    }
    expect(await receipt()).toMatchObject({ deliveryClaimToken: null, deliveryClaimStage: null, deliveryClaimExpiresAt: null,
      dispatchQueued: true, receivedEventPublished: true })
    await expect(receiveInboundWebhook(orm.em.fork(), input)).resolves.toBe(true)
    expect(mockEmit).toHaveBeenCalledTimes(1)
  })

  it('applies additive migration defaults to historical receipts without redispatching them', async () => {
    const em = orm.em.fork()
    em.persist(em.create(WebhookInboundReceiptEntity, {
      endpointId: input.endpointId,
      messageId: input.messageId,
      providerKey: input.providerKey,
      tenantId,
      organizationId,
      createdAt: new Date(),
    }))
    await em.flush()
    const table = `"${schema}"."webhook_inbound_receipts"`
    await orm.schema.execute(`alter table ${table} drop column "ingestion_id", drop column "dispatch_queued", drop column "received_event_published"`)
    const migration = new Migration20261018124142_webhooks(orm.em.getDriver(), orm.config)
    await migration.up()
    for (const query of migration.getQueries()) {
      if (typeof query !== 'string') throw new Error('Expected SQL migration statement')
      await orm.schema.execute(query.replace('"webhook_inbound_receipts"', table))
    }

    expect(await receipt()).toMatchObject({ ingestionId: null, dispatchQueued: true, receivedEventPublished: true })
    await expect(receiveInboundWebhook(orm.em.fork(), input)).resolves.toBe(true)
    expect(mockEnqueue).not.toHaveBeenCalled()
    expect(mockEmit).not.toHaveBeenCalled()
  })
})
