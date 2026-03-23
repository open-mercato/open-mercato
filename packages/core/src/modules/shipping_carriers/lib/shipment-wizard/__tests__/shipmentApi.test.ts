import Chance from 'chance'
import {
  fetchProviders,
  fetchOrderAddresses,
  fetchRates,
  createShipment,
} from '../hooks/shipmentApi'

const chance = new Chance()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

const mockApiCall = apiCall as jest.MockedFunction<typeof apiCall>

const makeProvider = () => ({ providerKey: chance.word() })

const makeAddress = () => ({
  countryCode: chance.country(),
  postalCode: chance.zip(),
  city: chance.city(),
  line1: chance.address(),
})

const makePackage = () => ({
  weightKg: chance.floating({ min: 0.1, max: 30, fixed: 1 }),
  lengthCm: chance.integer({ min: 5, max: 100 }),
  widthCm: chance.integer({ min: 5, max: 100 }),
  heightCm: chance.integer({ min: 5, max: 100 }),
})

const makeRate = () => ({
  serviceCode: chance.word(),
  serviceName: chance.sentence({ words: 3 }),
  amount: chance.floating({ min: 1, max: 100, fixed: 2 }),
  currencyCode: chance.currency().code,
  estimatedDays: chance.integer({ min: 1, max: 14 }),
})

const makeDocumentAddress = (purpose = 'shipping') => ({
  id: chance.guid(),
  purpose,
  address_line1: chance.address(),
  address_line2: chance.street(),
  city: chance.city(),
  postal_code: chance.zip(),
  country: chance.country(),
})

describe('fetchProviders', () => {
  afterEach(() => jest.clearAllMocks())

  it('returns providers on success', async () => {
    const providers = [makeProvider(), makeProvider()]
    mockApiCall.mockResolvedValueOnce({ ok: true, result: { providers } } as any)

    const result = await fetchProviders()

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.providers).toEqual(providers)
  })

  it('returns error when call fails', async () => {
    mockApiCall.mockResolvedValueOnce({ ok: false, result: null } as any)

    const result = await fetchProviders()

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBeTruthy()
  })

  it('returns error when result is null despite ok:true', async () => {
    mockApiCall.mockResolvedValueOnce({ ok: true, result: null } as any)

    const result = await fetchProviders()

    expect(result.ok).toBe(false)
  })

  it('calls the correct endpoint', async () => {
    mockApiCall.mockResolvedValueOnce({ ok: true, result: { providers: [] } } as any)

    await fetchProviders()

    expect(mockApiCall).toHaveBeenCalledWith(
      '/api/shipping-carriers/providers',
      undefined,
      expect.any(Object),
    )
  })
})

describe('fetchOrderAddresses', () => {
  afterEach(() => jest.clearAllMocks())

  it('returns items on success', async () => {
    const orderId = chance.guid()
    const items = [makeDocumentAddress(), makeDocumentAddress('delivery')]
    mockApiCall.mockResolvedValueOnce({ ok: true, result: { items } } as any)

    const result = await fetchOrderAddresses(orderId)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.items).toEqual(items)
  })

  it('returns ok:false when call fails', async () => {
    const orderId = chance.guid()
    mockApiCall.mockResolvedValueOnce({ ok: false, result: null } as any)

    const result = await fetchOrderAddresses(orderId)

    expect(result.ok).toBe(false)
  })

  it('includes orderId in the request URL', async () => {
    const orderId = chance.guid()
    mockApiCall.mockResolvedValueOnce({ ok: true, result: { items: [] } } as any)

    await fetchOrderAddresses(orderId)

    const calledUrl: string = mockApiCall.mock.calls[0][0] as string
    expect(calledUrl).toContain(orderId)
  })
})

