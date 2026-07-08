import pino from 'pino'
import {
  createLogger,
  getLogLevel,
  isLevelEnabled,
  resetLogLevelCache,
  resetLoggerRegistry,
} from '../index'
import { resolveLevel, type LogLevel } from '../level'
import { createConsoleLogger } from '../transport.console'
import { resetServerLoggerCache } from '../transport.server'

type FakePinoCall = { level: LogLevel; args: unknown[] }

type FakePinoHarness = {
  factory: (options: Record<string, unknown>) => unknown
  calls: FakePinoCall[]
  childBindings: Record<string, unknown>[]
  options: () => Record<string, unknown> | null
}

function createFakePinoHarness(): FakePinoHarness {
  const calls: FakePinoCall[] = []
  const childBindings: Record<string, unknown>[] = []
  let recordedOptions: Record<string, unknown> | null = null
  const makeInstance = (): Record<string, unknown> => ({
    debug: (...args: unknown[]) => calls.push({ level: 'debug', args }),
    info: (...args: unknown[]) => calls.push({ level: 'info', args }),
    warn: (...args: unknown[]) => calls.push({ level: 'warn', args }),
    error: (...args: unknown[]) => calls.push({ level: 'error', args }),
    child: (bindings: Record<string, unknown>) => {
      childBindings.push(bindings)
      return makeInstance()
    },
  })
  return {
    factory: (options) => {
      recordedOptions = options
      return makeInstance()
    },
    calls,
    childBindings,
    options: () => recordedOptions,
  }
}

const TRACKED_ENV_KEYS = ['OM_LOG_LEVEL', 'NODE_ENV', 'NEXT_RUNTIME'] as const

const originalGetBuiltinModule = process.getBuiltinModule.bind(process)

function mockPinoLoader(factory: FakePinoHarness['factory']): jest.SpyInstance {
  return jest.spyOn(process, 'getBuiltinModule').mockImplementation(((id: string) => {
    if (id !== 'node:module') return originalGetBuiltinModule(id)
    return { createRequire: () => () => factory }
  }) as typeof process.getBuiltinModule)
}

function resetLoggerState(): void {
  resetLogLevelCache()
  resetLoggerRegistry()
  resetServerLoggerCache()
}

