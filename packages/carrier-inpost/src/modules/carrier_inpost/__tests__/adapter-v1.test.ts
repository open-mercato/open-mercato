import { inpostAdapterV1 } from '../lib/adapters/v1'
import type { CreateShipmentInput } from '@open-mercato/core/modules/shipping_carriers/lib/adapter'

const baseCredentials = { apiToken: 'tok', organizationId: 'org-1' }

const baseOrigin = {
  name: 'Sender Name',
  line1: 'Sender Street 1',
  city: 'Warsaw',
  postalCode: '00-001',
  countryCode: 'PL',
}

const baseDestination = {
  name: 'Receiver Name',
  line1: 'Receiver Street 2',
  city: 'Krakow',
  postalCode: '30-001',
  countryCode: 'PL',
}

const baseShipmentInput: CreateShipmentInput = {
  credentials: baseCredentials,
  orderId: 'order-123',
  serviceCode: 'locker_standard',
  origin: baseOrigin,
  destination: baseDestination,
  packages: [{ weightKg: 1.5, lengthCm: 20, widthCm: 15, heightCm: 10 }],
}

describe('inpostAdapterV1', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  describe('calculateRates', () => {
    it('returns 4 fixed PLN rates for any input', async () => {
      const rates = await inpostAdapterV1.calculateRates(baseShipmentInput)

      expect(rates).toHaveLength(4)
      for (const rate of rates) {
        expect(rate.currencyCode).toBe('PLN')
        expect(rate.amount).toBeGreaterThan(0)
        expect(typeof rate.serviceCode).toBe('string')
        expect(typeof rate.serviceName).toBe('string')
      }
    })

    it('includes expected service codes', async () => {
      const rates = await inpostAdapterV1.calculateRates(baseShipmentInput)
      const codes = rates.map((r) => r.serviceCode)

      expect(codes).toContain('locker_standard')
      expect(codes).toContain('locker_express')
      expect(codes).toContain('courier_standard')
      expect(codes).toContain('courier_c2c')
    })
  })

  describe('createShipment', () => {
    it('POSTs to the correct URL and returns shipmentId and trackingNumber', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: () => Promise.resolve({ id: 'shp-001', tracking_number: 'TRK001' }),
      })
      global.fetch = mockFetch

      const result = await inpostAdapterV1.createShipment(baseShipmentInput)

      expect(mockFetch).toHaveBeenCalledTimes(1)
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/v1/organizations/org-1/shipments')
      expect(init.method).toBe('POST')
      expect(result.shipmentId).toBe('shp-001')
      expect(result.trackingNumber).toBe('TRK001')
    })

    it('falls back to shipment id when tracking_number is absent', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: () => Promise.resolve({ id: 'shp-002' }),
      })
      global.fetch = mockFetch

      const result = await inpostAdapterV1.createShipment(baseShipmentInput)

      expect(result.trackingNumber).toBe('shp-002')
    })

    it('includes labelData when the response contains a label string', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: () =>
          Promise.resolve({
            id: 'shp-003',
            tracking_number: 'TRK003',
            label: 'base64labeldata==',
          }),
      })
      global.fetch = mockFetch

      const result = await inpostAdapterV1.createShipment(baseShipmentInput)

      expect(result.labelData).toBe('base64labeldata==')
    })

    it('includes estimatedDelivery when scheduled_delivery_end is present', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: () =>
          Promise.resolve({
            id: 'shp-004',
            tracking_number: 'TRK004',
            scheduled_delivery_end: '2026-03-16T18:00:00Z',
          }),
      })
      global.fetch = mockFetch

      const result = await inpostAdapterV1.createShipment(baseShipmentInput)

      expect(result.estimatedDelivery).toBeInstanceOf(Date)
      expect(result.estimatedDelivery?.toISOString()).toBe('2026-03-16T18:00:00.000Z')
    })

    it('uses SMALL template when no packages are provided', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: () => Promise.resolve({ id: 'shp-005', tracking_number: 'TRK005' }),
      })
      global.fetch = mockFetch

      const inputWithoutPackages: CreateShipmentInput = { ...baseShipmentInput, packages: [] }
      await inpostAdapterV1.createShipment(inputWithoutPackages)

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
      const body = JSON.parse(init.body as string) as Record<string, unknown>
      expect((body.parcels as Array<{ template: string }>)[0]).toEqual({ template: 'SMALL' })
    })

    it('maps serviceCode via mapServiceCodeToInpost before sending', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: () => Promise.resolve({ id: 'shp-006', tracking_number: 'TRK006' }),
      })
      global.fetch = mockFetch

      await inpostAdapterV1.createShipment(baseShipmentInput)

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
      const body = JSON.parse(init.body as string) as Record<string, unknown>
      expect(body.service).toBe('inpost_locker_standard')
    })

    it('includes line2 as building_number when provided', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: () => Promise.resolve({ id: 'shp-007', tracking_number: 'TRK007' }),
      })
      global.fetch = mockFetch

      const inputWithLine2: CreateShipmentInput = {
        ...baseShipmentInput,
        destination: { ...baseDestination, line2: '5A' },
      }
      await inpostAdapterV1.createShipment(inputWithLine2)

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
      const body = JSON.parse(init.body as string) as Record<string, unknown>
      expect((body.receiver as Record<string, unknown>).building_number).toBe('5A')
    })
  })

  describe('getTracking', () => {
    it('fetches tracking by trackingNumber and maps status and events', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            tracking_number: 'TRK001',
            status: 'delivered',
            tracking_details: [
              { status: 'taken_by_courier', datetime: '2026-03-14T08:00:00Z' },
              { status: 'delivered', datetime: '2026-03-15T14:00:00Z' },
            ],
          }),
      })
      global.fetch = mockFetch

      const result = await inpostAdapterV1.getTracking({
        credentials: baseCredentials,
        trackingNumber: 'TRK001',
      })

      expect(result.trackingNumber).toBe('TRK001')
      expect(result.status).toBe('delivered')
      expect(result.events).toHaveLength(2)
      expect(result.events[0]?.status).toBe('in_transit')
      expect(result.events[1]?.status).toBe('delivered')
    })

    it('falls back to shipmentId when trackingNumber is not provided', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({ tracking_number: 'TRK-X', status: 'in_transit', tracking_details: [] }),
      })
      global.fetch = mockFetch

      await inpostAdapterV1.getTracking({ credentials: baseCredentials, shipmentId: 'shp-999' })

      const [url] = mockFetch.mock.calls[0] as [string]
      expect(url).toContain('shp-999')
    })

    it('throws when neither trackingNumber nor shipmentId is provided', async () => {
      await expect(
        inpostAdapterV1.getTracking({ credentials: baseCredentials }),
      ).rejects.toThrow('trackingNumber or shipmentId is required')
    })

    it('returns empty events array when tracking_details is absent', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ tracking_number: 'TRK001', status: 'in_transit' }),
      })
      global.fetch = mockFetch

      const result = await inpostAdapterV1.getTracking({
        credentials: baseCredentials,
        trackingNumber: 'TRK001',
      })

      expect(result.events).toEqual([])
    })
  })

  describe('cancelShipment', () => {
    it('sends DELETE to correct URL and returns cancelled status', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: jest.fn(),
      })
      global.fetch = mockFetch

      const result = await inpostAdapterV1.cancelShipment({
        credentials: baseCredentials,
        shipmentId: 'shp-cancel-1',
      })

      expect(result.status).toBe('cancelled')
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
      expect(url).toContain('/v1/organizations/org-1/shipments/shp-cancel-1')
      expect(init.method).toBe('DELETE')
    })

    it('URL-encodes shipmentId with special characters', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: jest.fn(),
      })
      global.fetch = mockFetch

      await inpostAdapterV1.cancelShipment({
        credentials: baseCredentials,
        shipmentId: 'shp/with spaces',
      })

      const [url] = mockFetch.mock.calls[0] as [string]
      expect(url).toContain('shp%2Fwith%20spaces')
    })
  })

  describe('mapStatus', () => {
    it('delegates to mapInpostStatus for known statuses', () => {
      expect(inpostAdapterV1.mapStatus('delivered')).toBe('delivered')
      expect(inpostAdapterV1.mapStatus('canceled')).toBe('cancelled')
      expect(inpostAdapterV1.mapStatus('taken_by_courier')).toBe('in_transit')
    })

    it('returns "unknown" for unrecognized statuses', () => {
      expect(inpostAdapterV1.mapStatus('some_future_status')).toBe('unknown')
    })
  })

  describe('verifyWebhook', () => {
    it('returns a webhook event for valid JSON payload', async () => {
      const body = JSON.stringify({ id: 'evt-1', status: 'delivered', created_at: '2026-03-14T10:00:00Z' })

      const event = await inpostAdapterV1.verifyWebhook({
        rawBody: body,
        headers: {},
        credentials: {},
      })

      expect(event.eventType).toBe('delivered')
      expect(event.eventId).toBe('evt-1')
    })
  })
})
