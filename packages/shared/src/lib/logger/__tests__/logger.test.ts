import pino from 'pino'
import {
  createLogger,
  getLogLevel,
  isLevelEnabled,
  registerLoggerExtension,
  resetLogLevelCache,
  resetLoggerExtension,
  resetLoggerRegistry,
} from '../index'
import { resolveLevel, type LogLevel } from '../level'
import { createConsoleLogger } from '../transport.console'
import { createPrettyLogger, resetLogPrettyCache, resolvePrettyMode } from '../transport.pretty'
import { resetServerLoggerCache } from '../transport.server'

type FakePinoCall = { level: LogLevel; args: unknown[] }

type FakePinoHarness = {
  factory: (options: Record<string, unknown>, destination?: unknown) => unknown
  calls: FakePinoCall[]
  childBindings: Record<string, unknown>[]
  options: () => Record<string, unknown> | null
  destination: () => unknown
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
  let recordedDestination: unknown
  return {
    factory: (options, destination) => {
      recordedOptions = options
      recordedDestination = destination
      return makeInstance()
    },
    calls,
    childBindings,
    options: () => recordedOptions,
    destination: () => recordedDestination,
  }
}

const TRACKED_ENV_KEYS = ['OM_LOG_LEVEL', 'NODE_ENV', 'NEXT_RUNTIME', 'OM_LOG_DESTINATION', 'OM_LOG_PRETTY'] as const

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
  resetLogPrettyCache()
  resetLoggerExtension()
}

