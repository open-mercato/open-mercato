/** @jest-environment node */
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  createOrganizationInDb,
  deleteIntegrationCredentialsInDb,
  deleteOrganizationInDb,
  deleteUserAclInDb,
} from '@open-mercato/core/helpers/integration/dbFixtures'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { XERO_TEST_FAKES_PATH } from '../__integration__/helpers/xeroTestFakes'
import {
  closeXeroSeamOrganization,
  openXeroSeamOrganization,
  XERO_SEAM_ORGANIZATION_FEATURES,
} from '../__integration__/helpers/xeroSeamOrganization'

jest.mock('@open-mercato/core/helpers/integration/api', () => ({
  ...jest.requireActual('@open-mercato/core/helpers/integration/api'),
  getAuthToken: jest.fn(),
}))
jest.mock('@open-mercato/core/helpers/integration/generalFixtures', () => ({
  ...jest.requireActual('@open-mercato/core/helpers/integration/generalFixtures'),
  getTokenScope: jest.fn(() => ({ organizationId: 'admin-org', tenantId: 'tenant-1', userId: 'admin-user' })),
}))
jest.mock('@open-mercato/core/helpers/integration/authFixtures', () => ({
  createRoleFixture: jest.fn(),
  createUserFixture: jest.fn(),
  deleteRoleIfExists: jest.fn(async () => undefined),
  deleteUserIfExists: jest.fn(async () => undefined),
  setUserAclVisibility: jest.fn(async () => undefined),
}))
jest.mock('@open-mercato/core/helpers/integration/dbFixtures', () => ({
  createOrganizationInDb: jest.fn(),
  deleteIntegrationCredentialsInDb: jest.fn(async () => undefined),
  deleteOrganizationInDb: jest.fn(async () => undefined),
  deleteUserAclInDb: jest.fn(async () => undefined),
}))

type FetchCall = { path: string; method: string; data?: unknown; authorization?: string }

function fakeRequest(calls: FetchCall[], probeStatus: number) {
  return {
    fetch: async (path: string, options: { method: string; data?: unknown; headers?: Record<string, string> }) => {
      calls.push({ path, method: options.method, data: options.data, authorization: options.headers?.Authorization })
      const isProbe = (options.data as { action?: string } | undefined)?.action === '__probe__'
      const status = isProbe ? probeStatus : 200
      const body = isProbe && status === 404 ? { error: 'Not found' } : { reset: true, mappings: 0 }
      return {
        ok: () => status >= 200 && status < 300,
        status: () => status,
        text: async () => JSON.stringify(body),
      }
    },
  } as never
}

const fixtureMocks = [
  createOrganizationInDb,
  createRoleFixture,
  createUserFixture,
  setUserAclVisibility,
  getAuthToken,
  deleteUserIfExists,
  deleteUserAclInDb,
  deleteRoleIfExists,
  deleteIntegrationCredentialsInDb,
  deleteOrganizationInDb,
] as jest.Mock[]

function expectNoCredentialWrite(calls: FetchCall[]): void {
  expect(calls.filter((call) => call.path.includes('/credentials'))).toEqual([])
}

describe('the throwaway organization behind TC-XERO-005', () => {
  const originalFlag = process.env.OM_ENABLE_TEST_OAUTH_GRANTS

  beforeEach(() => {
    delete process.env.OM_ENABLE_TEST_OAUTH_GRANTS
    for (const mock of fixtureMocks) mock.mockClear()
    ;(createOrganizationInDb as jest.Mock).mockResolvedValue('fixture-org')
    ;(createRoleFixture as jest.Mock).mockResolvedValue('fixture-role')
    ;(createUserFixture as jest.Mock).mockResolvedValue('fixture-user')
    ;(getAuthToken as jest.Mock).mockResolvedValue('fixture-token')
  })

  afterAll(() => {
    if (originalFlag === undefined) delete process.env.OM_ENABLE_TEST_OAUTH_GRANTS
    else process.env.OM_ENABLE_TEST_OAUTH_GRANTS = originalFlag
  })

  it('creates and cleans up nothing when the seam is off, so the skipped spec writes no credentials', async () => {
    const calls: FetchCall[] = []
    const request = fakeRequest(calls, 404)

    const organization = await openXeroSeamOrganization(request, 'admin-token', 'TC-XERO-005')
    await closeXeroSeamOrganization(request, 'admin-token', organization)

    expect(organization).toBeNull()
    expect(calls).toEqual([
      { path: XERO_TEST_FAKES_PATH, method: 'POST', data: { action: '__probe__' }, authorization: 'Bearer admin-token' },
    ])
    for (const mock of fixtureMocks) expect(mock).not.toHaveBeenCalled()
  })

  it('scopes the user to a new organization in the admin tenant and removes only that organization', async () => {
    const calls: FetchCall[] = []
    const request = fakeRequest(calls, 400)

    const organization = await openXeroSeamOrganization(request, 'admin-token', 'TC-XERO-005')
    expect(organization).toEqual({ organizationId: 'fixture-org', roleId: 'fixture-role', userId: 'fixture-user', token: 'fixture-token' })
    expect(createOrganizationInDb).toHaveBeenCalledWith({ name: expect.stringMatching(/^TC-XERO-005 /), tenantId: 'tenant-1' })
    expect(createUserFixture).toHaveBeenCalledWith(request, 'admin-token', expect.objectContaining({ organizationId: 'fixture-org', roles: ['fixture-role'] }))
    expect(setUserAclVisibility).toHaveBeenCalledWith(request, 'admin-token', {
      userId: 'fixture-user',
      features: XERO_SEAM_ORGANIZATION_FEATURES,
      organizations: ['fixture-org'],
    })

    await closeXeroSeamOrganization(request, 'admin-token', organization)

    expect(calls.slice(1)).toEqual([
      { path: XERO_TEST_FAKES_PATH, method: 'POST', data: { action: 'reset' }, authorization: 'Bearer fixture-token' },
    ])
    expectNoCredentialWrite(calls)
    expect(deleteUserIfExists).toHaveBeenCalledWith(request, 'admin-token', 'fixture-user')
    expect(deleteUserAclInDb).toHaveBeenCalledWith('fixture-user')
    expect(deleteRoleIfExists).toHaveBeenCalledWith(request, 'admin-token', 'fixture-role')
    expect(deleteIntegrationCredentialsInDb).toHaveBeenCalledTimes(1)
    expect(deleteIntegrationCredentialsInDb).toHaveBeenCalledWith('fixture-org')
    expect(deleteOrganizationInDb).toHaveBeenCalledTimes(1)
    expect(deleteOrganizationInDb).toHaveBeenCalledWith('fixture-org')
  })

  it('removes what it created when setting up the organization fails part way', async () => {
    const calls: FetchCall[] = []
    const request = fakeRequest(calls, 400)
    ;(createUserFixture as jest.Mock).mockRejectedValue(new Error('[internal] user create failed'))

    await expect(openXeroSeamOrganization(request, 'admin-token', 'TC-XERO-005')).rejects.toThrow('user create failed')

    expect(calls).toHaveLength(1)
    expectNoCredentialWrite(calls)
    expect(deleteUserIfExists).toHaveBeenCalledWith(request, 'admin-token', null)
    expect(deleteRoleIfExists).toHaveBeenCalledWith(request, 'admin-token', 'fixture-role')
    expect(deleteIntegrationCredentialsInDb).toHaveBeenCalledWith('fixture-org')
    expect(deleteOrganizationInDb).toHaveBeenCalledWith('fixture-org')
  })
})
