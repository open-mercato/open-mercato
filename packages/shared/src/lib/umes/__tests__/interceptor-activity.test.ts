/* eslint-disable @typescript-eslint/no-require-imports */

// Set env before requiring the module so isDev is captured as true
const originalNodeEnv = process.env.NODE_ENV
process.env.NODE_ENV = 'development'

const {
  getInterceptorActivityEntries,
  clearInterceptorActivityEntries,
  logInterceptorActivity,
} = require('../interceptor-activity') as typeof import('../interceptor-activity')

afterAll(() => {
  process.env.NODE_ENV = originalNodeEnv
})

describe('interceptor-activity', () => {
  beforeEach(() => {
    clearInterceptorActivityEntries()
  })

  describe('logInterceptorActivity', () => {
    it('stores activity entries in dev mode', () => {
      logInterceptorActivity({
        interceptorId: 'test.interceptor',
        moduleId: 'test',
        route: 'customers/people',
        method: 'POST',
        result: 'blocked',
        durationMs: 5,
        timestamp: Date.now(),
        statusCode: 403,
        message: 'Access denied',
      })

      const entries = getInterceptorActivityEntries()
      expect(entries).toHaveLength(1)
      expect(entries[0].interceptorId).toBe('test.interceptor')
      expect(entries[0].result).toBe('blocked')
      expect(entries[0].statusCode).toBe(403)
    })

    it('accumulates multiple entries', () => {
      logInterceptorActivity({
        interceptorId: 'a', moduleId: 'mod', route: 'r', method: 'GET',
        result: 'allowed', durationMs: 1, timestamp: Date.now(),
      })
      logInterceptorActivity({
        interceptorId: 'b', moduleId: 'mod', route: 'r', method: 'POST',
        result: 'blocked', durationMs: 2, timestamp: Date.now(),
      })

      expect(getInterceptorActivityEntries()).toHaveLength(2)
    })
  })

  describe('clearInterceptorActivityEntries', () => {
    it('removes all entries', () => {
      logInterceptorActivity({
        interceptorId: 'x', moduleId: 'mod', route: 'r', method: 'GET',
        result: 'allowed', durationMs: 1, timestamp: Date.now(),
      })
      expect(getInterceptorActivityEntries()).toHaveLength(1)

      clearInterceptorActivityEntries()
      expect(getInterceptorActivityEntries()).toHaveLength(0)
    })
  })

  describe('getInterceptorActivityEntries', () => {
    it('returns empty array when no entries logged', () => {
      expect(getInterceptorActivityEntries()).toEqual([])
    })
  })
})
