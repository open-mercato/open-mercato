describe('telemetry instrumentation bootstrap', () => {
  const originalBackend = process.env.TELEMETRY_BACKEND
  const originalNextPhase = process.env.NEXT_PHASE
  const originalNextRuntime = process.env.NEXT_RUNTIME

  afterEach(() => {
    jest.resetModules()
    jest.restoreAllMocks()
    jest.dontMock('@open-mercato/telemetry/nextjs')
    if (originalBackend === undefined) delete process.env.TELEMETRY_BACKEND
    else process.env.TELEMETRY_BACKEND = originalBackend
    if (originalNextPhase === undefined) delete process.env.NEXT_PHASE
    else process.env.NEXT_PHASE = originalNextPhase
    if (originalNextRuntime === undefined) delete process.env.NEXT_RUNTIME
    else process.env.NEXT_RUNTIME = originalNextRuntime
  })

  it('writes only the safe bootstrap message to stderr before exiting', async () => {
    const bootstrapFailure = new Error('safe OTLP dependency remediation')
    Object.defineProperty(bootstrapFailure, 'cause', {
      value: new Error('private module path with token=secret-value'),
    })
    jest.doMock('@open-mercato/telemetry/nextjs', () => ({
      registerTelemetryForNextjs: jest.fn(async () => {
        throw bootstrapFailure
      }),
    }))
    const stderrWrite = jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const interceptedExit = new Error('process exit intercepted')
    const exit = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw interceptedExit
    })
    process.env.NEXT_RUNTIME = 'nodejs'
    process.env.NEXT_PHASE = 'phase-production-build'
    process.env.TELEMETRY_BACKEND = 'otlp'
    const { register } = await import('../instrumentation')

    await expect(register()).rejects.toBe(interceptedExit)

    expect(stderrWrite).toHaveBeenCalledWith('safe OTLP dependency remediation\n')
    expect(stderrWrite).not.toHaveBeenCalledWith(expect.stringContaining('secret-value'))
    expect(exit).toHaveBeenCalledWith(1)
  })
})
