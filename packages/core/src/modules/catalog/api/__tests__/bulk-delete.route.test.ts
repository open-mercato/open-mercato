/** @jest-environment node */

const createJob = jest.fn(async () => ({ id: '22222222-2222-4222-8222-222222222222' }))
const enqueue = jest.fn(async () => undefined)

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (token: string) => (token === 'progressService' ? { createJob } : null),
  })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(),
}))

jest.mock('../../lib/bulkDelete', () => ({
  CATALOG_PRODUCT_BULK_DELETE_QUEUE: 'catalog-product-bulk-delete',
  getCatalogQueue: jest.fn(() => ({ enqueue })),
}))

import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { POST } from '../bulk-delete/route'

function request(body: unknown) {
  return new Request('http://localhost/api/catalog/products/bulk-delete', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('catalog bulk-delete route — organization scoping', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    createJob.mockResolvedValue({ id: '22222222-2222-4222-8222-222222222222' })
  })

  it('scopes the progress job and queued payload to the selected organization, not the home organization', async () => {
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-home',
    })
    ;(resolveOrganizationScopeForRequest as jest.Mock).mockResolvedValue({
      selectedId: 'org-selected',
      filterIds: ['org-selected'],
      allowedIds: ['org-home', 'org-selected'],
      tenantId: 'tenant-1',
    })

    const response = await POST(request({
      confirm: true,
      ids: ['11111111-1111-4111-8111-111111111111'],
      scope: 'selected',
    }))

    expect(response.status).toBe(202)
    expect(createJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tenantId: 'tenant-1', organizationId: 'org-selected' }),
    )
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: expect.objectContaining({ organizationId: 'org-selected', tenantId: 'tenant-1' }),
      }),
    )
  })

  it('falls back to the home organization when none is selected', async () => {
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-home',
    })
    ;(resolveOrganizationScopeForRequest as jest.Mock).mockResolvedValue({
      selectedId: null,
      filterIds: null,
      allowedIds: null,
      tenantId: 'tenant-1',
    })

    const response = await POST(request({
      confirm: true,
      ids: ['11111111-1111-4111-8111-111111111111'],
      scope: 'selected',
    }))

    expect(response.status).toBe(202)
    expect(createJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tenantId: 'tenant-1', organizationId: 'org-home' }),
    )
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: expect.objectContaining({ organizationId: 'org-home', tenantId: 'tenant-1' }),
      }),
    )
  })
})
