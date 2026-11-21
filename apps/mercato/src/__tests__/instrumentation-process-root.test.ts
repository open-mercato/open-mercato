describe('process container startup', () => {
  const originalEnv = { ...process.env }
  const initialize = jest.fn(async () => undefined)
  const bootstrap = jest.fn()

  beforeEach(() => {
    jest.resetModules()
    initialize.mockReset().mockResolvedValue(undefined)
    bootstrap.mockReset()
    process.env.NEXT_RUNTIME = 'nodejs'
    process.env.NEXT_PHASE = 'phase-production-server'
    process.env.OM_PROCESS_CONTAINER_ROOT = 'on'
    delete process.env.OM_REQUEST_CONTAINER_MEMO
    delete process.env.TELEMETRY_BACKEND
    jest.doMock('@open-mercato/shared/lib/auth/jwt', () => ({ assertJwtSecretPolicy: jest.fn() }))
    jest.doMock('../bootstrap-api', () => ({ bootstrap }))
    jest.doMock('@open-mercato/shared/lib/di/container', () => ({ initializeProcessContainer: initialize }))
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    jest.resetModules()
    jest.dontMock('../bootstrap-api')
    jest.dontMock('@open-mercato/shared/lib/di/container')
    jest.dontMock('@open-mercato/shared/lib/auth/jwt')
  })

  it('completes app registration before initializing the process root', async () => {
    initialize.mockImplementation(async () => {
      expect(bootstrap).toHaveBeenCalledTimes(1)
    })
    const { register } = await import('../instrumentation')
    await register()
    expect(initialize).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['nodejs', 'phase-production-server', 'off'],
    ['nodejs', 'phase-production-server', undefined],
    ['edge', 'phase-production-server', 'on'],
    ['nodejs', 'phase-production-build', 'on'],
  ])('does not load app DI for runtime=%s phase=%s flag=%s', async (runtime, phase, flag) => {
    process.env.NEXT_RUNTIME = runtime
    process.env.NEXT_PHASE = phase
    if (flag === undefined) delete process.env.OM_PROCESS_CONTAINER_ROOT
    else process.env.OM_PROCESS_CONTAINER_ROOT = flag
    const { register } = await import('../instrumentation')
    await register()
    expect(bootstrap).not.toHaveBeenCalled()
    expect(initialize).not.toHaveBeenCalled()
  })

  it.each([undefined, 'off', 'on', ''])('applies memo alias startup with explicit process flag %s', async (flag) => {
    process.env.OM_REQUEST_CONTAINER_MEMO = 'on'
    if (flag === undefined) delete process.env.OM_PROCESS_CONTAINER_ROOT
    else process.env.OM_PROCESS_CONTAINER_ROOT = flag
    const { register } = await import('../instrumentation')
    await register()
    expect(bootstrap).toHaveBeenCalledTimes(flag === undefined || flag === 'on' ? 1 : 0)
    expect(initialize).toHaveBeenCalledTimes(flag === undefined || flag === 'on' ? 1 : 0)
  })

  it('propagates initialization failure instead of advertising a ready process', async () => {
    initialize.mockRejectedValue(new Error('root initialization failed'))
    const { register } = await import('../instrumentation')
    await expect(register()).rejects.toThrow('root initialization failed')
  })
})