function forcePinoTransport(): void {
  process.env.OM_LOG_PRETTY = 'false'
  resetLogPrettyCache()
  resetLoggerRegistry()
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

    it('uses the pino-backed server transport on a plain node runtime when pretty mode is off', () => {
      forcePinoTransport()
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

  describe('process-wide logger extension', () => {
    beforeEach(() => {
      forcePinoTransport()
    })

    it('keeps one local line and observes one correlated record with child bindings', () => {
      const fake = createFakePinoHarness()
      mockPinoLoader(fake.factory)
      const records: unknown[] = []
      registerLoggerExtension({
        enrich: () => ({ trace_id: 'trace-1', span_id: 'span-1' }),
        emit: (record) => records.push(record),
      })

      createLogger('orders')
        .child({ module: 'sales' })
        .info('Order placed', { orderId: 'o-1' })

      expect(fake.calls).toEqual([{
        level: 'info',
        args: [{
          orderId: 'o-1',
          trace_id: 'trace-1',
          span_id: 'span-1',
        }, 'Order placed'],
      }])
      expect(records).toHaveLength(1)
      expect(records[0]).toMatchObject({
        level: 'info',
        namespace: 'orders',
        message: 'Order placed',
        fields: {
          module: 'sales',
          orderId: 'o-1',
          trace_id: 'trace-1',
          span_id: 'span-1',
        },
      })
    })

    it('applies the shared level gate to local and remote output', () => {
      process.env.OM_LOG_LEVEL = 'warn'
      resetLogLevelCache()
      const fake = createFakePinoHarness()
      mockPinoLoader(fake.factory)
      const emit = jest.fn()
      registerLoggerExtension({ emit })
      const logger = createLogger('gated-extension')

      logger.info('quiet')
      logger.warn('visible')

      expect(fake.calls.map((call) => call.level)).toEqual(['warn'])
      expect(emit).toHaveBeenCalledTimes(1)
      expect(emit.mock.calls[0][0]).toMatchObject({ level: 'warn', message: 'visible' })
    })

    it('isolates extension failures from application logging', () => {
      const fake = createFakePinoHarness()
      mockPinoLoader(fake.factory)
      registerLoggerExtension({
        enrich: () => {
          throw new Error('context failed')
        },
        emit: () => {
          throw new Error('sink failed')
        },
      })

      expect(() => createLogger('resilient-extension').error('Still local')).not.toThrow()
      expect(fake.calls).toEqual([{ level: 'error', args: [{}, 'Still local'] }])
    })
  })

  describe('isomorphism', () => {
    beforeEach(() => {
      forcePinoTransport()
    })

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
    beforeEach(() => {
      forcePinoTransport()
    })

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

    it('writes to stdout by default (no destination passed to the pino factory)', () => {
      delete process.env.OM_LOG_DESTINATION
      const fake = createFakePinoHarness()
      mockPinoLoader(fake.factory)
      createLogger('dest-default-ns').info('hello')
      expect(fake.destination()).toBeUndefined()
    })

    it('passes process.stderr as the pino destination when OM_LOG_DESTINATION=stderr', () => {
      process.env.OM_LOG_DESTINATION = 'stderr'
      const fake = createFakePinoHarness()
      mockPinoLoader(fake.factory)
      createLogger('dest-stderr-ns').info('hello')
      expect(fake.destination()).toBe(process.stderr)
    })

    it('accepts case-insensitive and padded OM_LOG_DESTINATION tokens', () => {
      process.env.OM_LOG_DESTINATION = '  STDERR '
      const fake = createFakePinoHarness()
      mockPinoLoader(fake.factory)
      createLogger('dest-mixed-ns').info('hello')
      expect(fake.destination()).toBe(process.stderr)
    })

    it('falls back to the default destination for unrecognized OM_LOG_DESTINATION values', () => {
      process.env.OM_LOG_DESTINATION = 'banana'
      const fake = createFakePinoHarness()
      mockPinoLoader(fake.factory)
      createLogger('dest-junk-ns').info('hello')
      expect(fake.destination()).toBeUndefined()
    })
  })

  describe('server transport with real pino output', () => {
    beforeEach(() => {
      forcePinoTransport()
    })

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

  describe('pretty mode resolution', () => {
    it.each<[string, boolean]>([
      ['1', true],
      ['true', true],
      ['yes', true],
      ['on', true],
      ['0', false],
      ['false', false],
      ['off', false],
      ['  TRUE  ', true],
    ])('resolves OM_LOG_PRETTY=%s to %s regardless of NODE_ENV', (raw, expected) => {
      expect(resolvePrettyMode({ OM_LOG_PRETTY: raw, NODE_ENV: 'production' })).toBe(expected)
      expect(resolvePrettyMode({ OM_LOG_PRETTY: raw, NODE_ENV: 'development' })).toBe(expected)
    })

    it('defaults to on outside production and off in production when unset', () => {
      expect(resolvePrettyMode({ NODE_ENV: 'production' })).toBe(false)
      expect(resolvePrettyMode({ NODE_ENV: 'development' })).toBe(true)
      expect(resolvePrettyMode({ NODE_ENV: 'test' })).toBe(true)
      expect(resolvePrettyMode({})).toBe(true)
    })

    it('treats an unrecognized OM_LOG_PRETTY token as unset', () => {
      expect(resolvePrettyMode({ OM_LOG_PRETTY: 'banana', NODE_ENV: 'production' })).toBe(false)
      expect(resolvePrettyMode({ OM_LOG_PRETTY: 'banana', NODE_ENV: 'development' })).toBe(true)
    })
  })

  describe('pretty transport', () => {
    const PRETTY_LINE_PATTERN = /^\d{2}:\d{2}:\d{2}\.\d{3} /

    function captureStream(stream: NodeJS.WriteStream): string[] {
      const chunks: string[] = []
      jest.spyOn(stream, 'write').mockImplementation(((chunk: string) => {
        chunks.push(String(chunk))
        return true
      }) as typeof stream.write)
      return chunks
    }

    it('is selected on a plain node runtime in non-production without touching pino', () => {
      const builtinSpy = jest.spyOn(process, 'getBuiltinModule')
      const chunks = captureStream(process.stdout)
      createLogger('pretty-select-ns').info('hello', { queue: 'events' })
      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toMatch(PRETTY_LINE_PATTERN)
      expect(chunks[0]).toContain('INFO  [pretty-select-ns] hello queue=events')
      expect(builtinSpy).not.toHaveBeenCalledWith('node:module')
    })

    it('renders timestamp, padded level, namespace, message, and key=value fields', () => {
      const chunks = captureStream(process.stdout)
      createPrettyLogger('queue').info('Job completed', {
        queue: 'events',
        jobId: 'd3e13935-0ccb-4794-ba0a-030872b27fc0',
      })
      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toMatch(
        /^\d{2}:\d{2}:\d{2}\.\d{3} INFO {2}\[queue\] Job completed queue=events jobId=d3e13935-0ccb-4794-ba0a-030872b27fc0\n$/,
      )
    })

    it('folds a component binding into the namespace scope and drops it from the tail', () => {
      const chunks = captureStream(process.stdout)
      createPrettyLogger('events')
        .child({ component: 'stream', tenantId: 't-1' })
        .warn('Payload skipped', { maxBytes: 4096 })
      expect(chunks[0]).toContain('WARN  [events:stream] Payload skipped tenantId=t-1 maxBytes=4096')
      expect(chunks[0]).not.toContain('component=')
    })

    it('appends the stack on following lines when fields.err is an Error', () => {
      const chunks = captureStream(process.stdout)
      const failure = new Error('pretty kaboom')
      createPrettyLogger('err-ns').error('Handler error', { event: 'x.y.z', err: failure })
      expect(chunks).toHaveLength(1)
      const [firstLine, ...stackLines] = chunks[0].split('\n')
      expect(firstLine).toContain('ERROR [err-ns] Handler error event=x.y.z')
      expect(stackLines.join('\n')).toContain('pretty kaboom')
    })

    it('gates each method by the effective level', () => {
      process.env.OM_LOG_LEVEL = 'warn'
      resetLogLevelCache()
      const chunks = captureStream(process.stdout)
      const logger = createPrettyLogger('gating-ns')
      logger.debug('quiet')
      logger.info('quiet')
      logger.warn('loud')
      logger.error('loud')
      expect(chunks).toHaveLength(2)
      expect(chunks[0]).toContain('WARN  [gating-ns] loud')
      expect(chunks[1]).toContain('ERROR [gating-ns] loud')
    })

    it('writes to stderr when OM_LOG_DESTINATION=stderr', () => {
      process.env.OM_LOG_DESTINATION = 'stderr'
      const stdoutChunks = captureStream(process.stdout)
      const stderrChunks = captureStream(process.stderr)
      createPrettyLogger('stdio-ns').info('protocol-safe line', { jobId: 'j-1' })
      expect(stdoutChunks).toHaveLength(0)
      expect(stderrChunks).toHaveLength(1)
      expect(stderrChunks[0]).toContain('INFO  [stdio-ns] protocol-safe line jobId=j-1')
    })

    it('emits no ANSI codes when the stream is not a TTY', () => {
      const chunks = captureStream(process.stdout)
      createPrettyLogger('plain-ns').info('no colors')
      expect(chunks[0]).not.toContain('\x1b[')
    })

    it('colors the timestamp and level when the stream is a TTY', () => {
      const stdoutStream = process.stdout as { isTTY?: boolean }
      const originalIsTty = stdoutStream.isTTY
      stdoutStream.isTTY = true
      try {
        const chunks = captureStream(process.stdout)
        createPrettyLogger('tty-ns').error('colored failure')
        expect(chunks[0]).toContain('\x1b[31mERROR\x1b[0m')
        expect(chunks[0]).toContain('\x1b[2m')
      } finally {
        stdoutStream.isTTY = originalIsTty
      }
    })
  })
})
