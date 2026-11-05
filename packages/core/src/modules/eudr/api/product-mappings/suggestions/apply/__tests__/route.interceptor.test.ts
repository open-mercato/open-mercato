/** @jest-environment node */
import { CommandInterceptorError } from '@open-mercato/shared/lib/commands/errors'

const mockGetAuthFromRequest = jest.fn()
const mockResolveOrganizationScope = jest.fn()
const mockExecute = jest.fn()
const mockRunMutationGuards = jest.fn()
const mockQuery = jest.fn()

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'commandBus') return { execute: mockExecute }
    if (token === 'queryEngine') return { query: mockQuery }
    return undefined
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((req: Request) => mockGetAuthFromRequest(req)),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn((args: unknown) => mockResolveOrganizationScope(args)),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ translate: (key: string, fallback?: string) => fallback ?? key })),
}))

jest.mock('@open-mercato/shared/lib/crud/mutation-guard-store', () => ({
  getAllMutationGuardInstances: jest.fn(() => []),
}))

jest.mock('@open-mercato/shared/lib/crud/mutation-guard-registry', () => ({
  bridgeLegacyGuard: jest.fn(() => null),
  runMutationGuards: jest.fn((...args: unknown[]) => mockRunMutationGuards(...args)),
}))

type RouteModule = typeof import('../route')
let postHandler: RouteModule['POST']

beforeAll(async () => {
  postHandler = (await import('../route')).POST
})

const BLOCKED_PRODUCT_ID = '11111111-1111-4111-8111-111111111111'
const IMPORTED_PRODUCT_ID = '22222222-2222-4222-8222-222222222222'

const buildRequest = () =>
  new Request('http://localhost/api/eudr/product-mappings/suggestions/apply', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      items: [
        { productId: BLOCKED_PRODUCT_ID, commodity: 'cocoa', hsCode: '1801' },
        { productId: IMPORTED_PRODUCT_ID, commodity: 'coffee', hsCode: '0901' },
      ],
    }),
  })

/**
 * The sibling of `eudr/api/plots/import`: the second of the two batch endpoints the
 * coverage guard exempts from the interceptor-mapping contract
 * (`ROUTES_WITH_BATCH_ITEM_ERROR_HANDLING` in
 * `packages/core/src/__tests__/command-interceptor-http-coverage.test.ts`). The guard
 * proves every bus call here sits behind a per-item `catch`; these cases pin what
 * that means for the response, so the exemption rests on observed behavior for both
 * routes rather than on one route plus an assumption about its twin.
 */
describe('eudr product mapping suggestions apply route — interceptor rejections inside the batch', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
      features: ['eudr.mappings.manage'],
    })
    mockResolveOrganizationScope.mockResolvedValue({ tenantId: 'tenant-1', selectedId: 'org-1', filterIds: ['org-1'] })
    mockRunMutationGuards.mockResolvedValue({ ok: true, afterSuccessCallbacks: [] })
    mockQuery.mockResolvedValue({ items: [] })
    mockExecute.mockResolvedValue({ result: { entityId: 'mapping-ok' } })
  })

  it('keeps a status-carrying interceptor rejection as a per-item failure and applies the rest', async () => {
    mockExecute
      .mockRejectedValueOnce(
        new CommandInterceptorError('Mapping blocked by compliance', {
          status: 422,
          body: { error: 'Mapping blocked by compliance', missingFields: ['dueDiligenceStatement'] },
        }),
      )
      .mockResolvedValueOnce({ result: { entityId: 'mapping-ok' } })

    const response = await postHandler(buildRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      created: 1,
      failed: [{ productId: BLOCKED_PRODUCT_ID, errorKey: 'eudr.errors.mapping_suggestions_apply_failed' }],
    })
    expect(mockExecute).toHaveBeenCalledTimes(2)
  })

  it('treats a statusless interceptor rejection the same way', async () => {
    mockExecute
      .mockRejectedValueOnce(new CommandInterceptorError('Blocked without a status'))
      .mockResolvedValueOnce({ result: { entityId: 'mapping-ok' } })

    const response = await postHandler(buildRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      created: 1,
      failed: [{ productId: BLOCKED_PRODUCT_ID, errorKey: 'eudr.errors.mapping_suggestions_apply_failed' }],
    })
  })

  it('answers with the route-level generic 500 when the failure happens outside the per-item loop', async () => {
    mockRunMutationGuards.mockRejectedValueOnce(new Error('guard exploded'))

    const response = await postHandler(buildRequest())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Failed to apply EUDR mapping suggestions' })
    expect(mockExecute).not.toHaveBeenCalled()
  })
})
