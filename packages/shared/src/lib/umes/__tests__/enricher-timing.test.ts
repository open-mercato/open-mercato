/* eslint-disable @typescript-eslint/no-require-imports */

// Set env before requiring the module so isDev is captured as true
const originalNodeEnv = process.env.NODE_ENV
process.env.NODE_ENV = 'development'

const {
  getEnricherTimingEntries,
  clearEnricherTimingEntries,
  logEnricherTiming,
  withEnricherTiming,
} = require('../enricher-timing') as typeof import('../enricher-timing')

afterAll(() => {
  process.env.NODE_ENV = originalNodeEnv
})

describe('enricher-timing', () => {
  beforeEach(() => {
    clearEnricherTimingEntries()
  })

  describe('logEnricherTiming', () => {
    it('stores timing entries in dev mode', () => {
      logEnricherTiming('test.enricher', 'test', 'customers.person', 42)

      const entries = getEnricherTimingEntries()
      expect(entries).toHaveLength(1)
      expect(entries[0].enricherId).toBe('test.enricher')
      expect(entries[0].moduleId).toBe('test')
      expect(entries[0].targetEntity).toBe('customers.person')
      expect(entries[0].durationMs).toBe(42)
      expect(entries[0].timestamp).toBeGreaterThan(0)
    })

    it('accumulates multiple entries', () => {
      logEnricherTiming('a', 'mod-a', 'entity.a', 10)
      logEnricherTiming('b', 'mod-b', 'entity.b', 20)

      expect(getEnricherTimingEntries()).toHaveLength(2)
    })
  })

  describe('clearEnricherTimingEntries', () => {
    it('removes all entries', () => {
      logEnricherTiming('test.enricher', 'test', 'entity', 50)
      expect(getEnricherTimingEntries()).toHaveLength(1)

      clearEnricherTimingEntries()
      expect(getEnricherTimingEntries()).toHaveLength(0)
    })
  })

  describe('getEnricherTimingEntries', () => {
    it('returns empty array when no entries logged', () => {
      expect(getEnricherTimingEntries()).toEqual([])
    })
  })

  describe('withEnricherTiming', () => {
    it('measures and logs async function duration', async () => {
      const result = await withEnricherTiming('test.enricher', 'test', 'entity', async () => {
        return 'hello'
      })

      expect(result).toBe('hello')
      const entries = getEnricherTimingEntries()
      expect(entries).toHaveLength(1)
      expect(entries[0].enricherId).toBe('test.enricher')
      expect(entries[0].durationMs).toBeGreaterThanOrEqual(0)
    })

    it('logs timing even when function throws', async () => {
      await expect(
        withEnricherTiming('test.enricher', 'test', 'entity', async () => {
          throw new Error('fail')
        }),
      ).rejects.toThrow('fail')

      expect(getEnricherTimingEntries()).toHaveLength(1)
    })
  })
})
