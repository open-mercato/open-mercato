import Chance from 'chance'
import { mapInpostStatus, mapServiceCodeToInpost, isLockerService } from '../lib/status-map'

const chance = new Chance()

describe('mapInpostStatus', () => {
  const cases: Array<[string, string]> = [
    // Label / offer preparation
    ['created', 'label_created'],
    ['offers_prepared', 'label_created'],
    ['offer_selected', 'label_created'],
    ['confirmed', 'label_created'],

    // Picked up from sender
    ['dispatched_by_sender', 'picked_up'],
    ['dispatched_by_sender_to_pok', 'picked_up'],
    ['collected_from_sender', 'picked_up'],
    ['taken_by_courier_from_customer_service_point', 'picked_up'],
    ['taken_by_courier_from_pok', 'picked_up'],

    // In transit / sorting
    ['taken_by_courier', 'in_transit'],
    ['adopted_at_source_branch', 'in_transit'],
    ['sent_from_source_branch', 'in_transit'],
    ['adopted_at_sorting_center', 'in_transit'],
    ['oversized', 'in_transit'],
    ['readdressed', 'in_transit'],
    ['delay_in_delivery', 'in_transit'],
    ['unstack_from_customer_service_point', 'in_transit'],
    ['unstack_from_box_machine', 'in_transit'],
    ['redirect_to_box', 'in_transit'],
    ['canceled_redirect_to_box', 'in_transit'],

    // Out for delivery / awaiting pickup
    ['out_for_delivery', 'out_for_delivery'],
    ['out_for_delivery_to_address', 'out_for_delivery'],
    ['ready_to_pickup', 'out_for_delivery'],
    ['ready_to_pickup_from_pok', 'out_for_delivery'],
    ['ready_to_pickup_from_branch', 'out_for_delivery'],
    ['stack_in_box_machine', 'out_for_delivery'],
    ['stack_in_customer_service_point', 'out_for_delivery'],
    ['pickup_reminder_sent', 'out_for_delivery'],
    ['pickup_reminder_sent_address', 'out_for_delivery'],
    ['courier_avizo_in_customer_service_point', 'out_for_delivery'],

    // Delivered
    ['delivered', 'delivered'],

    // Failed delivery
    ['pickup_time_expired', 'failed_delivery'],
    ['stack_parcel_pickup_time_expired', 'failed_delivery'],
    ['stack_parcel_in_box_machine_pickup_time_expired', 'failed_delivery'],
    ['avizo', 'failed_delivery'],
    ['undelivered', 'failed_delivery'],
    ['undelivered_wrong_address', 'failed_delivery'],
    ['undelivered_cod_cash_receiver', 'failed_delivery'],
    ['rejected_by_receiver', 'failed_delivery'],

    // Returned
    ['returned_to_sender', 'returned'],

    // Cancelled
    ['canceled', 'cancelled'],
    ['claimed', 'cancelled'],
  ]

  it.each(cases)('maps InPost status "%s" to unified "%s"', (inpostStatus, expected) => {
    expect(mapInpostStatus(inpostStatus)).toBe(expected)
  })

  it('returns "unknown" for unrecognized statuses', () => {
    expect(mapInpostStatus(chance.word())).toBe('unknown')
    expect(mapInpostStatus(`future_${chance.word()}_status`)).toBe('unknown')
    expect(mapInpostStatus('')).toBe('unknown')
  })

  it('returns "unknown" for sent_from_sorting_center (not in official status list)', () => {
    expect(mapInpostStatus('sent_from_sorting_center')).toBe('unknown')
  })
})

describe('mapServiceCodeToInpost', () => {
  it('maps known service codes to inpost-prefixed values', () => {
    expect(mapServiceCodeToInpost('locker_standard')).toBe('inpost_locker_standard')
    expect(mapServiceCodeToInpost('courier_standard')).toBe('inpost_courier_standard')
    expect(mapServiceCodeToInpost('courier_c2c')).toBe('inpost_courier_c2c')
  })

  it('does not map the deprecated locker_express code', () => {
    expect(mapServiceCodeToInpost('locker_express')).toBe('locker_express')
  })

  it('does not map locker_economy (non-existent in official service list)', () => {
    expect(mapServiceCodeToInpost('locker_economy')).toBe('locker_economy')
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
    expect(isLockerService('inpost_locker_standard')).toBe(true)
    expect(isLockerService('inpost_locker_allegro')).toBe(true)
  })

  it('returns false for locker_economy (removed from official service list)', () => {
    expect(isLockerService('locker_economy')).toBe(false)
    expect(isLockerService('inpost_locker_economy')).toBe(false)
  })

  it('returns false for courier and unknown service codes', () => {
    expect(isLockerService('courier_standard')).toBe(false)
    expect(isLockerService('inpost_courier_standard')).toBe(false)
    expect(isLockerService('courier_c2c')).toBe(false)
    expect(isLockerService(`unknown_${chance.word()}`)).toBe(false)
    expect(isLockerService('')).toBe(false)
  })
})