describe('structured logging facade', () => {
  let savedEnv: Record<string, string | undefined>

  beforeEach(() => {
    savedEnv = Object.fromEntries(TRACKED_ENV_KEYS.map((key) => [key, process.env[key]]))
    resetLoggerState()
  })

  afterEach(() => {
    for (const key of TRACKED_ENV_KEYS) {
      const value = savedEnv[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    delete (globalThis as { window?: unknown }).window
    jest.restoreAllMocks()
    resetLoggerState()
  })

  describe('level resolution', () => {
    it.each<[string, LogLevel]>([
      ['debug', 'debug'],
      ['info', 'info'],
      ['warn', 'warn'],
      ['error', 'error'],
      ['INFO', 'info'],
      ['  Warn  ', 'warn'],
      ['ERROR', 'error'],
    ])('resolves OM_LOG_LEVEL=%s to %s', (raw, expected) => {
      expect(resolveLevel({ OM_LOG_LEVEL: raw })).toBe(expected)
    })

    it('defaults to info in production and debug otherwise when OM_LOG_LEVEL is unset', () => {
      expect(resolveLevel({ NODE_ENV: 'production' })).toBe('info')
      expect(resolveLevel({ NODE_ENV: 'development' })).toBe('debug')
      expect(resolveLevel({ NODE_ENV: 'test' })).toBe('debug')
      expect(resolveLevel({})).toBe('debug')
    })

    it('treats blank OM_LOG_LEVEL as unset without warning', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
      expect(resolveLevel({ OM_LOG_LEVEL: '   ', NODE_ENV: 'production' })).toBe('info')
      expect(warnSpy).not.toHaveBeenCalled()
    })

    it('falls back to the NODE_ENV default and warns on a junk OM_LOG_LEVEL', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
      expect(resolveLevel({ OM_LOG_LEVEL: 'verbose', NODE_ENV: 'production' })).toBe('info')
      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(String(warnSpy.mock.calls[0][0])).toContain('OM_LOG_LEVEL')
      expect(String(warnSpy.mock.calls[0][0])).toContain('verbose')
    })

    it('warns exactly once for a junk value through the memoized getLogLevel path', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
      process.env.OM_LOG_LEVEL = 'chatty'
      resetLogLevelCache()
      expect(getLogLevel()).toBe('debug')
      getLogLevel()
      getLogLevel()
      expect(warnSpy).toHaveBeenCalledTimes(1)
    })

    it('memoizes the resolved level until the cache is reset', () => {
      process.env.OM_LOG_LEVEL = 'error'
      resetLogLevelCache()
      expect(getLogLevel()).toBe('error')
      process.env.OM_LOG_LEVEL = 'debug'
      expect(getLogLevel()).toBe('error')
      resetLogLevelCache()
      expect(getLogLevel()).toBe('debug')
    })

    it('answers isLevelEnabled from the numeric ordering', () => {
      process.env.OM_LOG_LEVEL = 'warn'
      resetLogLevelCache()
      expect(isLevelEnabled('debug')).toBe(false)
      expect(isLevelEnabled('info')).toBe(false)
      expect(isLevelEnabled('warn')).toBe(true)
      expect(isLevelEnabled('error')).toBe(true)
    })
  })

  describe('console transport', () => {
    it('gates each method by the effective level', () => {
      process.env.OM_LOG_LEVEL = 'warn'
      resetLogLevelCache()
      const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {})
      const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {})
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
      const logger = createConsoleLogger('gating')
      logger.debug('quiet')
      logger.info('quiet')
      logger.warn('loud')
      logger.error('loud')
      expect(debugSpy).not.toHaveBeenCalled()
      expect(infoSpy).not.toHaveBeenCalled()
      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(errorSpy).toHaveBeenCalledTimes(1)
    })

    it('prints the namespace prefix, message, and compact key=value bindings', () => {
      process.env.OM_LOG_LEVEL = 'debug'
      resetLogLevelCache()
      const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {})
      createConsoleLogger('events').info('Delivering to subscriber', {
        event: 'pos.cart.completed',
        matched: 3,
      })
      expect(infoSpy).toHaveBeenCalledWith('[events] Delivering to subscriber event=pos.cart.completed matched=3')
    })

    it('prints the stack when fields.err is an Error', () => {
      process.env.OM_LOG_LEVEL = 'debug'
      resetLogLevelCache()
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
      const failure = new Error('subscriber exploded')
      createConsoleLogger('events').error('Handler error', { event: 'x.y.z', err: failure })
      expect(errorSpy).toHaveBeenCalledWith('[events] Handler error event=x.y.z', failure.stack)
    })

    it('merges child bindings with child keys overriding parents across chains', () => {
      process.env.OM_LOG_LEVEL = 'debug'
      resetLogLevelCache()
      const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {})
      const grandchild = createConsoleLogger('ns')
        .child({ tenantId: 't-1', stage: 'parent' })
        .child({ stage: 'child', subscriberId: 's-1' })
      grandchild.info('line', { attempt: 2 })
      expect(infoSpy).toHaveBeenCalledWith('[ns] line tenantId=t-1 stage=child subscriberId=s-1 attempt=2')
    })
  })

  describe('transport selection', () => {
    it('uses the console transport when window is defined', () => {
      ;(globalThis as { window?: unknown }).window = {}
      const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {})
      const builtinSpy = jest.spyOn(process, 'getBuiltinModule')
      createLogger('browser-ns').info('hello')
      expect(infoSpy).toHaveBeenCalledWith('[browser-ns] hello')
      expect(builtinSpy).not.toHaveBeenCalledWith('node:module')
    })

    it('uses the console transport when NEXT_RUNTIME is edge', () => {
      process.env.NEXT_RUNTIME = 'edge'
      const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {})
      const builtinSpy = jest.spyOn(process, 'getBuiltinModule')
      createLogger('edge-ns').info('hello')
      expect(infoSpy).toHaveBeenCalledWith('[edge-ns] hello')
      expect(builtinSpy).not.toHaveBeenCalledWith('node:module')
    })

    it('uses the pino-backed server transport on a plain node runtime', () => {
      const fake = createFakePinoHarness()
      mockPinoLoader(fake.factory)
      const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {})
      createLogger('server-ns').info('hello')
      expect(fake.calls).toEqual([{ level: 'info', args: [{}, 'hello'] }])
      expect(infoSpy).not.toHaveBeenCalled()
    })

    it('reuses the same logger instance per namespace', () => {
      expect(createLogger('reuse-ns')).toBe(createLogger('reuse-ns'))
    })
  })

  describe('isomorphism', () => {
    it('does not touch pino at import time, only on the first server-side log call', () => {
      const fake = createFakePinoHarness()
      const builtinSpy = mockPinoLoader(fake.factory)
      jest.isolateModules(() => {
        const facade = require('../index') as typeof import('../index')
        expect(builtinSpy).not.toHaveBeenCalledWith('node:module')
        const logger = facade.createLogger('lazy-ns')
        expect(builtinSpy).not.toHaveBeenCalledWith('node:module')
        logger.info('first line')
        expect(builtinSpy).toHaveBeenCalledWith('node:module')
      })
    })

    it('falls back to the console transport when pino cannot be loaded', () => {
      jest.spyOn(process, 'getBuiltinModule').mockImplementation(((id: string) => {
        if (id !== 'node:module') return originalGetBuiltinModule(id)
        throw new Error('builtin unavailable')
      }) as typeof process.getBuiltinModule)
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
      createLogger('fallback-ns').warn('degraded', { reason: 'no-pino' })
      expect(warnSpy).toHaveBeenCalledWith('[fallback-ns] degraded reason=no-pino')
    })
  })

  describe('server transport delegation to pino', () => {
    it('reorders message-first facade calls into pino object-first calls', () => {
      const fake = createFakePinoHarness()
      mockPinoLoader(fake.factory)
      const logger = createLogger('reorder-ns')
      logger.info('order created', { tenantId: 't-1', orderId: 'o-2' })
      logger.warn('no fields')
      expect(fake.calls).toEqual([
        { level: 'info', args: [{ tenantId: 't-1', orderId: 'o-2' }, 'order created'] },
        { level: 'warn', args: [{}, 'no fields'] },
      ])
    })

    it('attaches the namespace as name and forwards child bindings to pino children', () => {
      const fake = createFakePinoHarness()
      mockPinoLoader(fake.factory)
      const child = createLogger('events').child({ event: 'pos.cart.completed' })
      child.debug('Delivering to subscriber', { subscriberId: 's-1' })
      expect(fake.childBindings).toEqual([
        { name: 'events', event: 'pos.cart.completed' },
      ])
      expect(fake.calls).toEqual([
        { level: 'debug', args: [{ subscriberId: 's-1' }, 'Delivering to subscriber'] },
      ])
    })

    it('configures the pino root with the resolved level and baseline redact paths', () => {
      process.env.OM_LOG_LEVEL = 'warn'
      resetLogLevelCache()
      const fake = createFakePinoHarness()
      mockPinoLoader(fake.factory)
      createLogger('config-ns').error('boom')
      const options = fake.options()
      expect(options?.level).toBe('warn')
      expect(options?.redact).toEqual({
        paths: expect.arrayContaining(['password', '*.password', 'token', '*.token', 'secret', '*.secret', 'authorization', '*.authorization', 'headers.authorization', 'req.headers.authorization']),
        censor: '[Redacted]',
      })
    })
  })

  describe('server transport with real pino output', () => {
    function captureRealPino(): string[] {
      const lines: string[] = []
      const destination = { write: (line: string) => { lines.push(line) } }
      jest.spyOn(process, 'getBuiltinModule').mockImplementation(((id: string) => {
        if (id !== 'node:module') return originalGetBuiltinModule(id)
        return {
          createRequire: () => () => (options: Record<string, unknown>) => pino(options, destination),
        }
      }) as typeof process.getBuiltinModule)
      return lines
    }

    it('emits structured JSON with top-level fields, never interpolated into msg', () => {
      const lines = captureRealPino()
      createLogger('json-ns')
        .child({ tenantId: 't-1' })
        .info('order created', { orderId: 'o-9' })
      expect(lines).toHaveLength(1)
      const entry = JSON.parse(lines[0]) as Record<string, unknown>
      expect(entry.name).toBe('json-ns')
      expect(entry.msg).toBe('order created')
      expect(entry.tenantId).toBe('t-1')
      expect(entry.orderId).toBe('o-9')
    })

    it('serializes fields.err through pino err serializer with the stack', () => {
      const lines = captureRealPino()
      const failure = new Error('kaboom-cause')
      createLogger('err-ns').error('Handler error', { event: 'x.y.z', err: failure })
      const entry = JSON.parse(lines[0]) as { err?: { type?: string; message?: string; stack?: string }; msg?: string; event?: string }
      expect(entry.msg).toBe('Handler error')
      expect(entry.event).toBe('x.y.z')
      expect(entry.err?.type).toBe('Error')
      expect(entry.err?.message).toBe('kaboom-cause')
      expect(entry.err?.stack).toContain('kaboom-cause')
    })

    it('redacts sensitive top-level and one-level-nested keys', () => {
      const lines = captureRealPino()
      createLogger('redact-ns').warn('credential touch', {
        token: 'top-secret',
        password: 'hunter2',
        user: { token: 'nested-secret', name: 'ada' },
        safeField: 'visible',
      })
      const entry = JSON.parse(lines[0]) as {
        token?: string
        password?: string
        user?: { token?: string; name?: string }
        safeField?: string
      }
      expect(entry.token).toBe('[Redacted]')
      expect(entry.password).toBe('[Redacted]')
      expect(entry.user?.token).toBe('[Redacted]')
      expect(entry.user?.name).toBe('ada')
      expect(entry.safeField).toBe('visible')
    })
  })
})
