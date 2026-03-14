import Chance from 'chance'
import { mapInpostStatus, mapServiceCodeToInpost, isLockerService } from '../lib/status-map'

const chance = new Chance()

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
    expect(mapInpostStatus(chance.word())).toBe('unknown')
    expect(mapInpostStatus(`future_${chance.word()}_status`)).toBe('unknown')
    expect(mapInpostStatus('')).toBe('unknown')
  })
})

describe('mapServiceCodeToInpost', () => {
  it('maps known service codes to inpost-prefixed values', () => {
    expect(mapServiceCodeToInpost('locker_standard')).toBe('inpost_locker_standard')
    expect(mapServiceCodeToInpost('locker_economy')).toBe('inpost_locker_economy')
    expect(mapServiceCodeToInpost('courier_standard')).toBe('inpost_courier_standard')
    expect(mapServiceCodeToInpost('courier_c2c')).toBe('inpost_courier_c2c')
  })

  it('does not map the deprecated locker_express code', () => {
    expect(mapServiceCodeToInpost('locker_express')).toBe('locker_express')
  })

  it('passes through unknown service codes unchanged', () => {
    const unknownCode = `custom_${chance.word()}`
    expect(mapServiceCodeToInpost(unknownCode)).toBe(unknownCode)
    expect(mapServiceCodeToInpost('')).toBe('')
  })
})

describe('isLockerService', () => {
  it('returns true for locker service codes', () => {
    expect(isLockerService('locker_standard')).toBe(true)
    expect(isLockerService('locker_economy')).toBe(true)
    expect(isLockerService('inpost_locker_standard')).toBe(true)
    expect(isLockerService('inpost_locker_economy')).toBe(true)
    expect(isLockerService('inpost_locker_allegro')).toBe(true)
  })

  it('returns false for courier and unknown service codes', () => {
    expect(isLockerService('courier_standard')).toBe(false)
    expect(isLockerService('inpost_courier_standard')).toBe(false)
    expect(isLockerService('courier_c2c')).toBe(false)
    expect(isLockerService(`unknown_${chance.word()}`)).toBe(false)
    expect(isLockerService('')).toBe(false)
  })
})
