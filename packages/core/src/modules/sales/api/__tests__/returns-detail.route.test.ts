/** @jest-environment node */

const mockEm = {
  fork: jest.fn(() => mockEm),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (token: string) => (token === 'em' ? mockEm : null),
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
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(async () => []),
}))

import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { GET } from '../returns/[id]/route'

const RETURN_ID = '33333333-3333-4333-8333-333333333333'

function request() {
  return new Request(`http://localhost/api/sales/returns/${RETURN_ID}`)
}

describe('sales return detail — organization scoping', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue({
      id: RETURN_ID,
      order: { id: 'order-1' },
      returnNumber: 'R-1',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    })
  })

  it('loads the return by its tenant-unique id under the "All organizations" scope', async () => {
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: null,
      isSuperAdmin: true,
    })
    ;(resolveOrganizationScopeForRequest as jest.Mock).mockResolvedValue({
      selectedId: null,
      filterIds: null,
      allowedIds: null,
      tenantId: 'tenant-1',
    })

    const response = await GET(request(), { params: { id: RETURN_ID } })

    expect(response.status).toBe(200)
    const where = (findOneWithDecryption as jest.Mock).mock.calls[0][2]
    expect(where).toMatchObject({ id: RETURN_ID, tenantId: 'tenant-1' })
    expect(where).not.toHaveProperty('organizationId')
  })

  it('narrows to the caller\'s visible organizations when restricted', async () => {
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-a',
    })
    ;(resolveOrganizationScopeForRequest as jest.Mock).mockResolvedValue({
      selectedId: 'org-a',
      filterIds: ['org-a'],
      allowedIds: ['org-a'],
      tenantId: 'tenant-1',
    })

    const response = await GET(request(), { params: { id: RETURN_ID } })

    expect(response.status).toBe(200)
    const where = (findOneWithDecryption as jest.Mock).mock.calls[0][2]
    expect(where).toMatchObject({
      id: RETURN_ID,
      tenantId: 'tenant-1',
      organizationId: { $in: ['org-a'] },
    })
  })
})
