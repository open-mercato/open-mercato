/** @jest-environment node */

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

const mockContainer = {
  resolve: jest.fn(),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(),
}))

jest.mock('../../lib/bulkCreateMutationGuards', () => ({
  runBulkCreateMutationGuards: jest.fn(async () => ({ ok: true })),
}))

const mockQueue = { enqueue: jest.fn(async () => undefined) }

jest.mock('../../lib/catalogQueue', () => ({
  getCatalogQueue: jest.fn(() => mockQueue),
}))

import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { runBulkCreateMutationGuards } from '../../lib/bulkCreateMutationGuards'
import { POST as postProductsBulkCreate } from '../products/bulk-create/route'
import { POST as postCategoriesBulkCreate } from '../categories/bulk-create/route'

function request(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('catalog bulk-create routes — organization scoping', () => {
  const createJob = jest.fn(async (_input: unknown, scope: { organizationId: string | null }) => ({
    id: '11111111-1111-4111-8111-111111111111',
    ...scope,
  }))

  beforeEach(() => {
    jest.clearAllMocks()
    createJob.mockClear()
    mockQueue.enqueue.mockClear()
    mockContainer.resolve.mockImplementation((token: string) =>
      token === 'progressService' ? { createJob } : null,
    )
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: 'tenant-1',
      // The caller's home organization — must NOT be used once a different
      // organization is selected via the header (issue #6427).
      orgId: 'org-home',
    })
  })

  it('products/bulk-create creates the job and enqueues under the selected organization, not the caller\'s home org', async () => {
    ;(resolveOrganizationScopeForRequest as jest.Mock).mockResolvedValue({
      selectedId: 'org-b',
      filterIds: ['org-b'],
      allowedIds: null,
      tenantId: 'tenant-1',
    })

    const response = await postProductsBulkCreate(
      request('/api/catalog/products/bulk-create', { items: [{ title: 'Widget' }] }),
    )

    expect(response.status).toBe(202)
    expect(runBulkCreateMutationGuards as jest.Mock).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-b' }),
    )
    expect(createJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: 'org-b' }),
    )
    expect(mockQueue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ scope: expect.objectContaining({ organizationId: 'org-b' }) }),
    )
  })

  it('categories/bulk-create creates the job and enqueues under the selected organization, not the caller\'s home org', async () => {
    ;(resolveOrganizationScopeForRequest as jest.Mock).mockResolvedValue({
      selectedId: 'org-b',
      filterIds: ['org-b'],
      allowedIds: null,
      tenantId: 'tenant-1',
    })

    const response = await postCategoriesBulkCreate(
      request('/api/catalog/categories/bulk-create', { items: [{ name: 'Widgets' }] }),
    )

    expect(response.status).toBe(202)
    expect(runBulkCreateMutationGuards as jest.Mock).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-b' }),
    )
    expect(createJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: 'org-b' }),
    )
    expect(mockQueue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ scope: expect.objectContaining({ organizationId: 'org-b' }) }),
    )
  })

  it('falls back to the account organization when no organization is selected', async () => {
    ;(resolveOrganizationScopeForRequest as jest.Mock).mockResolvedValue({
      selectedId: null,
      filterIds: ['org-home'],
      allowedIds: null,
      tenantId: 'tenant-1',
    })

    const response = await postProductsBulkCreate(
      request('/api/catalog/products/bulk-create', { items: [{ title: 'Widget' }] }),
    )

    expect(response.status).toBe(202)
    expect(createJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: 'org-home' }),
    )
  })
})
