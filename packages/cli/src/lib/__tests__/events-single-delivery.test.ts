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

  // Interlock with the bus-side guard in @open-mercato/events/single-delivery:
  // `hasWorkerAvailabilitySignal` treats an EXPLICITLY truthy
  // OM_EVENTS_SINGLE_DELIVERY as proof that a supervisor already verified worker
  // availability. If this guard ever stopped writing an explicit truthy token,
  // every process it launches would silently fall back to inline delivery.
  // The CLI cannot import the events package to assert that directly, so pin the
  // written token here.
  it('writes an explicit truthy token the bus-side guard accepts as a worker signal', () => {
    const processEnv: NodeJS.ProcessEnv = {}
    const runtimeEnv: NodeJS.ProcessEnv = {}

    applyEventsSingleDeliveryGuard({ processEnv, runtimeEnv, autoSpawnWorkersMode: 'lazy' })

    for (const value of [processEnv.OM_EVENTS_SINGLE_DELIVERY, runtimeEnv.OM_EVENTS_SINGLE_DELIVERY]) {
      expect(['1', 'true', 'yes', 'on']).toContain(value)
    }
  })
})
