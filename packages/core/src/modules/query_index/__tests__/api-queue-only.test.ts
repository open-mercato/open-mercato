const mockGetAuthFromRequest = jest.fn()
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuthFromRequest(...args),
}))

const mockCreateRequestContainer = jest.fn()
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => mockCreateRequestContainer(...args),
}))

const mockRecordIndexerLog = jest.fn(async () => undefined)
jest.mock('@open-mercato/shared/lib/indexers/status-log', () => ({
  recordIndexerLog: (...args: unknown[]) => mockRecordIndexerLog(...args),
}))

import { POST as reindexPost } from '../api/reindex'
import { POST as purgePost } from '../api/purge'

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/query_index', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('query_index API persistent job dispatch', () => {
  const emitEvent = jest.fn(async () => undefined)

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuthFromRequest.mockResolvedValue({
      tenantId: 'tenant-1',
      orgId: 'org-1',
      sub: 'user-1',
    })
    mockCreateRequestContainer.mockResolvedValue({
      resolve: jest.fn((name: string) => {
        if (name === 'em') return { em: true }
        if (name === 'eventBus') return { emitEvent }
        throw new Error(`Unexpected token: ${name}`)
      }),
    })
  })

  it('queues reindex without inline delivery', async () => {
    const res = await reindexPost(makeRequest({ entityType: 'catalog:catalog_product' }))

    expect(res.status).toBe(200)
    expect(emitEvent).toHaveBeenCalledWith(
      'query_index.reindex',
      expect.objectContaining({
        entityType: 'catalog:catalog_product',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      }),
      { persistent: true, deliverInline: false },
    )
  })

  it('queues purge without inline delivery', async () => {
    const res = await purgePost(makeRequest({ entityType: 'catalog:catalog_product' }))

    expect(res.status).toBe(200)
    expect(emitEvent).toHaveBeenCalledWith(
      'query_index.purge',
      {
        entityType: 'catalog:catalog_product',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      },
      { persistent: true, deliverInline: false },
    )
  })
})
