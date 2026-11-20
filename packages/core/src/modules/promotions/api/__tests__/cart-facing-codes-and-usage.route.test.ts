/** @jest-environment node */

// Release 4 PLAN.md Step 6.7 — thin HTTP adapter routes over the already-built
// `promotionsService` methods (Step 6.2/6.3). This suite exercises the route layer only:
// request parsing, scope resolution from `auth` (never the request body), status-code
// mapping, and the `release` route's own codeString→codeId resolution — all with a faked
// DI container/EntityManager, same convention as `packages/core/src/modules/api_keys/api/
// __tests__/keys.route.test.ts`. The business logic itself (reservation eligibility, row
// locking, budget accounting) is already covered by `lib/__tests__/code-service.test.ts`
// and `lib/__tests__/promotion-usage-service.test.ts` — this suite fakes
// `promotionsService` rather than re-proving that logic.

import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

type ReserveCodeInput = { codeString: string; cartId: string; customerId: string | null }
type UseCodeInput = ReserveCodeInput & { codeId: string; type: 'static' | 'dynamic' }

type FakePromotionsService = {
  reserveCode: jest.Mock
  validateCode: jest.Mock
  useCode: jest.Mock
  releaseCode: jest.Mock
  registerUsage: jest.Mock
  revertUsage: jest.Mock
}

function fakePromotionsService(): FakePromotionsService {
  return {
    reserveCode: jest.fn(),
    validateCode: jest.fn(),
    useCode: jest.fn(),
    releaseCode: jest.fn(),
    registerUsage: jest.fn(),
    revertUsage: jest.fn(),
  }
}

interface MockEntityManager {
  findOne: jest.Mock
  fork: jest.Mock
}

const mockEm: MockEntityManager = {
  findOne: jest.fn(),
  fork: jest.fn(),
}

const mockGetAuthFromRequest = jest.fn()
const mockResolveScope = jest.fn()
const mockRegister = jest.fn()

let currentPromotionsService: FakePromotionsService = fakePromotionsService()

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'promotionsService') return currentPromotionsService
    if (token === 'em') return mockEm
    // `runRouteMutationGuards` probes `crudMutationGuardService`/`rbacService` and
    // tolerates either being absent (both resolvers catch and fall back) — resolve them
    // to `null` here instead of throwing, matching an environment that genuinely has no
    // legacy guard service / RBAC registered, rather than exercising their catch paths.
    if (token === 'crudMutationGuardService' || token === 'rbacService') return null
    throw new Error(`[internal] unexpected DI resolve in test: ${token}`)
  }),
  register: mockRegister,
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((request: Request) => mockGetAuthFromRequest(request)),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn((args: unknown) => mockResolveScope(args)),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  })),
}))

const TENANT_ID = '123e4567-e89b-12d3-a456-426614174000'
const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CART_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const CODE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const PROMOTION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

type ReserveRoute = typeof import('../codes/reserve/route')
type ValidateRoute = typeof import('../codes/validate/route')
type UseRoute = typeof import('../codes/use/route')
type ReleaseRoute = typeof import('../codes/release/route')
type RegisterRoute = typeof import('../usage/register/route')
type RevertRoute = typeof import('../usage/revert/route')

let reservePost: ReserveRoute['POST']
let validatePost: ValidateRoute['POST']
let usePost: UseRoute['POST']
let releasePost: ReleaseRoute['POST']
let registerPost: RegisterRoute['POST']
let revertPost: RevertRoute['POST']

beforeAll(async () => {
  reservePost = (await import('../codes/reserve/route')).POST
  validatePost = (await import('../codes/validate/route')).POST
  usePost = (await import('../codes/use/route')).POST
  releasePost = (await import('../codes/release/route')).POST
  registerPost = (await import('../usage/register/route')).POST
  revertPost = (await import('../usage/revert/route')).POST
})

