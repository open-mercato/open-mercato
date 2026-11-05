/** @jest-environment node */
import { randomUUID } from 'node:crypto'

const resolveOrganizationScopeForRequestMock = jest.fn()
const resolveAssigneeDisplayNamesMock = jest.fn()
const container = { resolve: jest.fn() }

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => container,
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: async () => ({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'auth-org' }),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: (...args: unknown[]) => resolveOrganizationScopeForRequestMock(...args),
}))

jest.mock('../lib/assigneeNames', () => ({
  resolveAssigneeDisplayNames: (...args: unknown[]) => resolveAssigneeDisplayNamesMock(...args),
}))

import { GET } from '../api/assignees/route'

describe('warranty_claims assignee endpoint organization scope', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resolveAssigneeDisplayNamesMock.mockResolvedValue(new Map())
  })

  it('uses the request-selected organization instead of the auth default organization', async () => {
    const requestedId = randomUUID()
    resolveOrganizationScopeForRequestMock.mockResolvedValue({
      tenantId: 'tenant-1',
      selectedId: 'selected-org',
      filterIds: ['selected-org'],
      allowedIds: ['auth-org', 'selected-org'],
    })

    const response = await GET(new Request(`http://localhost/api/warranty_claims/assignees?ids=${requestedId}`))

    expect(response.status).toBe(200)
    expect(resolveAssigneeDisplayNamesMock).toHaveBeenCalledWith({
      container,
      tenantId: 'tenant-1',
      organizationId: 'selected-org',
      organizationIds: ['selected-org'],
    }, [requestedId])
  })

  it('passes all visible organizations when the request selects all organizations', async () => {
    const requestedId = randomUUID()
    resolveOrganizationScopeForRequestMock.mockResolvedValue({
      tenantId: 'tenant-1',
      selectedId: null,
      filterIds: ['org-1', 'org-2'],
      allowedIds: ['org-1', 'org-2'],
    })

    const response = await GET(new Request(`http://localhost/api/warranty_claims/assignees?ids=${requestedId}`))

    expect(response.status).toBe(200)
    expect(resolveAssigneeDisplayNamesMock).toHaveBeenCalledWith({
      container,
      tenantId: 'tenant-1',
      organizationId: null,
      organizationIds: ['org-1', 'org-2'],
    }, [requestedId])
  })
})
