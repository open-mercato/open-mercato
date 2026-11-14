import type { WebhookSourceConfig } from '@open-mercato/shared/lib/webhooks'

const enqueueInboundDispatch = jest.fn(async () => 'job-1')
const emitWebhooksEvent = jest.fn(async () => undefined)
const findWithDecryption = jest.fn()
const credentialsResolve = jest.fn(async (_integrationId: string, _scope: { tenantId: string; organizationId: string }) => ({ webhookSigningSecret: 'whsec' }))

const flush = jest.fn(async () => undefined)
const persist = jest.fn()
const em = {
  fork: () => em,
  create: (_entity: unknown, data: Record<string, unknown>) => ({ id: 'ing-1', ...data }),
  persist,
  flush,
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
}))
jest.mock('../../../../events', () => ({
  emitWebhooksEvent: (...args: unknown[]) => emitWebhooksEvent(...args),
}))
jest.mock('../../../../lib/queue', () => ({
  enqueueInboundDispatch: (...args: unknown[]) => enqueueInboundDispatch(...args),
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

beforeEach(() => {
  clearWebhookSources()
  enqueueInboundDispatch.mockClear()
  emitWebhooksEvent.mockClear()
  persist.mockClear()
  flush.mockReset()
  flush.mockResolvedValue(undefined)
  findWithDecryption.mockReset()
  findWithDecryption.mockResolvedValue([{ organizationId: 'o1', tenantId: 't1', sourceKey: 'stripe', isActive: true }])
  credentialsResolve.mockReset()
  credentialsResolve.mockResolvedValue({ webhookSigningSecret: 'whsec' })
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
    expect.objectContaining({ ingestionId: 'ing-1', sourceKey: 'stripe', eventType: 'payment_intent.succeeded', tenantId: 't1', organizationId: 'o1' }),
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

it('returns duplicate when the receipt unique constraint is violated', async () => {
  registerWebhookSource(makeSource())
  flush.mockRejectedValueOnce({ code: '23505' })
  const res = await postTo('stripe')
  expect(res.status).toBe(200)
  await expect(res.json()).resolves.toEqual({ ok: true, duplicate: true })
  expect(enqueueInboundDispatch).not.toHaveBeenCalled()
})

it('persists the scope selected by each source delivery own credentials', async () => {
  const scopes = [
    { tenantId: 'tenant-1', organizationId: 'org-1' },
    { tenantId: 'tenant-1', organizationId: 'org-2' },
    { tenantId: 'tenant-2', organizationId: 'org-1' },
  ]
  findWithDecryption.mockResolvedValue(scopes.map((scope) => ({ ...scope, sourceKey: 'stripe', isActive: true })))
  credentialsResolve.mockImplementation(async (_integrationId: string, scope: { tenantId: string; organizationId: string }) => ({
    webhookSigningSecret: `${scope.tenantId}:${scope.organizationId}`,
  }))
  registerWebhookSource(makeSource({
    verifier: async (request, credentials) => request.headers['x-test-signature'] === credentials.webhookSigningSecret,
  }))

  for (const scope of scopes) {
    const response = await postTo('stripe', undefined, {
      'x-test-signature': `${scope.tenantId}:${scope.organizationId}`,
    })
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({ endpointId: 'stripe', messageId: 'evt_1', ...scope }))
    expect(enqueueInboundDispatch).toHaveBeenLastCalledWith(expect.objectContaining(scope))
  }
  expect(enqueueInboundDispatch).toHaveBeenCalledTimes(scopes.length)
})
