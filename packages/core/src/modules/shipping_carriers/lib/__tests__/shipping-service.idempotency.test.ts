/** @jest-environment node */
import { UniqueConstraintViolationException } from '@mikro-orm/core'
import { randomUUID } from 'node:crypto'
import { createShippingCarrierService } from '@open-mercato/core/modules/shipping_carriers/lib/shipping-service'
import { ShipmentIdempotencyConflictError } from '@open-mercato/core/modules/shipping_carriers/lib/shipment-idempotency'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { getShippingAdapter } from '@open-mercato/core/modules/shipping_carriers/lib/adapter-registry'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/shipping_carriers/lib/adapter-registry', () => ({
  getShippingAdapter: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/shipping_carriers/events', () => ({
  emitShippingEvent: jest.fn(),
}))

const ORG = '11111111-1111-1111-1111-111111111111'
const TENANT = '22222222-2222-2222-2222-222222222222'

type AnyRecord = Record<string, unknown>

function claimKey(entity: AnyRecord): string {
  return `${entity.idempotencyKey}|${entity.providerKey}|${entity.organizationId}|${entity.tenantId}`
}

function isClaim(entity: AnyRecord): boolean {
  return 'requestHash' in entity || 'idempotencyKey' in entity
}

/**
 * In-memory EntityManager mock that enforces the carrier_shipment_idempotency_keys
 * unique constraint, so the idempotency claim/replay/conflict behaviour can be
 * asserted without a real Postgres (the module's jest harness mocks the EM).
 */
function makeMockEm() {
  const claims = new Map<string, AnyRecord>()
  const shipments = new Map<string, AnyRecord>()
  const em = {
    _claims: claims,
    _shipments: shipments,
    create(_cls: unknown, data: AnyRecord) {
      return { ...data }
    },
    persist(entity: AnyRecord) {
      return { flush: async () => em._flushOne(entity) }
    },
    async flush() {
      /* managed refs are mutated in place; nothing to persist in the mock */
    },
    remove(entity: AnyRecord) {
      return {
        flush: async () => {
          for (const [key, value] of claims) if (value === entity) claims.delete(key)
        },
      }
    },
    async _flushOne(entity: AnyRecord) {
      if (isClaim(entity)) {
        const key = claimKey(entity)
        if (claims.has(key)) {
          throw new UniqueConstraintViolationException(new Error('duplicate idempotency claim'))
        }
        if (!entity.id) entity.id = randomUUID()
        claims.set(key, entity)
        return
      }
      if (!entity.id) entity.id = randomUUID()
      shipments.set(entity.id as string, entity)
    },
  }
  return em
}

let carrierCounter = 0
const adapterCreateShipment = jest.fn(async () => {
  carrierCounter += 1
  return {
    shipmentId: `carrier_${carrierCounter}`,
    trackingNumber: `TRK_${carrierCounter}`,
    labelUrl: null,
    labelData: null,
  }
})

const integrationCredentialsService = { resolve: jest.fn(async () => ({})) }

function buildInput(overrides: AnyRecord = {}) {
  return {
    providerKey: 'mock_carrier',
    orderId: randomUUID(),
    origin: { countryCode: 'US', postalCode: '10001', city: 'New York', line1: '123 Sender St' },
    destination: { countryCode: 'US', postalCode: '90210', city: 'Beverly Hills', line1: '456 Receiver Ave' },
    packages: [{ weightKg: 2.5, lengthCm: 30, widthCm: 20, heightCm: 15 }],
    serviceCode: 'standard',
    organizationId: ORG,
    tenantId: TENANT,
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  carrierCounter = 0
  ;(getShippingAdapter as jest.Mock).mockReturnValue({ createShipment: adapterCreateShipment })
  ;(findOneWithDecryption as jest.Mock).mockImplementation(
    async (em: ReturnType<typeof makeMockEm>, _cls: unknown, where: AnyRecord) => {
      if (where && where.idempotencyKey !== undefined) {
        return (
          em._claims.get(
            `${where.idempotencyKey}|${where.providerKey}|${where.organizationId}|${where.tenantId}`,
          ) ?? null
        )
      }
      if (where && where.id !== undefined) return em._shipments.get(where.id as string) ?? null
      return null
    },
  )
})

describe('shipping-service createShipment idempotency', () => {
  test('repeated createShipment with the same idempotency key returns the same shipment and creates no duplicate', async () => {
    const em = makeMockEm()
    const service = createShippingCarrierService({ em: em as never, integrationCredentialsService: integrationCredentialsService as never })
    const input = buildInput({ idempotencyKey: 'idem-key-1' })

    const first = await service.createShipment(input as never)
    const second = await service.createShipment(input as never)

    expect(adapterCreateShipment).toHaveBeenCalledTimes(1)
    expect((second as { id: string }).id).toBe((first as { id: string }).id)
    expect(em._shipments.size).toBe(1)
  })

  test('reusing the same idempotency key with a conflicting payload throws a conflict and creates no second shipment', async () => {
    const em = makeMockEm()
    const service = createShippingCarrierService({ em: em as never, integrationCredentialsService: integrationCredentialsService as never })
    const orderId = randomUUID()

    await service.createShipment(buildInput({ idempotencyKey: 'idem-key-2', orderId, serviceCode: 'standard' }) as never)

    await expect(
      service.createShipment(buildInput({ idempotencyKey: 'idem-key-2', orderId, serviceCode: 'express' }) as never),
    ).rejects.toBeInstanceOf(ShipmentIdempotencyConflictError)

    expect(adapterCreateShipment).toHaveBeenCalledTimes(1)
    expect(em._shipments.size).toBe(1)
  })

  test('distinct idempotency keys create independent shipments', async () => {
    const em = makeMockEm()
    const service = createShippingCarrierService({ em: em as never, integrationCredentialsService: integrationCredentialsService as never })

    const first = await service.createShipment(buildInput({ idempotencyKey: 'idem-a' }) as never)
    const second = await service.createShipment(buildInput({ idempotencyKey: 'idem-b' }) as never)

    expect(adapterCreateShipment).toHaveBeenCalledTimes(2)
    expect((second as { id: string }).id).not.toBe((first as { id: string }).id)
    expect(em._shipments.size).toBe(2)
  })

  test('omitting the idempotency key preserves the original create behaviour (no dedup)', async () => {
    const em = makeMockEm()
    const service = createShippingCarrierService({ em: em as never, integrationCredentialsService: integrationCredentialsService as never })
    const input = buildInput()

    const first = await service.createShipment(input as never)
    const second = await service.createShipment(input as never)

    expect(adapterCreateShipment).toHaveBeenCalledTimes(2)
    expect((second as { id: string }).id).not.toBe((first as { id: string }).id)
    expect(em._shipments.size).toBe(2)
    expect(em._claims.size).toBe(0)
  })
})
