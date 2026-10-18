import { buildWebhookHeaders, verifyWebhookSignature, type WebhookSourceConfig } from '@open-mercato/shared/lib/webhooks'
import type { InboundDispatchJob } from '../../../../lib/inbound-dispatch'

const enqueueInboundDispatch = jest.fn(async (_job: InboundDispatchJob, _options?: { startLocalWorker?: boolean }) => 'job-1')
const ensureLocalInboundQueueWorkerStarted = jest.fn(async () => undefined)
const emitWebhooksEvent = jest.fn(async (..._args: unknown[]) => undefined)
const findWithDecryption = jest.fn()
const credentialsResolve = jest.fn(async () => ({ webhookSigningSecret: 'whsec' }))

const flush = jest.fn(async () => undefined)
type MockRecord = Record<string, unknown>
type MockEntityManager = {
  fork: () => MockEntityManager
  create: (entity: unknown, data: MockRecord) => MockRecord
  persist: (entity: MockRecord) => void
  flush: () => Promise<void>
  findOne: (entity: unknown, where: MockRecord) => Promise<MockRecord | null>
  transactional: <Result>(operation: (transaction: MockEntityManager) => Promise<Result>) => Promise<Result>
}

const records: MockRecord[] = []
let transactionOpen = false
const persist = jest.fn((entity: MockRecord) => {
  if (entity.endpointId && records.some((record) => (
    record.endpointId === entity.endpointId && record.messageId === entity.messageId
  ))) {
    throw { code: '23505' }
  }
  records.push(entity)
})
const em: MockEntityManager = {
  fork: () => em,
  create: (_entity: unknown, data: Record<string, unknown>) => ({ id: 'ing-1', ...data }),
  persist,
  flush,
  findOne: async (_entity, where) => (
    records.find((record) => Object.entries(where).every(([key, value]) => record[key] === value)) ?? null
  ),
  transactional: async (operation) => {
    const snapshot = structuredClone(records)
    transactionOpen = true
    try {
      const result = await operation(em)
      await flush()
      return result
    } catch (error) {
      records.splice(0, records.length, ...snapshot)
      throw error
    } finally {
      transactionOpen = false
    }
  },
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (name: string) => {
      if (name === 'em') return em
      if (name === 'integrationCredentialsService') return { resolve: credentialsResolve }
      throw new Error(`[internal] no mock for ${name}`)
    },
  }),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryption(...args),
  findOneWithDecryption: (manager: MockEntityManager, entity: unknown, where: MockRecord) => manager.findOne(entity, where),
}))
jest.mock('../../../../events', () => ({
  emitWebhooksEvent: (...args: unknown[]) => emitWebhooksEvent(...args),
}))
jest.mock('../../../../lib/queue', () => ({
  enqueueInboundDispatch: (job: InboundDispatchJob, options?: { startLocalWorker?: boolean }) => enqueueInboundDispatch(job, options),
  ensureLocalInboundQueueWorkerStarted: () => ensureLocalInboundQueueWorkerStarted(),
}))

import { POST } from '../route'
import { clearWebhookSources, registerWebhookSource } from '../../../../lib/inbound-registry'

function makeSource(overrides: Partial<WebhookSourceConfig> = {}): WebhookSourceConfig {
  return {
    key: 'stripe',
    label: 'Stripe',
    verifier: async () => true,
    eventTypeExtractor: (body) => String((body as { type?: string }).type ?? ''),
    messageIdExtractor: (body) => String((body as { id?: string }).id ?? ''),
    ...overrides,
  }
}

function postTo(
  endpointId: string,
  body = '{"type":"payment_intent.succeeded","id":"evt_1"}',
  headers: Record<string, string> = {},
) {
  const request = new Request(`http://localhost/api/webhooks/inbound/${endpointId}`, {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json', ...headers },
  })
  return POST(request, { params: Promise.resolve({ endpointId }) })
}

function signedSourceWebhook() {
  const body = '{"type":"payment_intent.succeeded","id":"evt_1"}'
  const secret = `whsec_${Buffer.from('inbound-receipt-test-secret').toString('base64')}`
  const headers = buildWebhookHeaders('evt_1', Math.floor(Date.now() / 1000), body, secret)
  const verifier = jest.fn(async (request: Parameters<WebhookSourceConfig['verifier']>[0]) => (
    verifyWebhookSignature(
      request.headers['webhook-id'],
      request.headers['webhook-timestamp'],
      request.body,
      request.headers['webhook-signature'],
      [secret],
    ).valid
  ))
  registerWebhookSource(makeSource({ verifier }))
  return { verifier, post: () => postTo('stripe', body, headers) }
}

