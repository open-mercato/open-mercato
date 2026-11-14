import {
  createLogger, registerLoggerExtension, resetLoggerExtension, resetLoggerRegistry,
  resetLogLevelCache, type LoggerExtensionRecord,
} from '../index'

describe('call-scoped logger presentation', () => {
  const previousLevel = process.env.OM_LOG_LEVEL
  afterEach(() => {
    if (previousLevel === undefined) delete process.env.OM_LOG_LEVEL
    else process.env.OM_LOG_LEVEL = previousLevel
    resetLogLevelCache()
    resetLoggerExtension()
    resetLoggerRegistry()
    jest.restoreAllMocks()
  })

  it('preserves enriched remote records and child bindings without changing the cached logger', () => {
    const defaults = createLogger('scoped')
    const local: LoggerExtensionRecord[] = []
    const remote: LoggerExtensionRecord[] = []
    registerLoggerExtension({ enrich: () => ({ traceId: 'trace-example' }), emit: record => remote.push(record) })
    const scoped = createLogger('scoped', { write: record => local.push(record) })
    const error = new Error('fixture failed')
    scoped.child({ runId: 'run-example' }).error('Application error reported', { err: error })
    expect(local).toHaveLength(1)
    expect(remote).toHaveLength(1)
    expect(local[0]).toMatchObject({
      namespace: 'scoped', level: 'error', message: 'Application error reported',
      fields: { runId: 'run-example', traceId: 'trace-example', err: error },
    })
    expect(remote[0].fields).toEqual(local[0].fields)
    expect(createLogger('scoped')).toBe(defaults)
    expect(scoped).not.toBe(defaults)
  })

  it('retains level gating for the scoped local output and remote extension', () => {
    process.env.OM_LOG_LEVEL = 'warn'
    resetLogLevelCache()
    const write = jest.fn()
    const remote = jest.fn()
    registerLoggerExtension({ emit: remote })
    const scoped = createLogger('scoped-level', { write })
    scoped.info('hidden')
    scoped.warn('visible')
    expect(write).toHaveBeenCalledTimes(1)
    expect(remote).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0][0].message).toBe('visible')
  })

  it('still delivers the remote record when a local presenter throws', () => {
    const remote = jest.fn()
    registerLoggerExtension({ emit: remote })
    jest.spyOn(console, 'error').mockImplementation()
    const scoped = createLogger('scoped-failure', { write: () => { throw new Error('presenter failed') } })
    expect(() => scoped.error('original error')).not.toThrow()
    expect(remote).toHaveBeenCalledWith(expect.objectContaining({ message: 'original error' }))
  })
})