describe('fetchRates', () => {
  afterEach(() => jest.clearAllMocks())

  const makeParams = () => ({
    providerKey: chance.word(),
    origin: makeAddress(),
    destination: makeAddress(),
    packages: [makePackage()],
  })

  it('returns rates on success', async () => {
    const rates = [makeRate(), makeRate()]
    mockApiCall.mockResolvedValueOnce({ ok: true, result: { rates } } as any)

    const result = await fetchRates(makeParams())

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.rates).toEqual(rates)
  })

  it('returns error string from response body when call fails', async () => {
    const errorMessage = chance.sentence()
    mockApiCall.mockResolvedValueOnce({
      ok: false,
      result: { error: errorMessage },
    } as any)

    const result = await fetchRates(makeParams())

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe(errorMessage)
  })

  it('returns fallback error string when body has no error field', async () => {
    mockApiCall.mockResolvedValueOnce({ ok: false, result: null } as any)

    const result = await fetchRates(makeParams())

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBeTruthy()
  })

  it('sends POST to the rates endpoint', async () => {
    mockApiCall.mockResolvedValueOnce({ ok: true, result: { rates: [] } } as any)
    const params = makeParams()

    await fetchRates(params)

    expect(mockApiCall).toHaveBeenCalledWith(
      '/api/shipping-carriers/rates',
      expect.objectContaining({ method: 'POST' }),
      expect.any(Object),
    )
  })

  it('serialises params into the request body', async () => {
    mockApiCall.mockResolvedValueOnce({ ok: true, result: { rates: [] } } as any)
    const params = makeParams()

    await fetchRates(params)

    const requestInit = mockApiCall.mock.calls[0][1] as RequestInit
    const body = JSON.parse(requestInit.body as string)
    expect(body.providerKey).toBe(params.providerKey)
    expect(body.origin).toEqual(params.origin)
    expect(body.destination).toEqual(params.destination)
    expect(body.packages).toEqual(params.packages)
  })

  it('includes receiverPhone and receiverEmail when provided', async () => {
    mockApiCall.mockResolvedValueOnce({ ok: true, result: { rates: [] } } as any)
    const params = {
      ...makeParams(),
      receiverPhone: '500000000',
      receiverEmail: 'receiver@example.com',
    }

    await fetchRates(params)

    const requestInit = mockApiCall.mock.calls[0][1] as RequestInit
    const body = JSON.parse(requestInit.body as string)
    expect(body.receiverPhone).toBe('500000000')
    expect(body.receiverEmail).toBe('receiver@example.com')
  })

  it('omits receiverPhone and receiverEmail when not provided', async () => {
    mockApiCall.mockResolvedValueOnce({ ok: true, result: { rates: [] } } as any)

    await fetchRates(makeParams())

    const requestInit = mockApiCall.mock.calls[0][1] as RequestInit
    const body = JSON.parse(requestInit.body as string)
    expect(body).not.toHaveProperty('receiverPhone')
    expect(body).not.toHaveProperty('receiverEmail')
  })
})

describe('createShipment', () => {
  afterEach(() => jest.clearAllMocks())

  const makeParams = () => ({
    providerKey: chance.word(),
    orderId: chance.guid(),
    origin: makeAddress(),
    destination: makeAddress(),
    packages: [makePackage()],
    serviceCode: chance.word(),
    labelFormat: chance.pickone(['pdf', 'zpl', 'png']),
  })

  it('returns ok:true on success', async () => {
    mockApiCall.mockResolvedValueOnce({ ok: true, result: null } as any)

    const result = await createShipment(makeParams())

    expect(result.ok).toBe(true)
  })

  it('returns error string from response body on failure', async () => {
    const errorMessage = chance.sentence()
    mockApiCall.mockResolvedValueOnce({
      ok: false,
      result: { error: errorMessage },
    } as any)

    const result = await createShipment(makeParams())

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe(errorMessage)
  })

  it('returns fallback error when body has no error field', async () => {
    mockApiCall.mockResolvedValueOnce({ ok: false, result: null } as any)

    const result = await createShipment(makeParams())

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBeTruthy()
  })

  it('sends POST to the shipments endpoint', async () => {
    mockApiCall.mockResolvedValueOnce({ ok: true, result: null } as any)
    const params = makeParams()

    await createShipment(params)

    expect(mockApiCall).toHaveBeenCalledWith(
      '/api/shipping-carriers/shipments',
      expect.objectContaining({ method: 'POST' }),
      expect.any(Object),
    )
  })

  it('serialises all params into the request body', async () => {
    mockApiCall.mockResolvedValueOnce({ ok: true, result: null } as any)
    const params = makeParams()

    await createShipment(params)

    const requestInit = mockApiCall.mock.calls[0][1] as RequestInit
    const body = JSON.parse(requestInit.body as string)
    expect(body.providerKey).toBe(params.providerKey)
    expect(body.orderId).toBe(params.orderId)
    expect(body.serviceCode).toBe(params.serviceCode)
    expect(body.labelFormat).toBe(params.labelFormat)
  })

  it('includes contact fields and targetPoint when provided', async () => {
    mockApiCall.mockResolvedValueOnce({ ok: true, result: null } as any)
    const params = {
      ...makeParams(),
      senderPhone: '100000001',
      senderEmail: 'sender@example.com',
      receiverPhone: '200000002',
      receiverEmail: 'receiver@example.com',
      targetPoint: 'KRA010',
    }

    await createShipment(params)

    const requestInit = mockApiCall.mock.calls[0][1] as RequestInit
    const body = JSON.parse(requestInit.body as string)
    expect(body.senderPhone).toBe('100000001')
    expect(body.senderEmail).toBe('sender@example.com')
    expect(body.receiverPhone).toBe('200000002')
    expect(body.receiverEmail).toBe('receiver@example.com')
    expect(body.targetPoint).toBe('KRA010')
  })
})
