import {
  registerResponseEnrichers,
  getResponseEnrichers,
  getEnrichersForEntity,
} from '../enricher-registry'
import type { ResponseEnricher } from '../response-enricher'

function makeEnricher(overrides: Partial<ResponseEnricher> & { id: string; targetEntity: string }): ResponseEnricher {
  return {
    priority: 0,
    async enrichOne(record) {
      return record
    },
    ...overrides,
  }
}

beforeEach(() => {
  registerResponseEnrichers([])
})

describe('enricher-registry', () => {
  describe('getEnrichersForEntity — no selector (backward compat)', () => {
    it('returns all enrichers for the target entity', () => {
      registerResponseEnrichers([
        {
          moduleId: 'mod-a',
          enrichers: [
            makeEnricher({ id: 'a.tier', targetEntity: 'customers.person', priority: 10 }),
            makeEnricher({ id: 'a.other', targetEntity: 'sales.order', priority: 5 }),
          ],
        },
      ])

      const result = getEnrichersForEntity('customers.person')
      expect(result).toHaveLength(1)
      expect(result[0].enricher.id).toBe('a.tier')
    })

    it('returns enrichers regardless of queryEngine config', () => {
      registerResponseEnrichers([
        {
          moduleId: 'mod-a',
          enrichers: [
            makeEnricher({ id: 'a.api-only', targetEntity: 'customers.person' }),
            makeEnricher({
              id: 'a.query-enabled',
              targetEntity: 'customers.person',
              queryEngine: { enabled: true },
            }),
          ],
        },
      ])

      const result = getEnrichersForEntity('customers.person')
      expect(result).toHaveLength(2)
    })
  })

  describe('getEnrichersForEntity — api-response surface', () => {
    it('returns all enrichers (same as no selector)', () => {
      registerResponseEnrichers([
        {
          moduleId: 'mod-a',
          enrichers: [
            makeEnricher({ id: 'a.api-only', targetEntity: 'customers.person' }),
            makeEnricher({
              id: 'a.query-enabled',
              targetEntity: 'customers.person',
              queryEngine: { enabled: true },
            }),
          ],
        },
      ])

      const result = getEnrichersForEntity('customers.person', { surface: 'api-response' })
      expect(result).toHaveLength(2)
    })
  })

  describe('getEnrichersForEntity — query-engine surface', () => {
    it('excludes enrichers without queryEngine config', () => {
      registerResponseEnrichers([
        {
          moduleId: 'mod-a',
          enrichers: [
            makeEnricher({ id: 'a.api-only', targetEntity: 'customers.person' }),
            makeEnricher({
              id: 'a.query-enabled',
              targetEntity: 'customers.person',
              queryEngine: { enabled: true },
            }),
          ],
        },
      ])

      const result = getEnrichersForEntity('customers.person', { surface: 'query-engine' })
      expect(result).toHaveLength(1)
      expect(result[0].enricher.id).toBe('a.query-enabled')
    })

    it('excludes enrichers with queryEngine.enabled === false', () => {
      registerResponseEnrichers([
        {
          moduleId: 'mod-a',
          enrichers: [
            makeEnricher({
              id: 'a.disabled',
              targetEntity: 'customers.person',
              queryEngine: { enabled: false },
            }),
            makeEnricher({
              id: 'a.enabled',
              targetEntity: 'customers.person',
              queryEngine: { enabled: true },
            }),
          ],
        },
      ])

      const result = getEnrichersForEntity('customers.person', { surface: 'query-engine' })
      expect(result).toHaveLength(1)
      expect(result[0].enricher.id).toBe('a.enabled')
    })

    it('filters by engine type when specified', () => {
      registerResponseEnrichers([
        {
          moduleId: 'mod-a',
          enrichers: [
            makeEnricher({
              id: 'a.basic-only',
              targetEntity: 'customers.person',
              queryEngine: { enabled: true, engines: ['basic'] },
            }),
            makeEnricher({
              id: 'a.hybrid-only',
              targetEntity: 'customers.person',
              queryEngine: { enabled: true, engines: ['hybrid'] },
            }),
            makeEnricher({
              id: 'a.both',
              targetEntity: 'customers.person',
              queryEngine: { enabled: true, engines: ['basic', 'hybrid'] },
            }),
          ],
        },
      ])

      const basicResult = getEnrichersForEntity('customers.person', {
        surface: 'query-engine',
        engine: 'basic',
      })
      expect(basicResult.map((e) => e.enricher.id)).toEqual(['a.basic-only', 'a.both'])

      const hybridResult = getEnrichersForEntity('customers.person', {
        surface: 'query-engine',
        engine: 'hybrid',
      })
      expect(hybridResult.map((e) => e.enricher.id)).toEqual(['a.hybrid-only', 'a.both'])
    })

    it('returns all query-enabled enrichers when no engine filter is specified', () => {
      registerResponseEnrichers([
        {
          moduleId: 'mod-a',
          enrichers: [
            makeEnricher({
              id: 'a.basic-only',
              targetEntity: 'customers.person',
              queryEngine: { enabled: true, engines: ['basic'] },
            }),
            makeEnricher({
              id: 'a.hybrid-only',
              targetEntity: 'customers.person',
              queryEngine: { enabled: true, engines: ['hybrid'] },
            }),
          ],
        },
      ])

      const result = getEnrichersForEntity('customers.person', { surface: 'query-engine' })
      expect(result).toHaveLength(2)
    })

    it('treats empty engines array as "both" (no filtering)', () => {
      registerResponseEnrichers([
        {
          moduleId: 'mod-a',
          enrichers: [
            makeEnricher({
              id: 'a.empty-engines',
              targetEntity: 'customers.person',
              queryEngine: { enabled: true, engines: [] },
            }),
          ],
        },
      ])

      const result = getEnrichersForEntity('customers.person', {
        surface: 'query-engine',
        engine: 'basic',
      })
      expect(result).toHaveLength(1)
    })

    it('treats undefined engines as "both" (no filtering)', () => {
      registerResponseEnrichers([
        {
          moduleId: 'mod-a',
          enrichers: [
            makeEnricher({
              id: 'a.no-engines',
              targetEntity: 'customers.person',
              queryEngine: { enabled: true },
            }),
          ],
        },
      ])

      const result = getEnrichersForEntity('customers.person', {
        surface: 'query-engine',
        engine: 'hybrid',
      })
      expect(result).toHaveLength(1)
    })

    it('preserves priority ordering', () => {
      registerResponseEnrichers([
        {
          moduleId: 'mod-a',
          enrichers: [
            makeEnricher({
              id: 'a.low',
              targetEntity: 'customers.person',
              priority: 10,
              queryEngine: { enabled: true },
            }),
            makeEnricher({
              id: 'a.high',
              targetEntity: 'customers.person',
              priority: 80,
              queryEngine: { enabled: true },
            }),
          ],
        },
      ])

      const result = getEnrichersForEntity('customers.person', { surface: 'query-engine' })
      expect(result.map((e) => e.enricher.id)).toEqual(['a.high', 'a.low'])
    })
  })

  describe('getResponseEnrichers', () => {
    it('returns empty array when nothing registered', () => {
      expect(getResponseEnrichers()).toEqual([])
    })

    it('returns all enrichers sorted by priority descending', () => {
      registerResponseEnrichers([
        {
          moduleId: 'mod-a',
          enrichers: [
            makeEnricher({ id: 'a.low', targetEntity: 'x', priority: 5 }),
            makeEnricher({ id: 'a.high', targetEntity: 'x', priority: 50 }),
          ],
        },
      ])

      const result = getResponseEnrichers()
      expect(result.map((e) => e.enricher.id)).toEqual(['a.high', 'a.low'])
    })
  })
})
