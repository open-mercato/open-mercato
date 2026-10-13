/** @jest-environment node */
import { createFakeContainer } from './support/fakeContainer'

const mockControlLoaded = jest.fn()
const mockStartSeam = jest.fn()
const mockGetAuthFromRequest = jest.fn()
const mockCreateRequestContainer = jest.fn()
const mockResolveOrganizationScope = jest.fn()

jest.mock('../lib/testing/seam-control', () => {
  mockControlLoaded()
  const actual = jest.requireActual('../lib/testing/seam-control')
  return { ...actual, startSeam: (...args: unknown[]) => mockStartSeam(...args) }
})

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuthFromRequest(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => mockCreateRequestContainer(...args),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: (...args: unknown[]) => mockResolveOrganizationScope(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))

import { POST, metadata } from '../api/post/test-fakes/route'

const ORG_ID = '22222222-2222-4222-8222-222222222222'
const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const savedFlag = process.env.OM_ENABLE_TEST_OAUTH_GRANTS

function post(body: unknown): Promise<Response> {
  return POST(new Request('http://localhost:3000/api/sync_xero/test-fakes', { method: 'POST', body: JSON.stringify(body) }))
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID })
  mockResolveOrganizationScope.mockResolvedValue({ selectedId: ORG_ID, filterIds: [ORG_ID], allowedIds: null, tenantId: TENANT_ID })
  mockCreateRequestContainer.mockResolvedValue(
    createFakeContainer({
      rbacService: { userHasAllFeatures: async () => true, getGrantedFeatures: async () => ['integrations.*'] },
    }),
  )
})

afterAll(() => {
  if (savedFlag === undefined) delete process.env.OM_ENABLE_TEST_OAUTH_GRANTS
  else process.env.OM_ENABLE_TEST_OAUTH_GRANTS = savedFlag
})

describe('POST /api/sync_xero/test-fakes', () => {
  it('requires integrations.credentials.manage', () => {
    expect(metadata).toEqual({ path: '/sync_xero/test-fakes', POST: { requireAuth: true, requireFeatures: ['integrations.credentials.manage'] } })
  })

  it.each([undefined, 'false', '0'])('answers 404 with the flag %p before loading any fake', async (flag) => {
    if (flag === undefined) delete process.env.OM_ENABLE_TEST_OAUTH_GRANTS
    else process.env.OM_ENABLE_TEST_OAUTH_GRANTS = flag
    const response = await post({ action: 'start' })
    expect(response.status).toBe(404)
    expect(mockControlLoaded).not.toHaveBeenCalled()
    expect(mockStartSeam).not.toHaveBeenCalled()
  })

  it('runs an action with the flag on and maps a seam refusal to 409', async () => {
    process.env.OM_ENABLE_TEST_OAUTH_GRANTS = 'true'
    const { SeamConflictError } = jest.requireActual('../lib/testing/seam-control')
    mockStartSeam.mockRejectedValueOnce(new SeamConflictError('real_xero_state'))
    const refused = await post({ action: 'start' })
    expect(refused.status).toBe(409)
    expect(await refused.json()).toMatchObject({ code: 'real_xero_state' })

    mockStartSeam.mockResolvedValueOnce({ started: true, clientId: 'om_test_seam_00', authorizationEndpoint: 'http://127.0.0.1:1/authorize' })
    const started = await post({ action: 'start' })
    expect(started.status).toBe(200)
    expect(mockStartSeam).toHaveBeenLastCalledWith({ container: expect.anything(), scope: { tenantId: TENANT_ID, organizationId: ORG_ID }, userId: 'user-1' })
  })

  it('rejects an unknown action with 400', async () => {
    process.env.OM_ENABLE_TEST_OAUTH_GRANTS = 'true'
    const response = await post({ action: '__probe__' })
    expect(response.status).toBe(400)
  })
})
