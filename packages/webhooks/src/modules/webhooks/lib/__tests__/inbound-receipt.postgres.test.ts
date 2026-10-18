import { randomUUID } from 'node:crypto'
import { MikroORM } from '@mikro-orm/postgresql'
import { WebhookIngestionEntity, WebhookInboundReceiptEntity } from '../../data/entities'
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
    await orm.schema.drop()
    await orm.close(true)
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
