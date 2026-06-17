import {
  isSingleDeliveryRequested,
  isExternalWorkerAcknowledged,
  reconcileSingleDelivery,
} from '@open-mercato/events/single-delivery'

describe('isSingleDeliveryRequested', () => {
  it('defaults ON when unset', () => {
    expect(isSingleDeliveryRequested({})).toBe(true)
  })

  it('honors an explicit false token', () => {
    expect(isSingleDeliveryRequested({ OM_EVENTS_SINGLE_DELIVERY: 'false' })).toBe(false)
    expect(isSingleDeliveryRequested({ OM_EVENTS_SINGLE_DELIVERY: '0' })).toBe(false)
  })
})

describe('isExternalWorkerAcknowledged', () => {
  it('defaults off and reads truthy tokens', () => {
    expect(isExternalWorkerAcknowledged({})).toBe(false)
    expect(isExternalWorkerAcknowledged({ OM_EVENTS_EXTERNAL_WORKER: 'true' })).toBe(true)
  })
})

describe('reconcileSingleDelivery', () => {
  it('stays on when a worker is available', () => {
    expect(reconcileSingleDelivery({ requested: true, workersAvailable: true })).toEqual({
      effective: true,
    })
  })

  it('falls back to inline with a warning when no worker is available', () => {
    const result = reconcileSingleDelivery({ requested: true, workersAvailable: false })
    expect(result.effective).toBe(false)
    expect(result.warning).toContain('OM_EVENTS_SINGLE_DELIVERY')
    expect(result.warning).toContain('OM_EVENTS_EXTERNAL_WORKER')
  })

  it('stays off (no warning) when not requested', () => {
    expect(reconcileSingleDelivery({ requested: false, workersAvailable: false })).toEqual({
      effective: false,
    })
  })
})
