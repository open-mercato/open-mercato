const resolveScopeMock = jest.fn()
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: (...args: unknown[]) => resolveScopeMock(...args),
}))

import type { AwilixContainer } from 'awilix'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { resolveAvailabilityOrganizationId } from '../organizationScope'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const HOME_ORG = '22222222-2222-4222-8222-222222222222'
const SELECTED_ORG = '33333333-3333-4333-8333-333333333333'

const container = {} as AwilixContainer
const request = new Request('http://localhost/api/availability/policies')
const auth = { sub: 'user-1', tenantId: TENANT_ID, orgId: HOME_ORG, isSuperAdmin: false } as AuthContext

describe('resolveAvailabilityOrganizationId', () => {
  beforeEach(() => resolveScopeMock.mockReset())

  it('reads the organization selected in the header for a non-superadmin, like the policy writes', async () => {
    resolveScopeMock.mockResolvedValue({
      selectedId: SELECTED_ORG,
      filterIds: [SELECTED_ORG],
      allowedIds: [HOME_ORG, SELECTED_ORG],
      tenantId: TENANT_ID,
    })

    await expect(resolveAvailabilityOrganizationId(container, auth, request)).resolves.toBe(SELECTED_ORG)
    expect(resolveScopeMock).toHaveBeenCalledWith({ container, auth, request })
  })

  it('falls back to the home organization when nothing is selected', async () => {
    resolveScopeMock.mockResolvedValue({ selectedId: null, filterIds: null, allowedIds: null, tenantId: TENANT_ID })

    await expect(resolveAvailabilityOrganizationId(container, auth, request)).resolves.toBe(HOME_ORG)
  })

  it('falls back to the home organization when the scope cannot be resolved', async () => {
    resolveScopeMock.mockRejectedValue(new Error('rbac unavailable'))

    await expect(resolveAvailabilityOrganizationId(container, auth, request)).resolves.toBe(HOME_ORG)
  })
})
