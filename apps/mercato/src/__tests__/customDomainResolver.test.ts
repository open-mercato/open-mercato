import { createCustomDomainRouter } from '../lib/customDomainResolver'

type FetchInit = Parameters<typeof fetch>[1]

function makeFetchMock(
  handler: (url: string, init: FetchInit) => Response | Promise<Response>,
): jest.Mock {
  return jest.fn(async (input: Parameters<typeof fetch>[0], init?: FetchInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    return handler(url, init)
  })
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('customDomainResolver', () => {
  const baseDeps = {
    origin: 'http://internal.test',
    secret: 'test-secret',
    fetchTimeoutMs: 1_000,
    logger: { warn: () => {}, error: () => {} } as Pick<Console, 'warn' | 'error'>,
  }

  it('warmUp primes the cache from the batch endpoint and avoids per-host fetches', async () => {
    const fetchImpl = makeFetchMock((url) => {
      if (url.endsWith('/api/customer-accounts/domain-resolve/all')) {
        return jsonResponse(200, {
          ok: true,
          domains: [
            {
              hostname: 'shop.acme.com',
              tenantId: 't1',
              organizationId: 'o1',
              orgSlug: 'acme',
              status: 'active',
            },
          ],
        })
      }
      throw new Error(`unexpected url: ${url}`)
    })
    const router = createCustomDomainRouter({
      ...baseDeps,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    const result = await router.warmUp()
    expect(result).toEqual({ primed: 1 })
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    const resolved = await router.resolve('shop.acme.com')
    expect(resolved?.orgSlug).toBe('acme')
    // Still only one HTTP call — the resolve was served from the warmed cache.
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('falls back to per-host fetch when warm-up cannot be performed', async () => {
    const fetchImpl = makeFetchMock((url) => {
      if (url.includes('/api/customer-accounts/domain-resolve?host=')) {
        return jsonResponse(200, {
          ok: true,
          tenantId: 't1',
          organizationId: 'o1',
          orgSlug: 'acme',
          status: 'active',
        })
      }
      throw new Error(`unexpected url: ${url}`)
    })
    const router = createCustomDomainRouter({
      ...baseDeps,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    const resolved = await router.resolve('shop.acme.com')
    expect(resolved?.orgSlug).toBe('acme')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const calledUrl = (fetchImpl.mock.calls[0]![0] as string)
    expect(calledUrl).toBe(
      'http://internal.test/api/customer-accounts/domain-resolve?host=shop.acme.com',
    )
    expect((fetchImpl.mock.calls[0]![1] as RequestInit | undefined)?.headers).toMatchObject({
      'X-Domain-Resolve-Secret': 'test-secret',
    })
  })

  it('treats 404 from the resolve endpoint as "not mapped" without throwing', async () => {
    const fetchImpl = makeFetchMock(() => jsonResponse(404, { ok: false, error: 'Not found' }))
    const router = createCustomDomainRouter({
      ...baseDeps,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(await router.resolve('mystery.example.com')).toBeNull()
  })

  it('warmUp returns an error descriptor when the upstream is misconfigured', async () => {
    const router = createCustomDomainRouter({
      origin: null,
      secret: null,
      fetchTimeoutMs: 1_000,
      fetchImpl: (() => {
        throw new Error('should not be called')
      }) as unknown as typeof fetch,
      logger: { warn: () => {}, error: () => {} } as Pick<Console, 'warn' | 'error'>,
    })
    const result = await router.warmUp()
    expect(result).toEqual({ primed: 0, error: expect.any(String) })
  })
})
