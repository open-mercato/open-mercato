import type { EntityManager } from '@mikro-orm/postgresql'
import type { WebhookHandlerContext, WebhookHandlerPayload } from '@open-mercato/shared/lib/webhooks'

const findOneWithDecryption = jest.fn()
const emitWebhooksEvent = jest.fn(async () => undefined)

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryption(...args),
}))
jest.mock('../../events', () => ({
  emitWebhooksEvent: (...args: unknown[]) => emitWebhooksEvent(...args),
}))

import { processInboundDispatchJob, type InboundDispatchJob } from '../inbound-dispatch'
import {
  clearWebhookHandlers,
  registerWebhookHandler,
} from '../inbound-registry'

type IngestionRow = {
  id: string
  status: string
  payload: Record<string, unknown>
  headers: Record<string, string> | null
  handlerCount: number
  handlerResults: unknown
  processedAt: Date | null
  durationMs: number | null
  errorMessage: string | null
  tenantId: string
  organizationId: string
}

function makeIngestion(overrides: Partial<IngestionRow> = {}): IngestionRow {
  return {
    id: 'ing-1',
    status: 'received',
    payload: { id: 'evt_1', type: 'payment_intent.succeeded' },
    headers: { 'stripe-signature': 'sig' },
    handlerCount: 0,
    handlerResults: null,
    processedAt: null,
    durationMs: null,
    errorMessage: null,
    tenantId: 't1',
    organizationId: 'o1',
    ...overrides,
  }
}

const job: InboundDispatchJob = {
  ingestionId: 'ing-1',
  sourceKey: 'stripe',
  eventType: 'payment_intent.succeeded',
  tenantId: 't1',
  organizationId: 'o1',
}

const em = { flush: jest.fn(async () => undefined) } as unknown as EntityManager
const ctx: WebhookHandlerContext = { resolve: <T,>() => undefined as T }

beforeEach(() => {
  clearWebhookHandlers()
  findOneWithDecryption.mockReset()
  emitWebhooksEvent.mockClear()
  ;(em.flush as jest.Mock).mockClear()
})

it('runs all matching handlers and marks the ingestion processed', async () => {
  const ingestion = makeIngestion()
  findOneWithDecryption.mockResolvedValue(ingestion)
  const calls: string[] = []
  registerWebhookHandler({
    meta: { source: 'stripe', event: 'payment_intent.*', id: 'payments:a' },
    handler: async () => ({ default: async () => { calls.push('a') } }),
  })
  registerWebhookHandler({
    meta: { source: 'stripe', event: '*', id: 'audit:b' },
    handler: async () => ({ default: async () => { calls.push('b') } }),
  })

  await processInboundDispatchJob(em, job, ctx)

  expect(calls.sort()).toEqual(['a', 'b'])
  expect(ingestion.status).toBe('processed')
  expect(ingestion.handlerCount).toBe(2)
  expect(emitWebhooksEvent).toHaveBeenCalledWith(
    'webhooks.inbound.processed',
    expect.objectContaining({ ingestionId: 'ing-1', handlerCount: 2, failedCount: 0 }),
  )
})

it('isolates a failing handler, marks failed, and still runs the others', async () => {
  const ingestion = makeIngestion()
  findOneWithDecryption.mockResolvedValue(ingestion)
  const calls: string[] = []
  registerWebhookHandler({
    meta: { source: 'stripe', event: 'payment_intent.succeeded', id: 'payments:boom' },
    handler: async () => ({ default: async () => { throw new Error('handler exploded') } }),
  })
  registerWebhookHandler({
    meta: { source: 'stripe', event: '*', id: 'audit:ok' },
    handler: async () => ({ default: async () => { calls.push('ok') } }),
  })

  await processInboundDispatchJob(em, job, ctx)

  expect(calls).toEqual(['ok'])
  expect(ingestion.status).toBe('failed')
  expect(ingestion.errorMessage).toBe('1/2 handlers failed')
  expect(emitWebhooksEvent).toHaveBeenCalledWith(
    'webhooks.inbound.handler_failed',
    expect.objectContaining({ handlerId: 'payments:boom', errorMessage: 'handler exploded' }),
  )
})

it('is idempotent when the ingestion is already processed', async () => {
  findOneWithDecryption.mockResolvedValue(makeIngestion({ status: 'processed' }))
  const handler = jest.fn(async () => ({ default: async () => undefined }))
  registerWebhookHandler({ meta: { source: 'stripe', event: '*', id: 'x' }, handler })

  await processInboundDispatchJob(em, job, ctx)

  expect(handler).not.toHaveBeenCalled()
  expect(em.flush).not.toHaveBeenCalled()
  expect(emitWebhooksEvent).not.toHaveBeenCalled()
})

it('returns early when the ingestion is missing', async () => {
  findOneWithDecryption.mockResolvedValue(null)
  await processInboundDispatchJob(em, job, ctx)
  expect(em.flush).not.toHaveBeenCalled()
})

it('passes the handler the payload and headers from the ingestion, not from the job', async () => {
  const ingestion = makeIngestion({
    payload: { id: 'evt_from_row', type: 'payment_intent.succeeded' },
    headers: { 'stripe-signature': 'sig_from_row' },
  })
  findOneWithDecryption.mockResolvedValue(ingestion)
  const seen: WebhookHandlerPayload[] = []
  registerWebhookHandler({
    meta: { source: 'stripe', event: '*', id: 'audit:capture' },
    handler: async () => ({ default: async (payload: WebhookHandlerPayload) => { seen.push(payload) } }),
  })

  await processInboundDispatchJob(em, job, ctx)

  expect(seen).toHaveLength(1)
  expect(seen[0].data).toEqual({ id: 'evt_from_row', type: 'payment_intent.succeeded' })
  expect(seen[0].headers).toEqual({ 'stripe-signature': 'sig_from_row' })
})

it('re-runs only the handlers that did not already succeed when retried after a partial failure', async () => {
  const ingestion = makeIngestion({
    status: 'failed',
    handlerCount: 2,
    errorMessage: '1/2 handlers failed',
    handlerResults: [
      { handlerId: 'audit:ok', module: 'audit', status: 'success', durationMs: 3, startedAt: '2026-06-17T00:00:00.000Z' },
      { handlerId: 'payments:boom', module: 'payments', status: 'failed', errorMessage: 'handler exploded', durationMs: 1, startedAt: '2026-06-17T00:00:00.000Z' },
    ],
  })
  findOneWithDecryption.mockResolvedValue(ingestion)
  const calls: string[] = []
  registerWebhookHandler({
    meta: { source: 'stripe', event: '*', id: 'audit:ok' },
    handler: async () => ({ default: async () => { calls.push('audit:ok') } }),
  })
  registerWebhookHandler({
    meta: { source: 'stripe', event: 'payment_intent.succeeded', id: 'payments:boom' },
    handler: async () => ({ default: async () => { calls.push('payments:boom') } }),
  })

  await processInboundDispatchJob(em, job, ctx)

  expect(calls).toEqual(['payments:boom'])
  expect(ingestion.status).toBe('processed')
  expect(ingestion.errorMessage).toBeNull()
  expect(ingestion.handlerResults).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ handlerId: 'audit:ok', status: 'success' }),
      expect.objectContaining({ handlerId: 'payments:boom', status: 'success' }),
    ]),
  )
})
