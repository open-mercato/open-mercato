import { mapInpostStatus, mapServiceCodeToInpost } from '../lib/status-map'

describe('mapInpostStatus', () => {
  const cases: Array<[string, string]> = [
    ['created', 'label_created'],
    ['offers_prepared', 'label_created'],
    ['offer_selected', 'label_created'],
    ['confirmed', 'label_created'],
    ['dispatched_by_sender', 'picked_up'],
    ['collected_from_sender', 'picked_up'],
    ['taken_by_courier', 'in_transit'],
    ['adopted_at_source_branch', 'in_transit'],
    ['sent_from_source_branch', 'in_transit'],
    ['adopted_at_sorting_center', 'in_transit'],
    ['sent_from_sorting_center', 'in_transit'],
    ['out_for_delivery', 'out_for_delivery'],
    ['ready_to_pickup', 'out_for_delivery'],
    ['stack_in_box_machine', 'out_for_delivery'],
    ['delivered', 'delivered'],
    ['pickup_time_expired', 'failed_delivery'],
    ['avizo', 'failed_delivery'],
    ['returned_to_sender', 'returned'],
    ['canceled', 'cancelled'],
  ]

  it.each(cases)('maps InPost status "%s" to unified "%s"', (inpostStatus, expected) => {
    expect(mapInpostStatus(inpostStatus)).toBe(expected)
  })

  it('returns "unknown" for unrecognized statuses', () => {
    expect(mapInpostStatus('some_future_status')).toBe('unknown')
    expect(mapInpostStatus('')).toBe('unknown')
  })
})

describe('mapServiceCodeToInpost', () => {
  it('maps known service codes to inpost-prefixed values', () => {
    expect(mapServiceCodeToInpost('locker_standard')).toBe('inpost_locker_standard')
    expect(mapServiceCodeToInpost('locker_express')).toBe('inpost_locker_express')
    expect(mapServiceCodeToInpost('courier_standard')).toBe('inpost_courier_standard')
    expect(mapServiceCodeToInpost('courier_c2c')).toBe('inpost_courier_c2c')
  })

  it('passes through unknown service codes unchanged', () => {
    expect(mapServiceCodeToInpost('custom_service')).toBe('custom_service')
    expect(mapServiceCodeToInpost('')).toBe('')
  })
})