beforeEach(() => {
  clearWebhookSources()
  records.length = 0
  transactionOpen = false
  enqueueInboundDispatch.mockReset()
  enqueueInboundDispatch.mockResolvedValue('job-1')
  ensureLocalInboundQueueWorkerStarted.mockReset()
  ensureLocalInboundQueueWorkerStarted.mockResolvedValue(undefined)
  emitWebhooksEvent.mockReset()
  emitWebhooksEvent.mockResolvedValue(undefined)
  persist.mockClear()
  flush.mockReset()
  flush.mockResolvedValue(undefined)
  findWithDecryption.mockReset()
  findWithDecryption.mockResolvedValue([{ organizationId: 'o1', tenantId: 't1', sourceKey: 'stripe', isActive: true }])
  credentialsResolve.mockClear()
})

it('returns 404 when neither a source nor an adapter matches the segment', async () => {
  const res = await postTo('totally-unknown')
  expect(res.status).toBe(404)
})

it('accepts a valid source webhook: records ingestion, enqueues dispatch, emits received', async () => {
  registerWebhookSource(makeSource({ verifier: async () => true }))
  const res = await postTo('stripe')
  expect(res.status).toBe(200)
  await expect(res.json()).resolves.toEqual({ ok: true })
  expect(enqueueInboundDispatch).toHaveBeenCalledWith(
    expect.objectContaining({ ingestionId: expect.any(String), sourceKey: 'stripe', eventType: 'payment_intent.succeeded', tenantId: 't1', organizationId: 'o1' }),
    { startLocalWorker: false },
  )
  expect(emitWebhooksEvent).toHaveBeenCalledWith(
    'webhooks.inbound.received',
    expect.objectContaining({ endpointId: 'stripe', eventType: 'payment_intent.succeeded' }),
    { persistent: true },
  )
})

it('rejects a stale source webhook before signature verification or persistence', async () => {
  const verifier = jest.fn(async () => true)
  registerWebhookSource(makeSource({ verifier }))

  const res = await postTo('stripe', undefined, { 'webhook-timestamp': '1' })

  expect(res.status).toBe(400)
  await expect(res.json()).resolves.toEqual({ error: 'Webhook timestamp is outside the allowed replay window' })
  expect(verifier).not.toHaveBeenCalled()
  expect(findWithDecryption).not.toHaveBeenCalled()
  expect(persist).not.toHaveBeenCalled()
  expect(flush).not.toHaveBeenCalled()
  expect(enqueueInboundDispatch).not.toHaveBeenCalled()
  expect(emitWebhooksEvent).not.toHaveBeenCalled()
})

it('rejects an oversized source webhook before verification or persistence', async () => {
  const verifier = jest.fn(async () => true)
  registerWebhookSource(makeSource({ verifier }))
  const request = new Request('http://localhost/api/webhooks/inbound/stripe', {
    method: 'POST',
    body: '{}',
    headers: {
      'content-length': String(1024 * 1024 + 1),
      'content-type': 'application/json',
    },
  })

  const response = await POST(request, { params: Promise.resolve({ endpointId: 'stripe' }) })

  expect(response.status).toBe(413)
  expect(verifier).not.toHaveBeenCalled()
  expect(findWithDecryption).not.toHaveBeenCalled()
  expect(persist).not.toHaveBeenCalled()
  expect(enqueueInboundDispatch).not.toHaveBeenCalled()
})

it('rejects with 401 when no candidate scope verifies', async () => {
  registerWebhookSource(makeSource({ verifier: async () => false }))
  const res = await postTo('stripe')
  expect(res.status).toBe(401)
  expect(enqueueInboundDispatch).not.toHaveBeenCalled()
})

it('returns duplicate for a historical receipt whose dispatch was already complete', async () => {
  registerWebhookSource(makeSource())
  ensureLocalInboundQueueWorkerStarted.mockRejectedValueOnce(new Error('[internal] Worker unavailable'))
  records.push({
    endpointId: 'stripe',
    messageId: 'evt_1',
    providerKey: 'stripe',
    tenantId: 't1',
    organizationId: 'o1',
    ingestionId: null,
    dispatchQueued: true,
    receivedEventPublished: true,
  })
  const res = await postTo('stripe')
  expect(res.status).toBe(200)
  await expect(res.json()).resolves.toEqual({ ok: true, duplicate: true })
  expect(enqueueInboundDispatch).not.toHaveBeenCalled()
  expect(emitWebhooksEvent).not.toHaveBeenCalled()
  expect(ensureLocalInboundQueueWorkerStarted).not.toHaveBeenCalled()
})

