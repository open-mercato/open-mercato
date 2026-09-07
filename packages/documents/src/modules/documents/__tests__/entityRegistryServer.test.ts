import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const mockIsDocumentEntityRegistryModuleEnabled = jest.fn((_entry: unknown) => true)

jest.mock('../lib/entityRegistryAvailability.server', () => ({
  isDocumentEntityRegistryModuleEnabled: (entry: unknown) => (
    mockIsDocumentEntityRegistryModuleEnabled(entry)
  ),
}))

import {
  verifyEntityRegistrySelection,
  verifyEntityRegistrySelections,
  verifyEntityRegistryTargetAccess,
} from '../lib/entityRegistry.server'

const OFFER_ID = '11111111-1111-4111-8111-111111111111'
const PRODUCT_ID = '22222222-2222-4222-8222-222222222222'
const PRODUCT_HREF = `/backend/catalog/products/${PRODUCT_ID}`

function request(): Request {
  return new Request('https://mercato.example/api/documents/instantiate', {
    headers: {
      cookie: 'session=allowed',
      authorization: 'Bearer allowed',
      'x-not-forwarded': 'private',
    },
  })
}

describe('server entity-registry verification', () => {
  const originalAppUrl = process.env.APP_URL
  const originalNodeEnv = process.env.NODE_ENV

  beforeEach(() => {
    process.env.APP_URL = 'https://mercato.example'
    process.env.NODE_ENV = 'test'
    mockIsDocumentEntityRegistryModuleEnabled.mockReset().mockReturnValue(true)
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
    if (originalAppUrl === undefined) delete process.env.APP_URL
    else process.env.APP_URL = originalAppUrl
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = originalNodeEnv
  })

  it('re-reads ID-addressable records and returns only authoritative snapshots', async () => {
    const fetchImpl = jest.fn(async () => new Response(JSON.stringify({
      items: [{ id: PRODUCT_ID, title: 'Authoritative product', sku: 'SKU-1' }],
    }), { status: 200 }))
    await expect(verifyEntityRegistrySelection(request(), {
      entityType: 'product',
      entityId: PRODUCT_ID,
      label: 'Caller supplied label',
      href: `/backend/catalog/products/${OFFER_ID}`,
    }, { fetchImpl })).resolves.toMatchObject({
      id: PRODUCT_ID,
      label: 'Authoritative product',
      href: PRODUCT_HREF,
      values: { title: 'Authoritative product', subtitle: null, sku: 'SKU-1' },
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    const absent = jest.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 }))
    await expect(verifyEntityRegistrySelection(request(), {
      entityType: 'product',
      entityId: PRODUCT_ID,
      label: 'Product',
      href: PRODUCT_HREF,
    }, { fetchImpl: absent })).rejects.toBeInstanceOf(CrudHttpError)
  })

  it('proves an offer parent href using only same-origin authenticated headers', async () => {
    const fetchImpl = jest.fn(async () => new Response(JSON.stringify({
      items: [{ id: OFFER_ID, title: 'Annual offer', productId: PRODUCT_ID }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))

    await expect(verifyEntityRegistrySelection(request(), {
      entityType: 'catalog-offer',
      entityId: OFFER_ID,
      label: 'Annual offer',
      href: PRODUCT_HREF,
    }, { fetchImpl })).resolves.toMatchObject({ id: OFFER_ID, href: PRODUCT_HREF })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, options] = fetchImpl.mock.calls[0]!
    expect(String(url)).toBe(`https://mercato.example/api/catalog/offers?id=${OFFER_ID}&pageSize=1`)
    expect(options).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'manual' })
    const headers = options?.headers as Headers
    expect(headers.get('cookie')).toBe('session=allowed')
    expect(headers.get('authorization')).toBe('Bearer allowed')
    expect(headers.get('x-not-forwarded')).toBeNull()
  })

  it('forwards x-api-key-only credentials for link and batched template verification', async () => {
    const apiKeyRequest = new Request('https://mercato.example/api/documents/instantiate', {
      headers: {
        'x-api-key': 'om_test_registry_key',
        'x-not-forwarded': 'private',
      },
    })
    const fetchImpl = jest.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input))
      if (url.pathname === '/api/catalog/products') {
        return new Response(JSON.stringify({
          items: [{ id: PRODUCT_ID, title: 'Authoritative product', sku: 'SKU-1' }],
        }), { status: 200 })
      }
      return new Response(JSON.stringify({
        items: [{ id: OFFER_ID, title: 'Annual offer', productId: PRODUCT_ID }],
      }), { status: 200 })
    })

    await verifyEntityRegistrySelection(apiKeyRequest, {
      entityType: 'product',
      entityId: PRODUCT_ID,
      label: 'Product',
      href: PRODUCT_HREF,
    }, { fetchImpl })
    await verifyEntityRegistrySelections(apiKeyRequest, [{
      entityType: 'catalog-offer',
      entityId: OFFER_ID,
      label: 'Annual offer',
      href: PRODUCT_HREF,
    }], { fetchImpl })

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    for (const [url, options] of fetchImpl.mock.calls) {
      expect(new URL(String(url)).origin).toBe('https://mercato.example')
      expect(options).toMatchObject({ redirect: 'manual', cache: 'no-store' })
      const headers = options?.headers as Headers
      expect(headers.get('x-api-key')).toBe('om_test_registry_key')
      expect(headers.get('cookie')).toBeNull()
      expect(headers.get('authorization')).toBeNull()
      expect(headers.get('x-not-forwarded')).toBeNull()
    }
  })

  it('fails closed before a credentialed peer fetch when the module is disabled', async () => {
    mockIsDocumentEntityRegistryModuleEnabled.mockReturnValue(false)
    const fetchImpl = jest.fn()

    await expect(verifyEntityRegistrySelection(request(), {
      entityType: 'catalog-offer',
      entityId: OFFER_ID,
      label: 'Annual offer',
      href: PRODUCT_HREF,
    }, { fetchImpl })).rejects.toMatchObject({
      status: 503,
      body: { error: 'documents.links.targetUnavailable' },
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('ignores spoofed request URL and Host values when forwarding credentials', async () => {
    const spoofedRequest = new Request('https://attacker.example/api/documents/instantiate', {
      headers: {
        host: 'attacker.example',
        'x-forwarded-host': 'attacker.example',
        'x-forwarded-proto': 'https',
        cookie: 'session=still-trusted-only',
        authorization: 'Bearer still-trusted-only',
      },
    })
    const fetchImpl = jest.fn(async () => new Response(JSON.stringify({
      items: [{ id: OFFER_ID, title: 'Annual offer', productId: PRODUCT_ID }],
    }), { status: 200 }))

    await verifyEntityRegistrySelection(spoofedRequest, {
      entityType: 'catalog-offer',
      entityId: OFFER_ID,
      label: 'Annual offer',
      href: PRODUCT_HREF,
    }, { fetchImpl })

    const [url, options] = fetchImpl.mock.calls[0]!
    expect(new URL(String(url)).origin).toBe('https://mercato.example')
    expect(String(url)).not.toContain('attacker.example')
    const headers = options?.headers as Headers
    expect(headers.get('cookie')).toBe('session=still-trusted-only')
    expect(headers.get('authorization')).toBe('Bearer still-trusted-only')
  })

  it('fails closed on mismatch, restriction, or upstream unavailability', async () => {
    const input = {
      entityType: 'catalog-offer' as const,
      entityId: OFFER_ID,
      label: 'Annual offer',
      href: PRODUCT_HREF,
    }
    const mismatch = jest.fn(async () => new Response(JSON.stringify({
      items: [{ id: PRODUCT_ID, title: 'Different offer', productId: OFFER_ID }],
    }), { status: 200 }))
    await expect(verifyEntityRegistrySelection(request(), input, { fetchImpl: mismatch }))
      .rejects.toMatchObject({ status: 400 })

    const restricted = jest.fn(async () => new Response(null, { status: 403 }))
    await expect(verifyEntityRegistrySelection(request(), input, { fetchImpl: restricted }))
      .rejects.toMatchObject({ status: 403 })

    const unavailable = jest.fn(async () => { throw new Error('offline') })
    await expect(verifyEntityRegistrySelection(request(), input, { fetchImpl: unavailable }))
      .rejects.toMatchObject({ status: 503 })

    const absentOptionalModule = jest.fn(async () => new Response(null, { status: 404 }))
    await expect(verifyEntityRegistrySelection(request(), input, { fetchImpl: absentOptionalModule }))
      .rejects.toMatchObject({ status: 503 })
  })

  it('maps missing and restricted exact-record lookups to the same non-oracular denial', async () => {
    const input = { entityType: 'product' as const, entityId: PRODUCT_ID }
    const missing = jest.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 }))
    const notFound = jest.fn(async () => new Response(null, { status: 404 }))
    const restricted = jest.fn(async () => new Response(null, { status: 403 }))

    for (const fetchImpl of [missing, notFound, restricted]) {
      await expect(verifyEntityRegistryTargetAccess(request(), input, { fetchImpl }))
        .rejects.toMatchObject({
          status: 403,
          body: { error: 'documents.links.targetRestricted' },
        })
    }
  })

  it('keeps exact-record infrastructure failures retryable without querying document links', async () => {
    const unavailable = jest.fn(async () => new Response(null, { status: 500 }))

    await expect(verifyEntityRegistryTargetAccess(request(), {
      entityType: 'product',
      entityId: PRODUCT_ID,
    }, { fetchImpl: unavailable })).rejects.toMatchObject({
      status: 503,
      body: { error: 'documents.links.targetUnavailable' },
    })
  })

  it('bounds a hanging lookup and maps the timeout to a retryable 503', async () => {
    jest.useFakeTimers()
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(
      async (_input, init) => new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
      }),
    )
    const pending = verifyEntityRegistrySelection(request(), {
      entityType: 'catalog-offer',
      entityId: OFFER_ID,
      label: 'Annual offer',
      href: PRODUCT_HREF,
    }, { timeoutMs: 25 })
    const assertion = expect(pending).rejects.toMatchObject({
      status: 503,
      body: { error: 'documents.links.targetUnavailable' },
    })

    await jest.advanceTimersByTimeAsync(25)
    await assertion
    const signal = fetchSpy.mock.calls[0]?.[1]?.signal
    expect(signal?.aborted).toBe(true)
  })

  it('bounds a response body that stalls after sending headers', async () => {
    jest.useFakeTimers()
    const cancel = jest.fn()
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"items":['))
      },
      cancel,
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const pending = verifyEntityRegistrySelection(request(), {
      entityType: 'catalog-offer',
      entityId: OFFER_ID,
      label: 'Annual offer',
      href: PRODUCT_HREF,
    }, { timeoutMs: 25 })
    const assertion = expect(pending).rejects.toMatchObject({ status: 503 })

    await jest.advanceTimersByTimeAsync(25)
    await assertion
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('combines caller cancellation with the lookup timeout and returns 503', async () => {
    const controller = new AbortController()
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(
      async (_input, init) => new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
      }),
    )
    const callerRequest = new Request('https://mercato.example/api/documents/instantiate', {
      headers: request().headers,
      signal: controller.signal,
    })
    const pending = verifyEntityRegistrySelection(callerRequest, {
      entityType: 'catalog-offer',
      entityId: OFFER_ID,
      label: 'Annual offer',
      href: PRODUCT_HREF,
    })

    controller.abort(new Error('caller disconnected'))

    await expect(pending).rejects.toMatchObject({ status: 503 })
    const fetchSignal = fetchSpy.mock.calls[0]?.[1]?.signal
    expect(fetchSignal?.aborted).toBe(true)
  })

  it('degrades to 503 without issuing a credentialed fetch when production APP_URL is missing', async () => {
    delete process.env.APP_URL
    process.env.NODE_ENV = 'production'
    const fetchSpy = jest.spyOn(globalThis, 'fetch')

    await expect(verifyEntityRegistrySelection(request(), {
      entityType: 'catalog-offer',
      entityId: OFFER_ID,
      label: 'Annual offer',
      href: PRODUCT_HREF,
    })).rejects.toMatchObject({ status: 503 })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('deduplicates selections and never runs more than four offer lookups concurrently', async () => {
    let active = 0
    let maxActive = 0
    const fetchImpl = jest.fn(async (url: URL | RequestInfo) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 2))
      active -= 1
      const id = new URL(String(url)).searchParams.get('id')!
      return new Response(JSON.stringify({ items: [{ id, title: 'Offer', productId: PRODUCT_ID }] }), {
        status: 200,
      })
    })
    const selections = Array.from({ length: 10 }, (_, index) => ({
      entityType: 'catalog-offer' as const,
      entityId: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
      label: `Offer ${index}`,
      href: PRODUCT_HREF,
    }))

    await verifyEntityRegistrySelections(request(), [...selections, selections[0]!], { fetchImpl })

    expect(fetchImpl).toHaveBeenCalledTimes(10)
    expect(maxActive).toBe(4)
  })
})
