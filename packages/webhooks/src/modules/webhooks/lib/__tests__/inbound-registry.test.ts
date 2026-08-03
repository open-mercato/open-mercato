import type {
  WebhookHandler,
  WebhookHandlerRegistryEntry,
  WebhookSourceConfig,
} from '@open-mercato/shared/lib/webhooks'
import {
  clearWebhookHandlers,
  clearWebhookSources,
  getWebhookSource,
  listWebhookHandlers,
  listWebhookSources,
  registerWebhookHandler,
  registerWebhookSource,
  resolveWebhookHandlers,
  setWebhookHandlers,
  setWebhookSources,
} from '../inbound-registry'

const noopHandler: WebhookHandler = async () => undefined

function makeSource(key: string): WebhookSourceConfig {
  return {
    key,
    label: key,
    verifier: async () => true,
    eventTypeExtractor: (body) => String((body as { type?: string }).type ?? ''),
  }
}

function makeEntry(source: string, event: string, id: string): WebhookHandlerRegistryEntry {
  return {
    meta: { source, event, id },
    handler: async () => ({ default: noopHandler }),
  }
}

beforeEach(() => {
  clearWebhookSources()
  clearWebhookHandlers()
})

describe('webhook source registry', () => {
  it('registers and resolves a source by key', () => {
    registerWebhookSource(makeSource('stripe'))
    expect(getWebhookSource('stripe')?.key).toBe('stripe')
    expect(getWebhookSource('missing')).toBeUndefined()
    expect(listWebhookSources()).toHaveLength(1)
  })

  it('unregister removes only the matching source instance', () => {
    const unregister = registerWebhookSource(makeSource('stripe'))
    registerWebhookSource(makeSource('resend'))
    unregister()
    expect(getWebhookSource('stripe')).toBeUndefined()
    expect(getWebhookSource('resend')?.key).toBe('resend')
  })

  it('setWebhookSources replaces the whole registry', () => {
    registerWebhookSource(makeSource('old'))
    setWebhookSources([makeSource('stripe'), makeSource('resend')])
    expect(getWebhookSource('old')).toBeUndefined()
    expect(listWebhookSources().map((s) => s.key).sort()).toEqual(['resend', 'stripe'])
  })
})

describe('resolveWebhookHandlers', () => {
  it('matches handlers by source key', () => {
    registerWebhookHandler(makeEntry('stripe', '*', 'a'))
    registerWebhookHandler(makeEntry('resend', '*', 'b'))
    const matched = resolveWebhookHandlers('stripe', 'payment_intent.succeeded')
    expect(matched.map((m) => m.meta.id)).toEqual(['a'])
  })

  it('supports exact, wildcard, and prefix-wildcard event patterns', () => {
    registerWebhookHandler(makeEntry('stripe', 'payment_intent.succeeded', 'exact'))
    registerWebhookHandler(makeEntry('stripe', 'payment_intent.*', 'prefix'))
    registerWebhookHandler(makeEntry('stripe', '*', 'all'))
    registerWebhookHandler(makeEntry('stripe', 'charge.refunded', 'other'))

    const matched = resolveWebhookHandlers('stripe', 'payment_intent.succeeded')
    expect(matched.map((m) => m.meta.id).sort()).toEqual(['all', 'exact', 'prefix'])
  })

  it('returns multiple handlers for the same source + event', () => {
    registerWebhookHandler(makeEntry('stripe', 'payment_intent.succeeded', 'h1'))
    registerWebhookHandler(makeEntry('stripe', 'payment_intent.succeeded', 'h2'))
    expect(resolveWebhookHandlers('stripe', 'payment_intent.succeeded')).toHaveLength(2)
  })

  it('returns no handlers when nothing matches', () => {
    registerWebhookHandler(makeEntry('stripe', 'charge.refunded', 'x'))
    expect(resolveWebhookHandlers('stripe', 'payment_intent.succeeded')).toEqual([])
    expect(resolveWebhookHandlers('paypal', 'charge.refunded')).toEqual([])
  })

  it('setWebhookHandlers replaces the whole handler registry', () => {
    registerWebhookHandler(makeEntry('stripe', '*', 'old'))
    setWebhookHandlers([makeEntry('resend', 'email.received', 'new')])
    expect(listWebhookHandlers().map((e) => e.meta.id)).toEqual(['new'])
    expect(resolveWebhookHandlers('resend', 'email.received').map((e) => e.meta.id)).toEqual(['new'])
  })
})
