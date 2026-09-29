import {
  applyEventsSingleDeliveryGuard,
  reconcileEventsSingleDelivery,
} from '../events-single-delivery'

describe('reconcileEventsSingleDelivery', () => {
  it('keeps single-delivery on when workers auto-spawn (default request)', () => {
    expect(reconcileEventsSingleDelivery({}, 'eager')).toEqual({ effective: true })
    expect(reconcileEventsSingleDelivery({}, 'lazy')).toEqual({ effective: true })
  })

  it('falls back to inline delivery (with a warning) when no worker runs', () => {
    const result = reconcileEventsSingleDelivery({}, 'off')
    expect(result.effective).toBe(false)
    expect(result.warning).toContain('OM_EVENTS_SINGLE_DELIVERY')
    expect(result.warning).toContain('OM_EVENTS_EXTERNAL_WORKER')
  })

  it('keeps single-delivery on with no auto-spawn when an external worker is acknowledged', () => {
    expect(
      reconcileEventsSingleDelivery({ OM_EVENTS_EXTERNAL_WORKER: 'true' }, 'off'),
    ).toEqual({ effective: true })
  })

  it('respects an explicit legacy opt-out regardless of worker availability', () => {
    expect(
      reconcileEventsSingleDelivery({ OM_EVENTS_SINGLE_DELIVERY: 'false' }, 'eager'),
    ).toEqual({ effective: false })
  })
})

describe('applyEventsSingleDeliveryGuard', () => {
  it('writes the reconciled value into both process and runtime env', () => {
    const processEnv: NodeJS.ProcessEnv = {}
    const runtimeEnv: NodeJS.ProcessEnv = {}
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    const result = applyEventsSingleDeliveryGuard({
      processEnv,
      runtimeEnv,
      autoSpawnWorkersMode: 'off',
    })

    expect(result.effective).toBe(false)
    expect(processEnv.OM_EVENTS_SINGLE_DELIVERY).toBe('false')
    expect(runtimeEnv.OM_EVENTS_SINGLE_DELIVERY).toBe('false')
    expect(errorSpy).toHaveBeenCalledTimes(1)
    errorSpy.mockRestore()
  })

  it('writes true (and stays quiet) when workers are available', () => {
    const processEnv: NodeJS.ProcessEnv = {}
    const runtimeEnv: NodeJS.ProcessEnv = {}
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    const result = applyEventsSingleDeliveryGuard({
      processEnv,
      runtimeEnv,
      autoSpawnWorkersMode: 'eager',
    })

    expect(result.effective).toBe(true)
    expect(processEnv.OM_EVENTS_SINGLE_DELIVERY).toBe('true')
    expect(runtimeEnv.OM_EVENTS_SINGLE_DELIVERY).toBe('true')
    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  // The written value is what the spawned children actually consume: the guard
  // copies it into the child `runtimeEnv`, so a Next.js or worker process started
  // by `mercato server` reads this explicit token instead of re-deriving the
  // default. An empty or non-boolean value would silently hand children the
  // default-on behaviour the guard just decided against, so pin the token here.
  it('writes an explicit boolean token into the env handed to spawned children', () => {
    const processEnv: NodeJS.ProcessEnv = {}
    const runtimeEnv: NodeJS.ProcessEnv = {}

    applyEventsSingleDeliveryGuard({ processEnv, runtimeEnv, autoSpawnWorkersMode: 'lazy' })

    for (const value of [processEnv.OM_EVENTS_SINGLE_DELIVERY, runtimeEnv.OM_EVENTS_SINGLE_DELIVERY]) {
      expect(['1', 'true', 'yes', 'on']).toContain(value)
    }
  })
})
