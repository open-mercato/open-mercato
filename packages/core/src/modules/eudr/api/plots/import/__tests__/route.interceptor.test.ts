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

const SUPPLIER_ID = '11111111-1111-4111-8111-111111111111'

const buildRequest = () =>
  new Request('http://localhost/api/eudr/plots/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      supplierEntityId: SUPPLIER_ID,
      defaultCountry: 'PL',
      featureCollection: {
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', properties: { name: 'Blocked plot' }, geometry: { type: 'Point', coordinates: [1, 2] } },
          { type: 'Feature', properties: { name: 'Imported plot' }, geometry: { type: 'Point', coordinates: [3, 4] } },
        ],
      },
    }),
  })

/**
 * This route is a batch endpoint, and the coverage guard exempts it from the
 * interceptor-mapping contract (`ROUTES_WITH_BATCH_ITEM_ERROR_HANDLING` in
 * `packages/core/src/__tests__/command-interceptor-http-coverage.test.ts`). These
 * cases pin what it does instead, so the exemption describes real behavior rather
 * than an assumption: a per-item interceptor block stays an item failure and the
 * rest of the batch still imports.
 */
describe('eudr plots import route — interceptor rejections inside the batch', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
      features: ['eudr.plots.manage'],
    })
    mockResolveOrganizationScope.mockResolvedValue({ tenantId: 'tenant-1', selectedId: 'org-1', filterIds: ['org-1'] })
    mockRunMutationGuards.mockResolvedValue({ ok: true, afterSuccessCallbacks: [] })
    mockQuery.mockResolvedValue({ items: [] })
    mockExecute.mockResolvedValue({ result: { entityId: 'plot-ok' } })
  })

  it('keeps a status-carrying interceptor rejection as a per-item failure and imports the rest', async () => {
    mockExecute
      .mockRejectedValueOnce(
        new CommandInterceptorError('Plot blocked by compliance', {
          status: 422,
          body: { error: 'Plot blocked by compliance', missingFields: ['producerName'] },
        }),
      )
      .mockResolvedValueOnce({ result: { entityId: 'plot-ok' } })

    const response = await postHandler(buildRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      created: 1,
      failed: [{ index: 0, name: 'Blocked plot', errorKey: 'eudr.errors.plot_import_failed' }],
    })
    expect(mockExecute).toHaveBeenCalledTimes(2)
  })

  it('treats a statusless interceptor rejection the same way', async () => {
    mockExecute
      .mockRejectedValueOnce(new CommandInterceptorError('Blocked without a status'))
      .mockResolvedValueOnce({ result: { entityId: 'plot-ok' } })

    const response = await postHandler(buildRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      created: 1,
      failed: [{ index: 0, name: 'Blocked plot', errorKey: 'eudr.errors.plot_import_failed' }],
    })
  })

  it('answers with the route-level generic 500 when the failure happens outside the per-item loop', async () => {
    mockRunMutationGuards.mockRejectedValueOnce(new Error('guard exploded'))

    const response = await postHandler(buildRequest())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Failed to import plots' })
    expect(mockExecute).not.toHaveBeenCalled()
  })
})