function postJson(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('promotions cart-facing codes/usage routes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    currentPromotionsService = fakePromotionsService()
    mockContainer.resolve.mockImplementation((token: string) => {
      if (token === 'promotionsService') return currentPromotionsService
      if (token === 'em') return mockEm
      if (token === 'crudMutationGuardService' || token === 'rbacService') return null
      throw new Error(`[internal] unexpected DI resolve in test: ${token}`)
    })
    mockEm.fork.mockReturnValue(mockEm)
    mockEm.findOne.mockResolvedValue(null)
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: TENANT_ID, orgId: null })
    mockResolveScope.mockResolvedValue({ selectedId: ORG_ID, filterIds: [ORG_ID], allowedIds: [ORG_ID] })
  })

  describe('POST /api/promotions/codes/reserve', () => {
    it('reserves a code and never threads organizationId/tenantId from the body', async () => {
      currentPromotionsService.reserveCode.mockResolvedValue({ ok: true, codeId: CODE_ID, type: 'static' })

      const res = await reservePost(
        postJson('http://localhost/api/promotions/codes/reserve', {
          codeString: 'SAVE10',
          cartId: CART_ID,
          customerId: null,
          // Forged scope fields a malicious/confused caller might attach — must never
          // reach the service call or override the auth-resolved scope.
          organizationId: 'org-EVIL',
          tenantId: 'tenant-EVIL',
        }),
      )

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toEqual({ ok: true, codeId: CODE_ID, type: 'static' })

      expect(currentPromotionsService.reserveCode).toHaveBeenCalledTimes(1)
      const calledInput = currentPromotionsService.reserveCode.mock.calls[0][0] as Record<string, unknown>
      expect(calledInput).toEqual({ codeString: 'SAVE10', cartId: CART_ID, customerId: null })
      expect(calledInput.organizationId).toBeUndefined()
      expect(calledInput.tenantId).toBeUndefined()

      // Scope used to register `auth` onto the container comes from the resolved
      // organization scope (ORG_ID), never the body's forged `org-EVIL`. `asValue(...)`
      // wraps the value in an awilix resolver, so unwrap it via `.resolve()`.
      expect(mockRegister).toHaveBeenCalledTimes(1)
      const registeredAuth = (mockRegister.mock.calls[0][0] as { auth: { resolve: () => unknown } }).auth.resolve()
      expect(registeredAuth).toMatchObject({ orgId: ORG_ID, tenantId: TENANT_ID })
    })

    it('answers the uniform code_invalid error for an unknown/inactive/exhausted code', async () => {
      currentPromotionsService.reserveCode.mockRejectedValue(new CrudHttpError(422, { error: 'code_invalid' }))

      const res = await reservePost(
        postJson('http://localhost/api/promotions/codes/reserve', {
          codeString: 'NOPE',
          cartId: CART_ID,
          customerId: null,
        }),
      )

      expect(res.status).toBe(422)
      const body = await res.json()
      expect(body).toEqual({ error: 'code_invalid' })
    })
  })

  describe('POST /api/promotions/codes/validate', () => {
    it('answers 200 with valid: false rather than an error status', async () => {
      currentPromotionsService.validateCode.mockResolvedValue({ valid: false, reason: 'code_invalid' })

      const res = await validatePost(
        postJson('http://localhost/api/promotions/codes/validate', {
          codeString: 'NOPE',
          cartId: CART_ID,
          customerId: null,
        }),
      )

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toEqual({ valid: false, reason: 'code_invalid' })
    })

    it('answers 200 with valid: true for an eligible code', async () => {
      currentPromotionsService.validateCode.mockResolvedValue({ valid: true })

      const res = await validatePost(
        postJson('http://localhost/api/promotions/codes/validate', {
          codeString: 'SAVE10',
          cartId: CART_ID,
          customerId: null,
        }),
      )

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ valid: true })
    })
  })

  describe('POST /api/promotions/codes/use', () => {
    it('redeems a code', async () => {
      currentPromotionsService.useCode.mockResolvedValue({ ok: true })

      const input: UseCodeInput = {
        codeId: CODE_ID,
        codeString: 'SAVE10',
        cartId: CART_ID,
        customerId: null,
        type: 'static',
      }
      const res = await usePost(postJson('http://localhost/api/promotions/codes/use', input))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true })
      expect(currentPromotionsService.useCode).toHaveBeenCalledWith(input)
    })
  })

  describe('POST /api/promotions/codes/release', () => {
    it('resolves codeString to codeId via resolveCodeByString before calling releaseCode', async () => {
      mockEm.findOne.mockImplementation(async (_entity: unknown, criteria: Record<string, unknown>) => {
        if (criteria.code === 'SAVE10') return { id: CODE_ID, code: 'SAVE10' }
        return null
      })
      currentPromotionsService.releaseCode.mockResolvedValue(undefined)

      const res = await releasePost(
        postJson('http://localhost/api/promotions/codes/release', {
          codeString: 'SAVE10',
          cartId: CART_ID,
          customerId: null,
        }),
      )

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true })
      expect(currentPromotionsService.releaseCode).toHaveBeenCalledWith(CODE_ID, CART_ID)
    })

    it('no-ops for an unknown code string without calling releaseCode', async () => {
      mockEm.findOne.mockResolvedValue(null)

      const res = await releasePost(
        postJson('http://localhost/api/promotions/codes/release', {
          codeString: 'NOPE',
          cartId: CART_ID,
          customerId: null,
        }),
      )

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true })
      expect(currentPromotionsService.releaseCode).not.toHaveBeenCalled()
    })
  })

  describe('POST /api/promotions/usage/register', () => {
    const appliedPromotions = [
      {
        promotionId: PROMOTION_ID,
        promotionName: 'Promo',
        effects: [{ type: 'LINE_DISCOUNT', amountNet: '-10.00' }],
      },
    ]

    it('answers 200 when no promotion exceeded its budget, never reading scope from the body', async () => {
      currentPromotionsService.registerUsage.mockResolvedValue({ ok: true, budgetExceeded: [] })

      const res = await registerPost(
        postJson('http://localhost/api/promotions/usage/register', {
          orderId: 'order-1',
          orderType: 'order',
          customerId: null,
          currency: 'USD',
          appliedPromotions,
          organizationId: 'org-EVIL',
          tenantId: 'tenant-EVIL',
        }),
      )

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true, budgetExceeded: [] })
      expect(mockRegister).toHaveBeenCalledTimes(1)
      const registeredAuth = (mockRegister.mock.calls[0][0] as { auth: { resolve: () => unknown } }).auth.resolve()
      expect(registeredAuth).toMatchObject({ orgId: ORG_ID, tenantId: TENANT_ID })
    })

    it('answers a real 207 Multi-Status when a promotion exceeded its budget, same body shape', async () => {
      currentPromotionsService.registerUsage.mockResolvedValue({ ok: true, budgetExceeded: [PROMOTION_ID] })

      const res = await registerPost(
        postJson('http://localhost/api/promotions/usage/register', {
          orderId: 'order-1',
          orderType: 'order',
          customerId: null,
          currency: 'USD',
          appliedPromotions,
        }),
      )

      expect(res.status).toBe(207)
      expect(await res.json()).toEqual({ ok: true, budgetExceeded: [PROMOTION_ID] })
    })
  })

  describe('POST /api/promotions/usage/revert', () => {
    it('reverts usage for an order', async () => {
      currentPromotionsService.revertUsage.mockResolvedValue({ ok: true, revertedCount: 2 })

      const res = await revertPost(postJson('http://localhost/api/promotions/usage/revert', { orderId: 'order-1' }))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true, revertedCount: 2 })
      expect(currentPromotionsService.revertUsage).toHaveBeenCalledWith({ orderId: 'order-1' })
    })
  })
})
