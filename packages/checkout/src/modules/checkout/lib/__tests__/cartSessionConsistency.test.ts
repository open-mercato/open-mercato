// Release 5, Step 3.5 (C9, D-R5-19, X13). The reusable mismatch guard, wired at session
// creation (`commands/session.ts`) and left ready for Step 4.1 to call again at submit.
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  assertCartMatchesCheckoutScope,
  resolveRequestStoreIdForConsistencyCheck,
} from '../cartSessionConsistency'

const BASE_CART = {
  storeId: null as string | null,
  channel: 'storefront',
  currencyCode: 'USD',
  tenantId: 'tenant-1',
  organizationId: 'org-1',
}

const BASE_SESSION = {
  channel: 'storefront',
  currencyCode: 'USD',
  tenantId: 'tenant-1',
  organizationId: 'org-1',
}

describe('assertCartMatchesCheckoutScope (C9)', () => {
  it('passes when every applicable field matches and the cart has no store (X13 — store check skipped)', () => {
    expect(() =>
      assertCartMatchesCheckoutScope({ cart: BASE_CART, session: BASE_SESSION, resolvedStoreId: null }),
    ).not.toThrow()
  })

  it('passes when the cart has a store and it matches the resolved store', () => {
    expect(() =>
      assertCartMatchesCheckoutScope({
        cart: { ...BASE_CART, storeId: 'store-1' },
        session: BASE_SESSION,
        resolvedStoreId: 'store-1',
      }),
    ).not.toThrow()
  })

  it('refuses with 409 cart_store_mismatch when the cart has a store and it differs from the resolved one', () => {
    let captured: unknown
    try {
      assertCartMatchesCheckoutScope({
        cart: { ...BASE_CART, storeId: 'store-1' },
        session: BASE_SESSION,
        resolvedStoreId: 'store-2',
      })
    } catch (err) {
      captured = err
    }
    expect(isCrudHttpError(captured)).toBe(true)
    expect((captured as CrudHttpError).status).toBe(409)
    expect((captured as CrudHttpError).body).toMatchObject({ code: 'cart_store_mismatch', reason: 'store' })
  })

  it('skips the store comparison entirely when the cart has no store, even if a store resolved for the request', () => {
    expect(() =>
      assertCartMatchesCheckoutScope({ cart: BASE_CART, session: BASE_SESSION, resolvedStoreId: 'store-unrelated' }),
    ).not.toThrow()
  })

  it('refuses on a channel mismatch, regardless of the store', () => {
    let captured: unknown
    try {
      assertCartMatchesCheckoutScope({
        cart: BASE_CART,
        session: { ...BASE_SESSION, channel: 'pos' },
        resolvedStoreId: null,
      })
    } catch (err) {
      captured = err
    }
    expect((captured as CrudHttpError).body).toMatchObject({ code: 'cart_store_mismatch', reason: 'channel' })
  })

  it('refuses on a currency mismatch', () => {
    let captured: unknown
    try {
      assertCartMatchesCheckoutScope({
        cart: BASE_CART,
        session: { ...BASE_SESSION, currencyCode: 'EUR' },
        resolvedStoreId: null,
      })
    } catch (err) {
      captured = err
    }
    expect((captured as CrudHttpError).body).toMatchObject({ code: 'cart_store_mismatch', reason: 'currency' })
  })

  it('refuses on a tenant or organization mismatch', () => {
    let captured: unknown
    try {
      assertCartMatchesCheckoutScope({
        cart: BASE_CART,
        session: { ...BASE_SESSION, organizationId: 'org-2' },
        resolvedStoreId: null,
      })
    } catch (err) {
      captured = err
    }
    expect((captured as CrudHttpError).body).toMatchObject({ code: 'cart_store_mismatch', reason: 'tenant_organization' })
  })
})

describe('resolveRequestStoreIdForConsistencyCheck (X13 + §3.4)', () => {
  function makeContainer(opts: { storeContextService?: unknown } = {}) {
    return {
      resolve: (token: string): any => {
        if (token === 'storeContextService') {
          if (opts.storeContextService !== undefined) return opts.storeContextService
          throw new Error('storeContextService is not registered')
        }
        throw new Error(`Unexpected DI token: ${token}`)
      },
    }
  }

  it('returns null immediately for a null cart storeId, never resolving storeContextService (X13)', async () => {
    const container = makeContainer()
    const result = await resolveRequestStoreIdForConsistencyCheck(container, null, new Request('https://merchant.example'))
    expect(result).toBeNull()
  })

  it('resolves the request-side store id when the cart has a store', async () => {
    const resolve = jest.fn(async () => ({ store: { id: 'store-9' } }))
    const container = makeContainer({ storeContextService: { resolve } })
    const request = new Request('https://merchant.example')
    const result = await resolveRequestStoreIdForConsistencyCheck(container, 'store-9', request)
    expect(result).toBe('store-9')
    expect(resolve).toHaveBeenCalledWith(request, { fresh: true })
  })

  it('throws 503 checkout_sessions_unavailable when the cart has a store but ecommerce is not registered', async () => {
    const container = makeContainer()
    let captured: unknown
    try {
      await resolveRequestStoreIdForConsistencyCheck(container, 'store-9', new Request('https://merchant.example'))
    } catch (err) {
      captured = err
    }
    expect((captured as CrudHttpError).status).toBe(503)
    expect((captured as CrudHttpError).body).toMatchObject({ code: 'checkout_sessions_unavailable' })
  })

  it('throws 503 checkout_sessions_unavailable when the cart has a store but there is no request to resolve from', async () => {
    const container = makeContainer({ storeContextService: { resolve: jest.fn() } })
    let captured: unknown
    try {
      await resolveRequestStoreIdForConsistencyCheck(container, 'store-9', undefined)
    } catch (err) {
      captured = err
    }
    expect((captured as CrudHttpError).status).toBe(503)
  })

  it('degrades to null (not a throw) when resolution fails — the caller reports it as a mismatch, not a second availability error', async () => {
    const resolve = jest.fn(async () => {
      throw new Error('no store mapped to this host')
    })
    const container = makeContainer({ storeContextService: { resolve } })
    const result = await resolveRequestStoreIdForConsistencyCheck(container, 'store-9', new Request('https://merchant.example'))
    expect(result).toBeNull()
  })
})
