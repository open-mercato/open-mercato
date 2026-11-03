import type { WebhookHandler } from '@open-mercato/shared/lib/webhooks'
import {
  registerWebhookHandlerEntries,
  registerWebhookSourceEntries,
} from '../module-webhook-registry'
import {
  clearWebhookHandlers,
  clearWebhookSources,
  listWebhookHandlers,
  listWebhookSources,
} from '../inbound-registry'

const noopHandler: WebhookHandler = async () => undefined

beforeEach(() => {
  clearWebhookSources()
  clearWebhookHandlers()
})

it('flattens module source entries into the source registry', () => {
  registerWebhookSourceEntries([
    {
      moduleId: 'gateway_stripe',
      sources: [
        { key: 'stripe', label: 'Stripe', verifier: async () => true, eventTypeExtractor: () => '' },
      ],
    },
    { moduleId: 'inbox_ops', sources: [
      { key: 'resend', label: 'Resend', verifier: async () => true, eventTypeExtractor: () => '' },
    ] },
  ])
  expect(listWebhookSources().map((s) => s.key).sort()).toEqual(['resend', 'stripe'])
})

it('flattens module handler entries into the handler registry', () => {
  registerWebhookHandlerEntries([
    {
      moduleId: 'gateway_stripe',
      handlers: [
        { meta: { source: 'stripe', event: 'payment_intent.succeeded', id: 'a' }, handler: async () => ({ default: noopHandler }) },
        { meta: { source: 'stripe', event: 'charge.refunded', id: 'b' }, handler: async () => ({ default: noopHandler }) },
      ],
    },
  ])
  expect(listWebhookHandlers().map((e) => e.meta.id).sort()).toEqual(['a', 'b'])
})

it('tolerates entries with no sources/handlers', () => {
  registerWebhookSourceEntries([{ moduleId: 'empty', sources: [] }])
  registerWebhookHandlerEntries([{ moduleId: 'empty', handlers: [] }])
  expect(listWebhookSources()).toEqual([])
  expect(listWebhookHandlers()).toEqual([])
})