it('retries dispatch for the same signed source message after enqueue failure', async () => {
  const signed = signedSourceWebhook()
  enqueueInboundDispatch.mockRejectedValueOnce(new Error('[internal] Dispatch queue unavailable'))

  await expect(signed.post()).rejects.toThrow('Dispatch queue unavailable')

  expect(emitWebhooksEvent).not.toHaveBeenCalled()
  expect(records).toHaveLength(2)
  const pendingReceipt = structuredClone(records.find((record) => record.endpointId === 'stripe'))
  const ingestionId = enqueueInboundDispatch.mock.calls[0][0].ingestionId
  const response = await signed.post()

  await expect(response.json()).resolves.toEqual({ ok: true })
  expect(pendingReceipt).toEqual(expect.objectContaining({ dispatchQueued: false, receivedEventPublished: false }))
  expect(enqueueInboundDispatch).toHaveBeenCalledTimes(2)
  expect(enqueueInboundDispatch.mock.calls[1][0]).toEqual(expect.objectContaining({ ingestionId }))
  expect(emitWebhooksEvent).toHaveBeenCalledTimes(1)
  expect(signed.verifier).toHaveBeenCalledTimes(2)
  expect(records).toHaveLength(2)

  const duplicate = await signed.post()
  await expect(duplicate.json()).resolves.toEqual({ ok: true, duplicate: true })
  expect(enqueueInboundDispatch).toHaveBeenCalledTimes(2)
  expect(emitWebhooksEvent).toHaveBeenCalledTimes(1)
})

it('retries source publication without reenqueuing a dispatch that already succeeded', async () => {
  const signed = signedSourceWebhook()
  emitWebhooksEvent.mockRejectedValueOnce(new Error('[internal] Event queue unavailable'))

  await expect(signed.post()).rejects.toThrow('Event queue unavailable')

  const pendingReceipt = structuredClone(records.find((record) => record.endpointId === 'stripe'))
  const response = await signed.post()

  await expect(response.json()).resolves.toEqual({ ok: true })
  expect(pendingReceipt).toEqual(expect.objectContaining({ dispatchQueued: true, receivedEventPublished: false }))
  expect(enqueueInboundDispatch).toHaveBeenCalledTimes(1)
  expect(emitWebhooksEvent).toHaveBeenCalledTimes(2)
  expect(emitWebhooksEvent.mock.calls[1]).toEqual(emitWebhooksEvent.mock.calls[0])
  expect(signed.verifier).toHaveBeenCalledTimes(2)
  expect(records).toHaveLength(2)

  const duplicate = await signed.post()
  await expect(duplicate.json()).resolves.toEqual({ ok: true, duplicate: true })
  expect(enqueueInboundDispatch).toHaveBeenCalledTimes(1)
  expect(emitWebhooksEvent).toHaveBeenCalledTimes(2)
})

it('starts the local worker after the queued checkpoint commits and retries startup without reenqueuing', async () => {
  const signed = signedSourceWebhook()
  ensureLocalInboundQueueWorkerStarted.mockImplementationOnce(async () => {
    expect(transactionOpen).toBe(false)
    expect(records.find((record) => record.endpointId === 'stripe')).toEqual(expect.objectContaining({
      dispatchQueued: true,
      receivedEventPublished: false,
    }))
    throw new Error('[internal] Worker startup unavailable')
  })

  await expect(signed.post()).rejects.toThrow('Worker startup unavailable')

  expect(enqueueInboundDispatch).toHaveBeenCalledTimes(1)
  expect(emitWebhooksEvent).not.toHaveBeenCalled()
  const response = await signed.post()

  await expect(response.json()).resolves.toEqual({ ok: true })
  expect(ensureLocalInboundQueueWorkerStarted).toHaveBeenCalledTimes(2)
  expect(enqueueInboundDispatch).toHaveBeenCalledTimes(1)
  expect(emitWebhooksEvent).toHaveBeenCalledTimes(1)
  expect(records).toHaveLength(2)
})

it('rolls back receipt and ingestion together if initial persistence fails', async () => {
  const signed = signedSourceWebhook()
  flush.mockRejectedValueOnce(new Error('[internal] Intake transaction failed'))

  await expect(signed.post()).rejects.toThrow('Intake transaction failed')

  expect(records).toHaveLength(0)
  expect(enqueueInboundDispatch).not.toHaveBeenCalled()
  expect(emitWebhooksEvent).not.toHaveBeenCalled()

  const response = await signed.post()
  await expect(response.json()).resolves.toEqual({ ok: true })
  expect(records).toHaveLength(2)
  expect(enqueueInboundDispatch).toHaveBeenCalledTimes(1)
})

it('rejects a source receipt collision from another scope without creating an orphan ingestion', async () => {
  const signed = signedSourceWebhook()
  records.push({
    endpointId: 'stripe',
    messageId: 'evt_1',
    providerKey: 'stripe',
    tenantId: 'another-tenant',
    organizationId: 'another-org',
    ingestionId: 'another-ingestion',
    dispatchQueued: false,
    receivedEventPublished: false,
  })

  await expect(signed.post()).rejects.toThrow('Inbound receipt not found in verified scope')

  expect(records).toHaveLength(1)
  expect(records[0]).toEqual(expect.objectContaining({ tenantId: 'another-tenant', dispatchQueued: false }))
  expect(enqueueInboundDispatch).not.toHaveBeenCalled()
  expect(emitWebhooksEvent).not.toHaveBeenCalled()
})
