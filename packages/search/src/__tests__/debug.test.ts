import { isSearchDebugEnabled, searchDebug, searchDebugWarn, searchError } from '../lib/debug'

describe('search debug utilities', () => {
  const originalDebugEnv = process.env.OM_SEARCH_DEBUG

  const restoreDebugEnv = () => {
    if (originalDebugEnv === undefined) {
      delete process.env.OM_SEARCH_DEBUG
      return
    }
    process.env.OM_SEARCH_DEBUG = originalDebugEnv
  }

  beforeEach(() => {
    restoreDebugEnv()
    jest.restoreAllMocks()
  })

  afterAll(() => {
    restoreDebugEnv()
    jest.restoreAllMocks()
  })

  describe('isSearchDebugEnabled', () => {
    it.each(['1', 'true', 'TRUE', 'Yes', 'on'])('returns true for %s', (value) => {
      process.env.OM_SEARCH_DEBUG = value

      expect(isSearchDebugEnabled()).toBe(true)
    })

    it.each([undefined, '', '0', 'false', 'no', 'off', 'debug'])('returns false for %s', (value) => {
      if (value === undefined) {
        delete process.env.OM_SEARCH_DEBUG
      } else {
        process.env.OM_SEARCH_DEBUG = value
      }

      expect(isSearchDebugEnabled()).toBe(false)
    })
  })

  describe('searchDebug', () => {
    it('does not log when debug is disabled', () => {
      delete process.env.OM_SEARCH_DEBUG
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

      searchDebug('search.test', 'suppressed')

      expect(consoleSpy).not.toHaveBeenCalled()
    })

    it('logs message and payload when debug is enabled', () => {
      process.env.OM_SEARCH_DEBUG = 'true'
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)
      const payload = { entityId: 'customers:person', recordId: 'rec-123' }

      searchDebug('search.test', 'indexed', payload)

      expect(consoleSpy).toHaveBeenCalledWith('[search.test] indexed', payload)
    })

    it('logs only the formatted message when payload is omitted', () => {
      process.env.OM_SEARCH_DEBUG = 'true'
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)

      searchDebug('search.test', 'indexed')

      expect(consoleSpy).toHaveBeenCalledWith('[search.test] indexed')
    })
  })

  describe('searchDebugWarn', () => {
    it('does not warn when debug is disabled', () => {
      process.env.OM_SEARCH_DEBUG = 'false'
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)

      searchDebugWarn('search.test', 'suppressed')

      expect(consoleSpy).not.toHaveBeenCalled()
    })

    it('warns with the formatted message and payload when enabled', () => {
      process.env.OM_SEARCH_DEBUG = 'yes'
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
      const payload = { queue: 'vector-indexing' }

      searchDebugWarn('search.test', 'retrying', payload)

      expect(consoleSpy).toHaveBeenCalledWith('[search.test] retrying', payload)
    })
  })

  describe('searchError', () => {
    it('always logs errors even when debug is disabled', () => {
      process.env.OM_SEARCH_DEBUG = 'false'
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
      const payload = { error: 'boom' }

      searchError('search.test', 'failed', payload)

      expect(consoleSpy).toHaveBeenCalledWith('[search.test] failed', payload)
    })

    it('logs only the formatted error message when payload is omitted', () => {
      delete process.env.OM_SEARCH_DEBUG
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)

      searchError('search.test', 'failed')

      expect(consoleSpy).toHaveBeenCalledWith('[search.test] failed')
    })
  })
})
