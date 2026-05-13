/** @jest-environment node */

import type { AwilixContainer } from 'awilix'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'

const mockResolveOrganizationScopeForRequest = jest.fn()
const mockGetSelectedOrganizationFromRequest = jest.fn()
const auth: NonNullable<AuthContext> = { sub: 'user-1', tenantId: 'tenant-1', orgId: 'auth-org' }
const container = {} as AwilixContainer

jest.mock('@open-mercato/core/modules/directory/constants', () => ({
  isAllOrganizationsSelection: (value: string | null | undefined) => value === '__all__',
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  getSelectedOrganizationFromRequest: jest.fn((request: Request) => mockGetSelectedOrganizationFromRequest(request)),
  resolveOrganizationScopeForRequest: jest.fn((params: unknown) => mockResolveOrganizationScopeForRequest(params)),
}))

describe('resolveSyncExcelConcreteScope', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetSelectedOrganizationFromRequest.mockReturnValue('org-1')
    mockResolveOrganizationScopeForRequest.mockResolvedValue({
      selectedId: 'org-1',
      filterIds: ['org-1'],
      allowedIds: ['org-1'],
      tenantId: 'tenant-1',
    })
  })

  it('resolves only an explicitly selected concrete organization', async () => {
    const { resolveSyncExcelConcreteScope } = await import('../scope')

    const result = await resolveSyncExcelConcreteScope({
      auth,
      container,
      request: new Request('http://localhost/api/sync_excel/upload'),
    })

    expect(result).toEqual({
      ok: true,
      scope: {
        organizationId: 'org-1',
        tenantId: 'tenant-1',
      },
    })
    expect(mockResolveOrganizationScopeForRequest).toHaveBeenCalledWith(expect.objectContaining({
      selectedId: 'org-1',
    }))
  })

  it('rejects All organizations without falling back to auth.orgId', async () => {
    const { resolveSyncExcelConcreteScope } = await import('../scope')
    mockGetSelectedOrganizationFromRequest.mockReturnValueOnce('__all__')

    const result = await resolveSyncExcelConcreteScope({
      auth,
      container,
      request: new Request('http://localhost/api/sync_excel/upload'),
    })

    expect(result).toEqual({
      ok: false,
      status: 422,
      error: 'Select a concrete organization before importing CSV.',
    })
    expect(mockResolveOrganizationScopeForRequest).not.toHaveBeenCalled()
  })

  it('rejects unresolved concrete organization selections', async () => {
    const { resolveSyncExcelConcreteScope } = await import('../scope')
    mockGetSelectedOrganizationFromRequest.mockReturnValueOnce('missing-org')
    mockResolveOrganizationScopeForRequest.mockResolvedValueOnce({
      selectedId: 'auth-org',
      filterIds: ['auth-org'],
      allowedIds: ['auth-org'],
      tenantId: 'tenant-1',
    })

    const result = await resolveSyncExcelConcreteScope({
      auth,
      container,
      request: new Request('http://localhost/api/sync_excel/upload'),
    })

    expect(result).toEqual({
      ok: false,
      status: 422,
      error: 'Select a concrete organization before importing CSV.',
    })
  })
})
