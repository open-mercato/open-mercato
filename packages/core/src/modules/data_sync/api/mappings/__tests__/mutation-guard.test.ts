/** @jest-environment node */

const MAPPING_ID = '123e4567-e89b-12d3-a456-426614174099'
const INTEGRATION_ID = 'demo-provider'

const mockGetAuthFromRequest = jest.fn()
const mockFindOneWithDecryption = jest.fn()

const mockEm = {
  create: jest.fn(),
  persist: jest.fn(() => ({ flush: jest.fn(async () => undefined) })),
  flush: jest.fn(async () => undefined),
}

const mockCrudMutationGuardService = {
  validateMutation: jest.fn(),
  afterMutationSuccess: jest.fn(),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((req: Request) => mockGetAuthFromRequest(req)),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn((...args: unknown[]) => mockFindOneWithDecryption(...args)),
  findAndCountWithDecryption: jest.fn(async () => [[], 0]),
}))

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    if (token === 'crudMutationGuardService') return mockCrudMutationGuardService
    return null
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

import { POST } from '../route'

function request() {
  return new Request('http://localhost/api/data_sync/mappings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      integrationId: INTEGRATION_ID,
      entityType: 'products',
      mapping: { foo: 'bar' },
    }),
  })
}

describe('data_sync mapping create mutation guard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })
    mockFindOneWithDecryption.mockResolvedValue(null)
    mockEm.create.mockReturnValue({
      id: MAPPING_ID,
      integrationId: INTEGRATION_ID,
      entityType: 'products',
      mapping: { foo: 'bar' },
    })
    mockCrudMutationGuardService.validateMutation.mockResolvedValue({ ok: true, shouldRunAfterSuccess: true, metadata: null })
    mockCrudMutationGuardService.afterMutationSuccess.mockResolvedValue(undefined)
  })

  it('runs the guard before the create write and the after-success hook after persistence', async () => {
    const res = await POST(request())
    expect(res.status).toBe(201)
    expect(mockCrudMutationGuardService.validateMutation).toHaveBeenCalledWith(expect.objectContaining({
      resourceKind: 'data_sync.mapping',
      operation: 'create',
    }))
    expect(mockEm.persist).toHaveBeenCalled()
    expect(mockCrudMutationGuardService.afterMutationSuccess).toHaveBeenCalledWith(expect.objectContaining({
      resourceKind: 'data_sync.mapping',
      resourceId: MAPPING_ID,
      operation: 'create',
    }))
  })

  it('short-circuits the create when the guard blocks the mutation', async () => {
    mockCrudMutationGuardService.validateMutation.mockResolvedValueOnce({
      ok: false,
      status: 403,
      body: { error: 'Blocked by guard' },
    })

    const res = await POST(request())
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({ error: 'Blocked by guard' })
    expect(mockEm.create).not.toHaveBeenCalled()
    expect(mockEm.persist).not.toHaveBeenCalled()
    expect(mockCrudMutationGuardService.afterMutationSuccess).not.toHaveBeenCalled()
  })

  it('uses the update operation when a mapping already exists', async () => {
    mockFindOneWithDecryption.mockResolvedValueOnce({
      id: MAPPING_ID,
      integrationId: INTEGRATION_ID,
      entityType: 'products',
      mapping: { old: 'value' },
    })

    const res = await POST(request())
    expect(res.status).toBe(200)
    expect(mockCrudMutationGuardService.validateMutation).toHaveBeenCalledWith(expect.objectContaining({
      resourceKind: 'data_sync.mapping',
      resourceId: MAPPING_ID,
      operation: 'update',
    }))
    expect(mockEm.flush).toHaveBeenCalled()
    expect(mockCrudMutationGuardService.afterMutationSuccess).toHaveBeenCalledWith(expect.objectContaining({
      resourceKind: 'data_sync.mapping',
      resourceId: MAPPING_ID,
      operation: 'update',
    }))
  })
})
