import {
  matchAnyEventPattern,
  matchAnyWebhookEventPattern,
  matchEventPattern,
  matchWebhookEventPattern,
} from '../patterns'

describe('matchEventPattern', () => {
  describe('single-segment mode', () => {
    it('matches the global wildcard', () => {
      expect(matchEventPattern('customers.person.deleted', '*')).toBe(true)
    })

    it('matches exact events', () => {
      expect(matchEventPattern('customers.person.deleted', 'customers.person.deleted')).toBe(true)
    })

    it('matches only one segment for *', () => {
      expect(matchEventPattern('customers.person', 'customers.*')).toBe(true)
      expect(matchEventPattern('customers.person.deleted', 'customers.*')).toBe(false)
    })
  })

  describe('prefix mode', () => {
    it('matches namespace wildcards used by webhooks', () => {
      expect(matchEventPattern('customers.person.deleted', 'customers.*', { mode: 'prefix' })).toBe(true)
      expect(matchEventPattern('customers.company.updated', 'customers.*', { mode: 'prefix' })).toBe(true)
    })

    it('preserves suffix wildcard prefix matching', () => {
      expect(matchEventPattern('query_index.vectorize_one', 'query_index*', { mode: 'prefix' })).toBe(true)
    })

    it('does not match unrelated prefixes', () => {
      expect(matchEventPattern('catalog.product.deleted', 'customers.*', { mode: 'prefix' })).toBe(false)
    })
  })

  describe('collection helpers', () => {
    it('matches any event pattern from an iterable', () => {
      expect(matchAnyEventPattern('sales.order.created', ['catalog.*', 'sales.order.created'])).toBe(true)
      expect(matchAnyEventPattern('sales.order.created', ['catalog.*', 'customers.*'])).toBe(false)
    })

    it('provides webhook-specific prefix helpers', () => {
      expect(matchWebhookEventPattern('customers.person.deleted', 'customers.*')).toBe(true)
      expect(matchAnyWebhookEventPattern('query_index.vectorize_one', ['catalog.*', 'query_index*'])).toBe(true)
      expect(matchAnyWebhookEventPattern('sales.order.created', ['catalog.*', 'customers.*'])).toBe(false)
    })
  })
})
