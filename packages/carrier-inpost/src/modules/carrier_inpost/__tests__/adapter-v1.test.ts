import Chance from 'chance'
import { inpostAdapterV1 } from '../lib/adapters/v1'
import type { CreateShipmentInput } from '@open-mercato/core/modules/shipping_carriers/lib/adapter'

const chance = new Chance()

function makeCredentials(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    apiToken: chance.guid(),
    organizationId: chance.guid(),
    ...overrides,
  }
}

function makeAddress(overrides: Partial<{ line2: string }> = {}) {
  return {
    line1: `${chance.street()}`,
    city: chance.city(),
    postalCode: chance.zip(),
    countryCode: chance.pickone(['PL', 'DE', 'FR', 'GB']),
    ...overrides,
  }
}

function makePackage() {
  return {
    weightKg: chance.floating({ min: 0.1, max: 30, fixed: 2 }),
    lengthCm: chance.integer({ min: 5, max: 200 }),
    widthCm: chance.integer({ min: 5, max: 200 }),
    heightCm: chance.integer({ min: 5, max: 200 }),
  }
}

function makeShipmentInput(overrides: Partial<CreateShipmentInput> = {}): CreateShipmentInput {
  return {
    credentials: makeCredentials(),
    orderId: chance.guid(),
    serviceCode: 'locker_standard',
    origin: makeAddress(),
    destination: makeAddress(),
    packages: [makePackage()],
    ...overrides,
  }
}

function makeOkFetch(body: unknown, status = 201) {
  return jest.fn().mockResolvedValue({
    ok: true,
    status,
    json: () => Promise.resolve(body),
  })
}

