import { createLogger } from '@open-mercato/shared/lib/logger'
import { registerTelemetryRuntime, type TelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { isSearchDebugEnabled, reportSearchError, searchDebug, searchDebugWarn, searchWarn, searchError } from '../lib/debug'

jest.mock('@open-mercato/shared/lib/logger', () => {
  const mocked = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(),
  }
  mocked.child.mockImplementation(() => mocked)
  return { createLogger: jest.fn(() => mocked) }
})

const searchLoggerDebug = createLogger('search').debug as jest.Mock
const searchLoggerWarn = createLogger('search').warn as jest.Mock
const searchLoggerError = createLogger('search').error as jest.Mock
const searchLoggerChild = createLogger('search').child as jest.Mock

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
    searchLoggerDebug.mockClear()
    searchLoggerWarn.mockClear()
    searchLoggerError.mockClear()
    searchLoggerChild.mockClear()
  })

  afterAll(() => {
    restoreDebugEnv()
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

      searchDebug('search.test', 'suppressed')

      expect(searchLoggerDebug).not.toHaveBeenCalled()
    })

    it('logs message and payload when debug is enabled', () => {
      process.env.OM_SEARCH_DEBUG = 'true'
      const payload = { entityId: 'customers:person', recordId: 'rec-123' }

      searchDebug('search.test', 'indexed', payload)

      expect(searchLoggerChild).toHaveBeenCalledWith({ component: 'search.test' })
      expect(searchLoggerDebug).toHaveBeenCalledWith('indexed', payload)
    })

    it('logs only the message when payload is omitted', () => {
      process.env.OM_SEARCH_DEBUG = 'true'

      searchDebug('search.test', 'indexed')

      expect(searchLoggerDebug).toHaveBeenCalledWith('indexed', undefined)
    })
  })

  describe('searchDebugWarn', () => {
    it('does not warn when debug is disabled', () => {
      process.env.OM_SEARCH_DEBUG = 'false'

      searchDebugWarn('search.test', 'suppressed')

      expect(searchLoggerWarn).not.toHaveBeenCalled()
    })

    it('warns with the message and payload when enabled', () => {
      process.env.OM_SEARCH_DEBUG = 'yes'
      const payload = { queue: 'vector-indexing' }

      searchDebugWarn('search.test', 'retrying', payload)

      expect(searchLoggerWarn).toHaveBeenCalledWith('retrying', payload)
    })
  })

  describe('searchWarn', () => {
    it('always warns even when debug is disabled', () => {
      process.env.OM_SEARCH_DEBUG = 'false'
      const payload = { provider: 'ollama' }

      searchWarn('search.test', 'provider unreachable', payload)

      expect(searchLoggerWarn).toHaveBeenCalledWith('provider unreachable', payload)
    })
  })

  describe('searchError', () => {
    it('always logs errors even when debug is disabled', () => {
      process.env.OM_SEARCH_DEBUG = 'false'
      const payload = { error: 'boom' }

      searchError('search.test', 'failed', payload)

      expect(searchLoggerError).toHaveBeenCalledWith('failed', payload)
    })

    it('logs only the error message when payload is omitted', () => {
      delete process.env.OM_SEARCH_DEBUG

      searchError('search.test', 'failed')

      expect(searchLoggerError).toHaveBeenCalledWith('failed', undefined)
    })
  })

  describe('reportSearchError', () => {
    it('normalizes non-Error rejection values before reporting them', () => {
      const reportError = jest.fn()
      const unregister = registerTelemetryRuntime({ reportError } as unknown as TelemetryRuntime)
      try {
        const rejectedValue = { credentials: 'must-not-reach-telemetry' }

        reportSearchError('search.test', rejectedValue, 'search.test_failure')

        expect(reportError).toHaveBeenCalledWith(
          expect.objectContaining({ message: '[internal] Search failure rejected with a non-Error value' }),
          { module: 'search', code: 'search.test_failure', attributes: undefined },
        )
        expect(reportError.mock.calls[0][0]).not.toBe(rejectedValue)
      } finally {
        unregister()
      }
    })

    it('does not put non-Error telemetry failures into structured logs', () => {
      const telemetryFailure = { credentials: 'must-not-reach-logs' }
      const unregister = registerTelemetryRuntime({
        reportError: () => {
          throw telemetryFailure
        },
      } as unknown as TelemetryRuntime)
      try {
        reportSearchError('search.test', new Error('indexing failed'), 'search.test_failure')

        expect(searchLoggerWarn).toHaveBeenCalledWith('Telemetry error report failed', {
          code: 'search.test_failure',
          error: '[internal] Telemetry backend threw a non-Error value',
        })
        expect(searchLoggerWarn.mock.calls[0][1].error).not.toBe(telemetryFailure)
      } finally {
        unregister()
      }
    })
  })
})
