import type { EnricherContext } from '@open-mercato/shared/lib/crud/response-enricher'
import { salesShipmentCarrierEnricher } from '../data/enrichers'
import type { CarrierShipment } from '../data/entities'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))

import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'

const mockFindOne = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>
const mockFind = findWithDecryption as jest.MockedFunction<typeof findWithDecryption>

const ORDER_A = '11111111-1111-4111-8111-111111111111'
const ORDER_B = '22222222-2222-4222-8222-222222222222'

const context: EnricherContext = {
  organizationId: 'org-1',
  tenantId: 'tenant-1',
  userId: 'user-1',
  em: {},
  container: {},
}

function makeCarrierShipment(id: string, orderId: string): CarrierShipment {
  return {
    id,
    orderId,
    providerKey: 'inpost',
    trackingNumber: `TRK-${id}`,
    unifiedStatus: 'in_transit',
  } as CarrierShipment
}

const expectedCarrier = (shipment: CarrierShipment) => ({
  shipmentId: shipment.id,
  providerKey: shipment.providerKey,
  trackingNumber: shipment.trackingNumber,
  status: shipment.unifiedStatus,
})

describe('shipping_carriers sales shipment enricher', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('targets the entity id the sales shipments route enriches', () => {
    expect(salesShipmentCarrierEnricher.targetEntity).toBe('sales.shipment')
  })

  test.each([
    ['snake_case order_id', { id: 'ship-1', order_id: ORDER_A }],
    ['camelCase orderId', { id: 'ship-1', orderId: ORDER_A }],
  ])('enrichOne attaches _carrier for a record with %s', async (_label, record) => {
    const carrierShipment = makeCarrierShipment('carrier-1', ORDER_A)
    mockFindOne.mockResolvedValueOnce(carrierShipment)

    const enriched = await salesShipmentCarrierEnricher.enrichOne(record, context)

    expect(mockFindOne).toHaveBeenCalledWith(
      context.em,
      expect.anything(),
      expect.objectContaining({ orderId: ORDER_A, organizationId: 'org-1', tenantId: 'tenant-1', deletedAt: null }),
      expect.anything(),
      { organizationId: 'org-1', tenantId: 'tenant-1' },
    )
    expect(enriched).toEqual({ ...record, _carrier: expectedCarrier(carrierShipment) })
  })

  test('enrichOne leaves a record without an order id untouched and skips the lookup', async () => {
    const record = { id: 'ship-1' }

    const enriched = await salesShipmentCarrierEnricher.enrichOne(record, context)

    expect(enriched).toBe(record)
    expect(mockFindOne).not.toHaveBeenCalled()
  })

  test('enrichMany resolves both key shapes in one batched lookup', async () => {
    const carrierA = makeCarrierShipment('carrier-a', ORDER_A)
    const carrierB = makeCarrierShipment('carrier-b', ORDER_B)
    mockFind.mockResolvedValueOnce([carrierA, carrierB])
    const records = [
      { id: 'ship-1', order_id: ORDER_A },
      { id: 'ship-2', orderId: ORDER_B },
      { id: 'ship-3' },
    ]

    const enriched = await salesShipmentCarrierEnricher.enrichMany!(records, context)

    expect(mockFind).toHaveBeenCalledTimes(1)
    expect(mockFind).toHaveBeenCalledWith(
      context.em,
      expect.anything(),
      expect.objectContaining({ orderId: { $in: [ORDER_A, ORDER_B] } }),
      expect.anything(),
      { organizationId: 'org-1', tenantId: 'tenant-1' },
    )
    expect(enriched).toEqual([
      { id: 'ship-1', order_id: ORDER_A, _carrier: expectedCarrier(carrierA) },
      { id: 'ship-2', orderId: ORDER_B, _carrier: expectedCarrier(carrierB) },
      { id: 'ship-3' },
    ])
  })

  test('enrichMany picks the newest carrier shipment per order', async () => {
    const newest = makeCarrierShipment('carrier-new', ORDER_A)
    const older = makeCarrierShipment('carrier-old', ORDER_A)
    mockFind.mockResolvedValueOnce([newest, older])

    const [enriched] = await salesShipmentCarrierEnricher.enrichMany!([{ id: 'ship-1', order_id: ORDER_A }], context)

    expect(enriched).toEqual({ id: 'ship-1', order_id: ORDER_A, _carrier: expectedCarrier(newest) })
  })

  test('enrichMany returns records unchanged when none carries an order id', async () => {
    const records = [{ id: 'ship-1' }]

    const enriched = await salesShipmentCarrierEnricher.enrichMany!(records, context)

    expect(enriched).toBe(records)
    expect(mockFind).not.toHaveBeenCalled()
  })
})