describe('inpostAdapterV1', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  describe('calculateRates', () => {
    it('returns 4 fixed PLN rates for any input', async () => {
      const rates = await inpostAdapterV1.calculateRates(makeShipmentInput())

      expect(rates).toHaveLength(4)
      for (const rate of rates) {
        expect(rate.currencyCode).toBe('PLN')
        expect(rate.amount).toBeGreaterThan(0)
        expect(typeof rate.serviceCode).toBe('string')
        expect(typeof rate.serviceName).toBe('string')
      }
    })

    it('includes expected service codes', async () => {
      const rates = await inpostAdapterV1.calculateRates(makeShipmentInput())
      const codes = rates.map((r) => r.serviceCode)

      expect(codes).toContain('locker_standard')
      expect(codes).toContain('locker_economy')
      expect(codes).toContain('courier_standard')
      expect(codes).toContain('courier_c2c')
    })

    it('does not include the deprecated locker_express service', async () => {
      const rates = await inpostAdapterV1.calculateRates(makeShipmentInput())
      expect(rates.map((r) => r.serviceCode)).not.toContain('locker_express')
    })
  })

  describe('createShipment', () => {
    it('POSTs to the correct URL and returns shipmentId and trackingNumber', async () => {
      const shipmentId = chance.guid()
      const trackingNumber = chance.string({ length: 24, pool: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' })
      const input = makeShipmentInput()
      const orgId = input.credentials.organizationId as string

      global.fetch = makeOkFetch({ id: shipmentId, tracking_number: trackingNumber })

      const result = await inpostAdapterV1.createShipment(input)

      const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit]
      expect(url).toContain(`/v1/organizations/${orgId}/shipments`)
      expect(init.method).toBe('POST')
      expect(result.shipmentId).toBe(shipmentId)
      expect(result.trackingNumber).toBe(trackingNumber)
    })

    it('falls back to shipment id when tracking_number is absent', async () => {
      const shipmentId = chance.guid()
      global.fetch = makeOkFetch({ id: shipmentId })

      const result = await inpostAdapterV1.createShipment(makeShipmentInput())

      expect(result.trackingNumber).toBe(shipmentId)
    })

    it('includes labelData when the response contains a label string', async () => {
      const labelData = `${chance.string({ length: 40 })}==`
      global.fetch = makeOkFetch({ id: chance.guid(), tracking_number: chance.guid(), label: labelData })

      const result = await inpostAdapterV1.createShipment(makeShipmentInput())

      expect(result.labelData).toBe(labelData)
    })

    it('includes estimatedDelivery when scheduled_delivery_end is present', async () => {
      const deliveryDate = chance.date({ year: 2026 }) as Date
      const isoString = deliveryDate.toISOString()

      global.fetch = makeOkFetch({
        id: chance.guid(),
        tracking_number: chance.guid(),
        scheduled_delivery_end: isoString,
      })

      const result = await inpostAdapterV1.createShipment(makeShipmentInput())

      expect(result.estimatedDelivery).toBeInstanceOf(Date)
      expect(result.estimatedDelivery?.toISOString()).toBe(isoString)
    })

    it('uses lowercase "small" template when no packages are provided', async () => {
      global.fetch = makeOkFetch({ id: chance.guid(), tracking_number: chance.guid() })

      await inpostAdapterV1.createShipment(makeShipmentInput({ packages: [] }))

      const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit]
      const body = JSON.parse(init.body as string) as Record<string, unknown>
      expect((body.parcels as Array<{ template: string }>)[0]).toEqual({ template: 'small' })
    })

    it('uses lowercase "small" template for locker services even when packages are provided', async () => {
      global.fetch = makeOkFetch({ id: chance.guid(), tracking_number: chance.guid() })

      await inpostAdapterV1.createShipment(makeShipmentInput({ serviceCode: 'locker_standard' }))

      const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit]
      const body = JSON.parse(init.body as string) as Record<string, unknown>
      expect((body.parcels as Array<{ template: string }>)[0]).toEqual({ template: 'small' })
    })

    it('uses nested dimensions/weight structure for courier services', async () => {
      const pkg = makePackage()
      global.fetch = makeOkFetch({ id: chance.guid(), tracking_number: chance.guid() })

      await inpostAdapterV1.createShipment(
        makeShipmentInput({ serviceCode: 'courier_standard', packages: [pkg] }),
      )

      const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit]
      const body = JSON.parse(init.body as string) as Record<string, unknown>
      const parcel = (body.parcels as Array<Record<string, unknown>>)[0]
      expect(parcel).toEqual({
        dimensions: {
          length: String(Math.round(pkg.lengthCm * 10)),
          width: String(Math.round(pkg.widthCm * 10)),
          height: String(Math.round(pkg.heightCm * 10)),
          unit: 'mm',
        },
        weight: { amount: String(pkg.weightKg), unit: 'kg' },
      })
    })

    it('maps serviceCode via mapServiceCodeToInpost before sending', async () => {
      global.fetch = makeOkFetch({ id: chance.guid(), tracking_number: chance.guid() })

      await inpostAdapterV1.createShipment(makeShipmentInput({ serviceCode: 'locker_standard' }))

      const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit]
      const body = JSON.parse(init.body as string) as Record<string, unknown>
      expect(body.service).toBe('inpost_locker_standard')
    })

    it('nests address fields under receiver.address with post_code', async () => {
      const destination = makeAddress()
      global.fetch = makeOkFetch({ id: chance.guid(), tracking_number: chance.guid() })

      await inpostAdapterV1.createShipment(makeShipmentInput({ destination }))

      const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit]
      const body = JSON.parse(init.body as string) as Record<string, unknown>
      const address = (body.receiver as Record<string, unknown>).address as Record<string, unknown>
      expect(address.post_code).toBe(destination.postalCode)
      expect(address.city).toBe(destination.city)
      expect(address.country_code).toBe(destination.countryCode)
      expect(address.street).toBe(destination.line1)
      expect('zip_code' in address).toBe(false)
    })

    it('nests address fields under sender.address with post_code', async () => {
      const origin = makeAddress()
      global.fetch = makeOkFetch({ id: chance.guid(), tracking_number: chance.guid() })

      await inpostAdapterV1.createShipment(makeShipmentInput({ origin }))

      const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit]
      const body = JSON.parse(init.body as string) as Record<string, unknown>
      const address = (body.sender as Record<string, unknown>).address as Record<string, unknown>
      expect(address.post_code).toBe(origin.postalCode)
      expect(address.city).toBe(origin.city)
      expect(address.street).toBe(origin.line1)
    })

    it('includes line2 as building_number nested under receiver.address', async () => {
      const buildingNumber = chance.character({ pool: '0123456789' }) + chance.character({ pool: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' })
      global.fetch = makeOkFetch({ id: chance.guid(), tracking_number: chance.guid() })

      await inpostAdapterV1.createShipment(
        makeShipmentInput({ destination: makeAddress({ line2: buildingNumber }) }),
      )

      const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit]
      const body = JSON.parse(init.body as string) as Record<string, unknown>
      const address = (body.receiver as Record<string, unknown>).address as Record<string, unknown>
      expect(address.building_number).toBe(buildingNumber)
    })

    it('includes contact fields from credentials on sender', async () => {
      const firstName = chance.first()
      const lastName = chance.last()
      const email = chance.email()
      const phone = chance.phone({ formatted: false })
      const companyName = chance.company()

      global.fetch = makeOkFetch({ id: chance.guid(), tracking_number: chance.guid() })

      await inpostAdapterV1.createShipment(
        makeShipmentInput({
          credentials: makeCredentials({
            senderFirstName: firstName,
            senderLastName: lastName,
            senderEmail: email,
            senderPhone: phone,
            senderCompanyName: companyName,
          }),
        }),
      )

      const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit]
      const body = JSON.parse(init.body as string) as Record<string, unknown>
      const sender = body.sender as Record<string, unknown>
      expect(sender.first_name).toBe(firstName)
      expect(sender.last_name).toBe(lastName)
      expect(sender.email).toBe(email)
      expect(sender.phone).toBe(phone)
      expect(sender.company_name).toBe(companyName)
    })

    it('includes custom_attributes.target_point for locker services when targetPoint is in credentials', async () => {
      const targetPoint = `${chance.string({ length: 3, pool: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' })}${chance.integer({ min: 100, max: 999 })}M`
      global.fetch = makeOkFetch({ id: chance.guid(), tracking_number: chance.guid() })

      await inpostAdapterV1.createShipment(
        makeShipmentInput({
          serviceCode: 'locker_standard',
          credentials: makeCredentials({ targetPoint }),
        }),
      )

      const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit]
      const body = JSON.parse(init.body as string) as Record<string, unknown>
      expect((body.custom_attributes as Record<string, unknown>).target_point).toBe(targetPoint)
    })

    it('does not include custom_attributes when targetPoint is absent', async () => {
      global.fetch = makeOkFetch({ id: chance.guid(), tracking_number: chance.guid() })

      await inpostAdapterV1.createShipment(makeShipmentInput())

      const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit]
      const body = JSON.parse(init.body as string) as Record<string, unknown>
      expect(body.custom_attributes).toBeUndefined()
    })
  })

  describe('getTracking', () => {
    it('fetches tracking by trackingNumber and maps status and events', async () => {
      const trackingNumber = chance.string({ length: 20, pool: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' })

      global.fetch = makeOkFetch(
        {
          tracking_number: trackingNumber,
          status: 'delivered',
          tracking_details: [
            { status: 'taken_by_courier', datetime: '2026-03-14T08:00:00Z' },
            { status: 'delivered', datetime: '2026-03-15T14:00:00Z' },
          ],
        },
        200,
      )

      const result = await inpostAdapterV1.getTracking({
        credentials: makeCredentials(),
        trackingNumber,
      })

      expect(result.trackingNumber).toBe(trackingNumber)
      expect(result.status).toBe('delivered')
      expect(result.events).toHaveLength(2)
      expect(result.events[0]?.status).toBe('in_transit')
      expect(result.events[1]?.status).toBe('delivered')
    })

    it('falls back to shipmentId when trackingNumber is not provided', async () => {
      const shipmentId = chance.guid()

      global.fetch = makeOkFetch(
        { tracking_number: chance.guid(), status: 'in_transit', tracking_details: [] },
        200,
      )

      await inpostAdapterV1.getTracking({ credentials: makeCredentials(), shipmentId })

      const [url] = (global.fetch as jest.Mock).mock.calls[0] as [string]
      expect(url).toContain(shipmentId)
    })

    it('throws when neither trackingNumber nor shipmentId is provided', async () => {
      await expect(
        inpostAdapterV1.getTracking({ credentials: makeCredentials() }),
      ).rejects.toThrow('trackingNumber or shipmentId is required')
    })

    it('returns empty events array when tracking_details is absent', async () => {
      global.fetch = makeOkFetch(
        { tracking_number: chance.guid(), status: 'in_transit' },
        200,
      )

      const result = await inpostAdapterV1.getTracking({
        credentials: makeCredentials(),
        trackingNumber: chance.guid(),
      })

      expect(result.events).toEqual([])
    })
  })

  describe('cancelShipment', () => {
    it('sends DELETE to correct URL and returns cancelled status', async () => {
      const shipmentId = chance.guid()
      const credentials = makeCredentials()
      const orgId = credentials.organizationId as string

      global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 204, json: jest.fn() })

      const result = await inpostAdapterV1.cancelShipment({ credentials, shipmentId })

      expect(result.status).toBe('cancelled')
      const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit]
      expect(url).toContain(`/v1/organizations/${orgId}/shipments/${shipmentId}`)
      expect(init.method).toBe('DELETE')
    })

    it('URL-encodes shipmentId with special characters', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 204, json: jest.fn() })

      const rawId = `${chance.word()}/with spaces`
      await inpostAdapterV1.cancelShipment({ credentials: makeCredentials(), shipmentId: rawId })

      const [url] = (global.fetch as jest.Mock).mock.calls[0] as [string]
      expect(url).toContain(encodeURIComponent(rawId))
    })
  })

  describe('mapStatus', () => {
    it('delegates to mapInpostStatus for known statuses', () => {
      expect(inpostAdapterV1.mapStatus('delivered')).toBe('delivered')
      expect(inpostAdapterV1.mapStatus('canceled')).toBe('cancelled')
      expect(inpostAdapterV1.mapStatus('taken_by_courier')).toBe('in_transit')
    })

    it('returns "unknown" for unrecognized statuses', () => {
      expect(inpostAdapterV1.mapStatus(chance.word())).toBe('unknown')
    })
  })

  describe('verifyWebhook', () => {
    it('returns a webhook event for valid JSON payload', async () => {
      const eventId = `evt-${chance.guid()}`
      const status = chance.pickone(['delivered', 'in_transit', 'canceled'])
      const body = JSON.stringify({ id: eventId, status, created_at: new Date().toISOString() })

      const event = await inpostAdapterV1.verifyWebhook({
        rawBody: body,
        headers: {},
        credentials: {},
      })

      expect(event.eventType).toBe(status)
      expect(event.eventId).toBe(eventId)
    })
  })
})
