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
    function makeServiceResult(serviceCode: string, chargeAmount: string | null) {
      return [{ id: serviceCode, calculated_charge_amount: chargeAmount }]
    }

    function makeAllServicesOkFetch(amounts: Record<string, string | null> = {}) {
      const defaults: Record<string, string> = {
        locker_standard: '9.99',
        locker_economy: '7.99',
        courier_standard: '12.99',
        courier_c2c: '10.99',
      }
      const resolved = { ...defaults, ...amounts }
      // Each service fires one fetch call in order: locker_standard, locker_economy, courier_standard, courier_c2c
      return jest.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(makeServiceResult('locker_standard', resolved['locker_standard'] ?? null)) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(makeServiceResult('locker_economy', resolved['locker_economy'] ?? null)) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(makeServiceResult('courier_standard', resolved['courier_standard'] ?? null)) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(makeServiceResult('courier_c2c', resolved['courier_c2c'] ?? null)) })
    }

    it('POSTs to the calculate endpoint and returns rates with amounts in minor units', async () => {
      const input = makeShipmentInput()
      const orgId = input.credentials.organizationId as string
      global.fetch = makeAllServicesOkFetch()

      const rates = await inpostAdapterV1.calculateRates(input)

      const calls = (global.fetch as jest.Mock).mock.calls as [string, RequestInit][]
      for (const [url, init] of calls) {
        expect(url).toContain(`/v1/organizations/${orgId}/shipments/calculate`)
        expect(init.method).toBe('POST')
      }
      expect(rates).toHaveLength(4)
      for (const rate of rates) {
        expect(rate.currencyCode).toBe('PLN')
        expect(rate.amount).toBeGreaterThan(0)
        expect(typeof rate.serviceCode).toBe('string')
        expect(typeof rate.serviceName).toBe('string')
      }
    })

    it('converts decimal charge amounts to minor units (×100)', async () => {
      global.fetch = makeAllServicesOkFetch({
        locker_standard: '9.99',
        locker_economy: '7.99',
        courier_standard: '12.99',
        courier_c2c: '10.99',
      })

      const rates = await inpostAdapterV1.calculateRates(makeShipmentInput())
      const byCode = Object.fromEntries(rates.map((r) => [r.serviceCode, r.amount]))

      expect(byCode['locker_standard']).toBe(999)
      expect(byCode['locker_economy']).toBe(799)
      expect(byCode['courier_standard']).toBe(1299)
      expect(byCode['courier_c2c']).toBe(1099)
    })

    it('includes expected service codes', async () => {
      global.fetch = makeAllServicesOkFetch()

      const rates = await inpostAdapterV1.calculateRates(makeShipmentInput())
      const codes = rates.map((r) => r.serviceCode)

      expect(codes).toContain('locker_standard')
      expect(codes).toContain('locker_economy')
      expect(codes).toContain('courier_standard')
      expect(codes).toContain('courier_c2c')
    })

    it('omits services where calculated_charge_amount is null (debit clients)', async () => {
      global.fetch = makeAllServicesOkFetch({ locker_economy: null })

      const rates = await inpostAdapterV1.calculateRates(makeShipmentInput())
      const codes = rates.map((r) => r.serviceCode)

      expect(codes).not.toContain('locker_economy')
      expect(rates.length).toBe(3)
    })

    it('silently skips services that return a non-ok HTTP error (e.g. missing_trucker_id)', async () => {
      global.fetch = jest.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(makeServiceResult('locker_standard', '9.99')) })
        .mockResolvedValueOnce({ ok: false, status: 400, text: () => Promise.resolve('{"error":"validation_failed"}') })
        .mockResolvedValueOnce({ ok: false, status: 400, text: () => Promise.resolve('{"error":"missing_trucker_id"}') })
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(makeServiceResult('courier_c2c', '10.99')) })

      const rates = await inpostAdapterV1.calculateRates(makeShipmentInput())
      const codes = rates.map((r) => r.serviceCode)

      expect(codes).toContain('locker_standard')
      expect(codes).toContain('courier_c2c')
      expect(codes).not.toContain('locker_economy')
      expect(codes).not.toContain('courier_standard')
      expect(rates).toHaveLength(2)
    })

    it('does not include the deprecated locker_express service', async () => {
      global.fetch = makeAllServicesOkFetch()

      const rates = await inpostAdapterV1.calculateRates(makeShipmentInput())
      expect(rates.map((r) => r.serviceCode)).not.toContain('locker_express')
    })

    it('sends parcel dimensions derived from the first package', async () => {
      const pkg = makePackage()
      global.fetch = makeAllServicesOkFetch()

      await inpostAdapterV1.calculateRates(makeShipmentInput({ packages: [pkg] }))

      const calls = (global.fetch as jest.Mock).mock.calls as [string, RequestInit][]
      // Check the first call (locker_standard) — all calls share the same parcel
      const body = JSON.parse(calls[0]![1]!.body as string) as { shipments: Array<{ parcels: Array<Record<string, unknown>> }> }
      const parcel = body.shipments[0]!.parcels[0]!
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

    it('uses small template when packages array is empty', async () => {
      global.fetch = makeAllServicesOkFetch()

      await inpostAdapterV1.calculateRates(makeShipmentInput({ packages: [] }))

      const calls = (global.fetch as jest.Mock).mock.calls as [string, RequestInit][]
      const body = JSON.parse(calls[0]![1]!.body as string) as { shipments: Array<{ parcels: Array<Record<string, unknown>> }> }
      expect(body.shipments[0]!.parcels[0]).toEqual({ template: 'small' })
    })

    it('uses receiverPhone and receiverEmail from credentials in the calculate payload', async () => {
      const phone = '600100200'
      const email = 'buyer@shop.example'
      global.fetch = makeAllServicesOkFetch()

      await inpostAdapterV1.calculateRates(makeShipmentInput({
        credentials: makeCredentials({ receiverPhone: phone, receiverEmail: email }),
      }))

      const calls = (global.fetch as jest.Mock).mock.calls as [string, RequestInit][]
      // locker call (index 0) gets both phone and email
      const lockerBody = JSON.parse(calls[0]![1]!.body as string) as { shipments: Array<Record<string, unknown>> }
      const lockerReceiver = lockerBody.shipments[0]!.receiver as Record<string, unknown>
      expect(lockerReceiver.phone).toBe(phone)
      expect(lockerReceiver.email).toBe(email)
      // courier call (index 2) gets phone only
      const courierBody = JSON.parse(calls[2]![1]!.body as string) as { shipments: Array<Record<string, unknown>> }
      const courierReceiver = courierBody.shipments[0]!.receiver as Record<string, unknown>
      expect(courierReceiver.phone).toBe(phone)
    })

    it('omits phone and email from receiver when credentials do not have receiver contact', async () => {
      global.fetch = makeAllServicesOkFetch()

      await inpostAdapterV1.calculateRates(makeShipmentInput())

      const calls = (global.fetch as jest.Mock).mock.calls as [string, RequestInit][]
      const body = JSON.parse(calls[0]![1]!.body as string) as { shipments: Array<Record<string, unknown>> }
      const receiver = body.shipments[0]!.receiver as Record<string, unknown>
      expect(receiver.phone).toBeUndefined()
    })

    it('adds custom_attributes.target_point for locker services', async () => {
      global.fetch = makeAllServicesOkFetch()

      await inpostAdapterV1.calculateRates(makeShipmentInput())

      const calls = (global.fetch as jest.Mock).mock.calls as [string, RequestInit][]
      // calls[0] = locker_standard, calls[1] = locker_economy
      for (const callIndex of [0, 1]) {
        const body = JSON.parse(calls[callIndex]![1]!.body as string) as { shipments: Array<Record<string, unknown>> }
        const shipment = body.shipments[0]!
        expect((shipment.custom_attributes as Record<string, unknown>).target_point).toBeTruthy()
      }
    })

    it('adds custom_attributes.sending_method for courier_c2c', async () => {
      global.fetch = makeAllServicesOkFetch()

      await inpostAdapterV1.calculateRates(makeShipmentInput())

      const calls = (global.fetch as jest.Mock).mock.calls as [string, RequestInit][]
      // calls[3] = courier_c2c
      const body = JSON.parse(calls[3]![1]!.body as string) as { shipments: Array<Record<string, unknown>> }
      const shipment = body.shipments[0]!
      expect((shipment.custom_attributes as Record<string, unknown>).sending_method).toBeTruthy()
    })
  })

  describe('createShipment', () => {
    function makeCreateResponse(shipmentId: string, offerId: number, overrides: Record<string, unknown> = {}) {
      return {
        id: shipmentId,
        status: 'offer_selected',
        tracking_number: null,
        offers: [{ id: offerId, status: 'selected' }],
        ...overrides,
      }
    }

    function makeBuyResponse(trackingNumber: string, overrides: Record<string, unknown> = {}) {
      return {
        status: 'confirmed',
        tracking_number: trackingNumber,
        ...overrides,
      }
    }

    function makeCreateAndBuyFetch(
      shipmentId: string,
      offerId: number,
      trackingNumber: string,
      createOverrides: Record<string, unknown> = {},
      buyOverrides: Record<string, unknown> = {},
    ) {
      return jest.fn()
        .mockResolvedValueOnce({ ok: true, status: 201, json: () => Promise.resolve(makeCreateResponse(shipmentId, offerId, createOverrides)) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(makeBuyResponse(trackingNumber, buyOverrides)) })
    }

    it('POSTs to create endpoint then calls /buy and returns shipmentId and trackingNumber', async () => {
      const shipmentId = chance.guid()
      const offerId = chance.integer({ min: 1000, max: 9999 })
      const trackingNumber = chance.string({ length: 24, pool: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' })
      const input = makeShipmentInput()
      const orgId = input.credentials.organizationId as string

      global.fetch = makeCreateAndBuyFetch(shipmentId, offerId, trackingNumber)

      const result = await inpostAdapterV1.createShipment(input)

      const calls = (global.fetch as jest.Mock).mock.calls as [string, RequestInit][]
      expect(calls).toHaveLength(2)

      const [createUrl, createInit] = calls[0]!
      expect(createUrl).toContain(`/v1/organizations/${orgId}/shipments`)
      expect(createInit.method).toBe('POST')

      const [buyUrl, buyInit] = calls[1]!
      expect(buyUrl).toContain(`/v1/shipments/${shipmentId}/buy`)
      expect(buyInit.method).toBe('POST')
      expect(JSON.parse(buyInit.body as string)).toEqual({ offer_id: offerId })

      expect(result.shipmentId).toBe(shipmentId)
      expect(result.trackingNumber).toBe(trackingNumber)
    })

    it('uses tracking_number from parcel when shipment-level tracking_number is absent after buy', async () => {
      const shipmentId = chance.guid()
      const offerId = chance.integer({ min: 1000, max: 9999 })
      const parcelTracking = chance.string({ length: 24, pool: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' })

      global.fetch = makeCreateAndBuyFetch(shipmentId, offerId, '', {}, {
        tracking_number: null,
        parcels: [{ tracking_number: parcelTracking }],
      })

      const result = await inpostAdapterV1.createShipment(makeShipmentInput())

      expect(result.trackingNumber).toBe(parcelTracking)
    })

    it('falls back to shipmentId when no tracking number is returned at all', async () => {
      const shipmentId = chance.guid()
      const offerId = chance.integer({ min: 1000, max: 9999 })

      global.fetch = makeCreateAndBuyFetch(shipmentId, offerId, '')

      const result = await inpostAdapterV1.createShipment(makeShipmentInput())

      expect(result.trackingNumber).toBe(shipmentId)
    })

    it('skips the buy step when create response contains no offer', async () => {
      const shipmentId = chance.guid()
      const trackingNumber = chance.string({ length: 24, pool: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' })

      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: () => Promise.resolve({ id: shipmentId, tracking_number: trackingNumber, offers: [] }),
      })

      const result = await inpostAdapterV1.createShipment(makeShipmentInput())

      expect((global.fetch as jest.Mock).mock.calls).toHaveLength(1)
      expect(result.trackingNumber).toBe(trackingNumber)
    })

    it('includes labelData when the create response contains a label string', async () => {
      const shipmentId = chance.guid()
      const offerId = chance.integer({ min: 1000, max: 9999 })
      const trackingNumber = chance.guid()
      const labelData = `${chance.string({ length: 40 })}==`

      global.fetch = makeCreateAndBuyFetch(shipmentId, offerId, trackingNumber, { label: labelData })

      const result = await inpostAdapterV1.createShipment(makeShipmentInput())

      expect(result.labelData).toBe(labelData)
    })

    it('includes estimatedDelivery when scheduled_delivery_end is present in create response', async () => {
      const shipmentId = chance.guid()
      const offerId = chance.integer({ min: 1000, max: 9999 })
      const trackingNumber = chance.guid()
      const deliveryDate = chance.date({ year: 2026 }) as Date
      const isoString = deliveryDate.toISOString()

      global.fetch = makeCreateAndBuyFetch(shipmentId, offerId, trackingNumber, { scheduled_delivery_end: isoString })

      const result = await inpostAdapterV1.createShipment(makeShipmentInput())

      expect(result.estimatedDelivery).toBeInstanceOf(Date)
      expect(result.estimatedDelivery?.toISOString()).toBe(isoString)
    })

    it('uses lowercase "small" template when no packages are provided', async () => {
      const shipmentId = chance.guid()
      const offerId = chance.integer({ min: 1000, max: 9999 })
      global.fetch = makeCreateAndBuyFetch(shipmentId, offerId, chance.guid())

      await inpostAdapterV1.createShipment(makeShipmentInput({ packages: [] }))

      const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit]
      const body = JSON.parse(init.body as string) as Record<string, unknown>
      expect((body.parcels as Array<{ template: string }>)[0]).toEqual({ template: 'small' })
    })

    it('uses lowercase "small" template for locker services even when packages are provided', async () => {
      const shipmentId = chance.guid()
      const offerId = chance.integer({ min: 1000, max: 9999 })
      global.fetch = makeCreateAndBuyFetch(shipmentId, offerId, chance.guid())

      await inpostAdapterV1.createShipment(makeShipmentInput({ serviceCode: 'locker_standard' }))

      const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit]
      const body = JSON.parse(init.body as string) as Record<string, unknown>
      expect((body.parcels as Array<{ template: string }>)[0]).toEqual({ template: 'small' })
    })

    it('uses nested dimensions/weight structure for courier services', async () => {
      const pkg = makePackage()
      const shipmentId = chance.guid()
      const offerId = chance.integer({ min: 1000, max: 9999 })
      global.fetch = makeCreateAndBuyFetch(shipmentId, offerId, chance.guid())

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
      const shipmentId = chance.guid()
      const offerId = chance.integer({ min: 1000, max: 9999 })
      global.fetch = makeCreateAndBuyFetch(shipmentId, offerId, chance.guid())

      await inpostAdapterV1.createShipment(makeShipmentInput({ serviceCode: 'locker_standard' }))

      const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit]
      const body = JSON.parse(init.body as string) as Record<string, unknown>
      expect(body.service).toBe('inpost_locker_standard')
    })

    it('nests address fields under receiver.address with post_code', async () => {
      const destination = makeAddress()
      const shipmentId = chance.guid()
      const offerId = chance.integer({ min: 1000, max: 9999 })
      global.fetch = makeCreateAndBuyFetch(shipmentId, offerId, chance.guid())

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
      const shipmentId = chance.guid()
      const offerId = chance.integer({ min: 1000, max: 9999 })
      global.fetch = makeCreateAndBuyFetch(shipmentId, offerId, chance.guid())

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
      const shipmentId = chance.guid()
      const offerId = chance.integer({ min: 1000, max: 9999 })
      global.fetch = makeCreateAndBuyFetch(shipmentId, offerId, chance.guid())

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
      const shipmentId = chance.guid()
      const offerId = chance.integer({ min: 1000, max: 9999 })

      global.fetch = makeCreateAndBuyFetch(shipmentId, offerId, chance.guid())

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
      const shipmentId = chance.guid()
      const offerId = chance.integer({ min: 1000, max: 9999 })
      global.fetch = makeCreateAndBuyFetch(shipmentId, offerId, chance.guid())

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
      const shipmentId = chance.guid()
      const offerId = chance.integer({ min: 1000, max: 9999 })
      global.fetch = makeCreateAndBuyFetch(shipmentId, offerId, chance.guid())

      await inpostAdapterV1.createShipment(makeShipmentInput())

      const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit]
      const body = JSON.parse(init.body as string) as Record<string, unknown>
      expect(body.custom_attributes).toBeUndefined()
    })
  }),

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
    it('throws because InPost does not support shipment cancellation via API', async () => {
      await expect(
        inpostAdapterV1.cancelShipment({ credentials: makeCredentials(), shipmentId: chance.guid() }),
      ).rejects.toThrow('InPost does not support shipment cancellation via API')
    })

    it('does not make any HTTP request', async () => {
      global.fetch = jest.fn()

      await expect(
        inpostAdapterV1.cancelShipment({ credentials: makeCredentials(), shipmentId: chance.guid() }),
      ).rejects.toThrow()

      expect(global.fetch).not.toHaveBeenCalled()
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
