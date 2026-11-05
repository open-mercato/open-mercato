/** @jest-environment node */

import {
  buildMovementIdempotencyKey,
  buildReservationIdempotencyKey,
} from '../inventoryIdempotency'

describe('inventoryIdempotency', () => {
  it('builds stable movement keys for identical operation signatures', () => {
    const input = {
      referenceType: 'manual' as const,
      referenceId: '88888888-8888-4888-8888-888888888888',
      type: 'adjust' as const,
      warehouseId: '55555555-5555-4555-8555-555555555555',
      locationFromId: null,
      locationToId: '66666666-6666-4666-8666-666666666666',
      catalogVariantId: '77777777-7777-4777-8777-777777777777',
      lotId: null,
      serialNumber: null,
      quantity: -2,
    }
    expect(buildMovementIdempotencyKey(input)).toBe(buildMovementIdempotencyKey(input))
  })

  it('differentiates movement keys when quantity changes', () => {
    const base = {
      referenceType: 'manual' as const,
      referenceId: '88888888-8888-4888-8888-888888888888',
      type: 'adjust' as const,
      warehouseId: '55555555-5555-4555-8555-555555555555',
      locationToId: '66666666-6666-4666-8666-666666666666',
      catalogVariantId: '77777777-7777-4777-8777-777777777777',
      lotId: null,
      serialNumber: null,
      quantity: 1,
    }
    expect(buildMovementIdempotencyKey(base)).not.toBe(
      buildMovementIdempotencyKey({ ...base, quantity: 2 }),
    )
  })

  it('builds reservation keys from source and variant context', () => {
    const key = buildReservationIdempotencyKey({
      sourceType: 'order',
      sourceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      catalogVariantId: '77777777-7777-4777-8777-777777777777',
      warehouseId: '55555555-5555-4555-8555-555555555555',
      quantity: 5,
    })
    expect(key).toContain('reservation|order|')
    expect(key).toContain('|5')
  })
})
