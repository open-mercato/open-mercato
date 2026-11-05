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
  const validateMutation = jest.fn()
  const afterMutationSuccess = jest.fn(async () => undefined)

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuthFromRequest.mockResolvedValue({
      tenantId: 'tenant-1',
      orgId: 'org-1',
      sub: 'user-1',
    })
    validateMutation.mockResolvedValue({ ok: true, shouldRunAfterSuccess: true, metadata: { guard: true } })
    mockCreateRequestContainer.mockResolvedValue({
      resolve: jest.fn((name: string) => {
        if (name === 'em') return { em: true }
        if (name === 'eventBus') return { emitEvent }
        if (name === 'crudMutationGuardService') return { validateMutation, afterMutationSuccess }
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

  it('runs the mutation guard before and after a reindex write', async () => {
    const res = await reindexPost(makeRequest({ entityType: 'catalog:catalog_product' }))

    expect(res.status).toBe(200)
    expect(validateMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        userId: 'user-1',
        resourceKind: 'query_index',
        resourceId: 'catalog:catalog_product',
        operation: 'custom',
        requestMethod: 'POST',
        requestHeaders: expect.any(Headers),
        mutationPayload: expect.objectContaining({ entityType: 'catalog:catalog_product' }),
      }),
    )
    expect(afterMutationSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceKind: 'query_index',
        resourceId: 'catalog:catalog_product',
        operation: 'custom',
        metadata: { guard: true },
      }),
    )
    expect(validateMutation.mock.invocationCallOrder[0]).toBeLessThan(emitEvent.mock.invocationCallOrder[0])
    expect(emitEvent.mock.invocationCallOrder[0]).toBeLessThan(afterMutationSuccess.mock.invocationCallOrder[0])
  })

  it('blocks a reindex write when the mutation guard rejects it', async () => {
    validateMutation.mockResolvedValueOnce({ ok: false, status: 409, body: { error: 'blocked' } })

    const res = await reindexPost(makeRequest({ entityType: 'catalog:catalog_product' }))

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({ error: 'blocked' })
    expect(emitEvent).not.toHaveBeenCalled()
    expect(afterMutationSuccess).not.toHaveBeenCalled()
  })

  it('runs the mutation guard before and after a purge write', async () => {
    const res = await purgePost(makeRequest({ entityType: 'catalog:catalog_product' }))

    expect(res.status).toBe(200)
    expect(validateMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        userId: 'user-1',
        resourceKind: 'query_index',
        resourceId: 'catalog:catalog_product',
        operation: 'custom',
        requestMethod: 'POST',
        requestHeaders: expect.any(Headers),
        mutationPayload: expect.objectContaining({ entityType: 'catalog:catalog_product' }),
      }),
    )
    expect(afterMutationSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceKind: 'query_index',
        resourceId: 'catalog:catalog_product',
        operation: 'custom',
        metadata: { guard: true },
      }),
    )
    expect(validateMutation.mock.invocationCallOrder[0]).toBeLessThan(emitEvent.mock.invocationCallOrder[0])
    expect(emitEvent.mock.invocationCallOrder[0]).toBeLessThan(afterMutationSuccess.mock.invocationCallOrder[0])
  })

  it('blocks a purge write when the mutation guard rejects it', async () => {
    validateMutation.mockResolvedValueOnce({ ok: false, status: 409, body: { error: 'blocked' } })

    const res = await purgePost(makeRequest({ entityType: 'catalog:catalog_product' }))

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({ error: 'blocked' })
    expect(emitEvent).not.toHaveBeenCalled()
    expect(afterMutationSuccess).not.toHaveBeenCalled()
  })
})
