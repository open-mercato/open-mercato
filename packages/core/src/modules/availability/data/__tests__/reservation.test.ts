import { AvailabilityReservation } from '../entities'
import type { AvailabilityReservationItemSnapshot } from '../entities'
import {
  availabilityReservationItemSnapshotSchema,
  availabilityReservationItemsSnapshotSchema,
  availabilityReservationSourceTypeSchema,
  availabilityReservationStatusSchema,
} from '../validators'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const PRODUCT_ID = '33333333-3333-4333-8333-333333333333'
const VARIANT_ID = '44444444-4444-4444-8444-444444444444'

describe('AvailabilityReservation entity/validator round-trip (§5.3, A3)', () => {
  it('builds an entity instance whose items satisfy the zod snapshot schema', () => {
    const items: AvailabilityReservationItemSnapshot[] = [
      {
        catalogProductId: PRODUCT_ID,
        catalogVariantId: VARIANT_ID,
        requested: 5,
        outcome: 'held',
        heldQuantity: 5,
        backorderQuantity: 0,
      },
    ]

    const parsedItems = availabilityReservationItemsSnapshotSchema.parse(items)
    expect(parsedItems).toEqual(items)

    const reservation = new AvailabilityReservation()
    reservation.organizationId = ORG_ID
    reservation.tenantId = TENANT_ID
    reservation.idempotencyKey = 'checkout:session-1'
    reservation.sourceType = availabilityReservationSourceTypeSchema.parse('checkout')
    reservation.sourceId = 'session-1'
    reservation.status = availabilityReservationStatusSchema.parse('active')
    reservation.items = parsedItems
    reservation.wmsReservationIds = []

    expect(reservation.status).toBe('active')
    expect(reservation.items).toEqual(items)
    expect(reservation.wmsReservationIds).toEqual([])
    expect(reservation.orderId).toBeUndefined()
    expect(reservation.statusReason).toBeUndefined()
  })

  it('round-trips a backorder line (heldQuantity below requested, backorderQuantity makes up the gap)', () => {
    const line = {
      catalogProductId: PRODUCT_ID,
      catalogVariantId: VARIANT_ID,
      requested: 10,
      outcome: 'backorder' as const,
      heldQuantity: 4,
      backorderQuantity: 6,
    }

    const parsed = availabilityReservationItemSnapshotSchema.parse(line)
    expect(parsed).toEqual(line)
  })

  it('allows a null catalogVariantId (product-level rollup line) but rejects a negative quantity', () => {
    expect(
      availabilityReservationItemSnapshotSchema.safeParse({
        catalogProductId: PRODUCT_ID,
        catalogVariantId: null,
        requested: 3,
        outcome: 'shortfall',
        heldQuantity: 0,
        backorderQuantity: 0,
      }).success,
    ).toBe(true)

    expect(
      availabilityReservationItemSnapshotSchema.safeParse({
        catalogProductId: PRODUCT_ID,
        catalogVariantId: VARIANT_ID,
        requested: -1,
        outcome: 'held',
        heldQuantity: 0,
        backorderQuantity: 0,
      }).success,
    ).toBe(false)
  })

  it('rejects an outcome outside the five-member enum', () => {
    expect(
      availabilityReservationItemSnapshotSchema.safeParse({
        catalogProductId: PRODUCT_ID,
        catalogVariantId: VARIANT_ID,
        requested: 1,
        outcome: 'reserved',
        heldQuantity: 0,
        backorderQuantity: 0,
      }).success,
    ).toBe(false)
  })

  it('rejects an empty items array (a hold always snapshots at least one line)', () => {
    expect(availabilityReservationItemsSnapshotSchema.safeParse([]).success).toBe(false)
  })

  it('accepts only the literal checkout source type (A16: a system-only source)', () => {
    expect(availabilityReservationSourceTypeSchema.safeParse('checkout').success).toBe(true)
    expect(availabilityReservationSourceTypeSchema.safeParse('order').success).toBe(false)
  })

  it('accepts only the four lifecycle statuses the state machine defines', () => {
    for (const status of ['active', 'committed', 'released', 'expired']) {
      expect(availabilityReservationStatusSchema.safeParse(status).success).toBe(true)
    }
    expect(availabilityReservationStatusSchema.safeParse('cancelled').success).toBe(false)
  })
})
