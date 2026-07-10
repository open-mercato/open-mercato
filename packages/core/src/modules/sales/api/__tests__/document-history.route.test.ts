/** @jest-environment node */

const mockRbac = {
  userHasAllFeatures: jest.fn(),
}
const mockActionLogService = {
  list: jest.fn(),
}
const mockEm = {
  fork: jest.fn(() => mockEm),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (token: string) => {
      if (token === 'rbacService') return mockRbac
      if (token === 'actionLogService') return mockActionLogService
      if (token === 'em') return mockEm
      return null
    },
  })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  })),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async () => []),
}))

jest.mock('@open-mercato/core/modules/audit_logs/api/audit-logs/display', () => ({
  loadAuditLogDisplayMaps: jest.fn(async () => ({ users: new Map() })),
}))

import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { GET } from '../document-history/route'

const DOCUMENT_ID = '22222222-2222-4222-8222-222222222222'

function requestFor(kind: 'order' | 'quote') {
  return new Request(`http://localhost/api/sales/document-history?kind=${kind}&id=${DOCUMENT_ID}`)
}

describe('sales document-history route authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    })
    ;(resolveOrganizationScopeForRequest as jest.Mock).mockResolvedValue({
      selectedId: 'org-1',
      allowedIds: ['org-1'],
      filterIds: ['org-1'],
    })
    mockRbac.userHasAllFeatures.mockResolvedValue(true)
    mockActionLogService.list.mockResolvedValue({ items: [] })
  })

  it.each([
    ['order', 'sales.orders.view'],
    ['quote', 'sales.quotes.view'],
  ] as const)('requires %s history readers to have %s', async (kind, requiredFeature) => {
    mockRbac.userHasAllFeatures.mockResolvedValueOnce(false)

    const response = await GET(requestFor(kind))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(mockRbac.userHasAllFeatures).toHaveBeenCalledWith('user-1', [requiredFeature], {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(mockActionLogService.list).not.toHaveBeenCalled()
    expect(findWithDecryption).not.toHaveBeenCalled()
  })

  it('continues to load history for a user with the matching document view feature', async () => {
    const response = await GET(requestFor('quote'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ items: [] })
    expect(mockRbac.userHasAllFeatures).toHaveBeenCalledWith('user-1', ['sales.quotes.view'], {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(mockActionLogService.list).toHaveBeenCalledWith(expect.objectContaining({
      resourceKind: 'sales.quote',
      resourceId: DOCUMENT_ID,
    }))
  })
})
