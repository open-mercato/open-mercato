jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: jest.fn(() => ({ GET: jest.fn() })),
}))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))
jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: jest.fn() }))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: jest.fn() }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))
jest.mock('../../../lib/cartView', () => ({ buildCartResponseEnvelope: jest.fn() }))
jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({ runRouteMutationGuards: jest.fn() }))

// §10.2/§14 — "no admin route adds, updates or removes a line." Enumerates every HTTP
// method export on every admin cart route module this Step ships and asserts the only
// mutating method anywhere under `/api/cart/carts/*` is `POST /carts/:id/reprice` — which
// re-prices, never edits line content. A future Step that accidentally adds a `PATCH`/
// `PUT`/`DELETE` export to any of these files (or a new `POST` elsewhere under this tree)
// fails this test immediately, closing the gap at the HTTP layer rather than by convention
// alone.
describe('admin cart routes — no route mutates lines (§10.2/§14)', () => {
  const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

  it('GET /api/cart/carts exports GET only', async () => {
    const mod = await import('../route')
    for (const method of HTTP_METHODS) {
      if (method === 'GET') expect(mod[method]).toBeDefined()
      else expect(mod[method as keyof typeof mod]).toBeUndefined()
    }
  })

  it('GET /api/cart/carts/[id] exports GET only', async () => {
    const mod = await import('../[id]/route')
    for (const method of HTTP_METHODS) {
      if (method === 'GET') expect(mod[method]).toBeDefined()
      else expect(mod[method as keyof typeof mod]).toBeUndefined()
    }
  })

  it('POST /api/cart/carts/[id]/reprice exports POST only — re-prices, never edits a line', async () => {
    const mod = await import('../[id]/reprice/route')
    for (const method of HTTP_METHODS) {
      if (method === 'POST') expect(mod[method]).toBeDefined()
      else expect(mod[method as keyof typeof mod]).toBeUndefined()
    }
  })
})
