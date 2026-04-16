import { ActionLogService } from '../actionLogService'

describe('ActionLogService normalizeInput', () => {
  it('maps optional strings to undefined and parent fields to null', () => {
    const service = new ActionLogService({} as unknown as ConstructorParameters<typeof ActionLogService>[0])
    const serviceWithPrivateAccess = service as unknown as {
      normalizeInput: (input: Record<string, unknown>) => Record<string, unknown>
    }
    const normalized = serviceWithPrivateAccess.normalizeInput({
      commandId: 'cmd-1',
      actionLabel: null,
      resourceKind: '',
      resourceId: undefined,
      undoToken: null,
      parentResourceKind: '',
      parentResourceId: undefined,
    })

    expect(normalized.actionLabel).toBeUndefined()
    expect(normalized.resourceKind).toBeUndefined()
    expect(normalized.resourceId).toBeUndefined()
    expect(normalized.undoToken).toBeUndefined()
    expect(normalized.parentResourceKind).toBeNull()
    expect(normalized.parentResourceId).toBeNull()
  })
})

describe('ActionLogService.list pagination', () => {
  it('calls findAndCount with offset and limit derived from page/pageSize', async () => {
    const mockItems = [{ id: '1' }, { id: '2' }]
    const mockEm = {
      findAndCount: jest.fn().mockResolvedValue([mockItems, 42]),
    }
    const service = new ActionLogService(mockEm as any)

    const result = await service.list({
      tenantId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      page: 3,
      pageSize: 10,
    })

    expect(result.items).toBe(mockItems)
    expect(result.total).toBe(42)
    expect(result.page).toBe(3)
    expect(result.pageSize).toBe(10)
    expect(result.totalPages).toBe(5)

    expect(mockEm.findAndCount).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ deletedAt: null }),
      expect.objectContaining({
        orderBy: { createdAt: 'desc' },
        limit: 10,
        offset: 20,
      }),
    )
  })

  it('defaults to page=1 pageSize=50 when not provided', async () => {
    const mockEm = {
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
    }
    const service = new ActionLogService(mockEm as any)

    const result = await service.list({
      tenantId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    })

    expect(result.page).toBe(1)
    expect(result.pageSize).toBe(50)
    expect(result.totalPages).toBe(1)
    expect(result.total).toBe(0)
    expect(mockEm.findAndCount).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ limit: 50, offset: 0 }),
    )
  })

  it('computes totalPages correctly for partial last page', async () => {
    const mockEm = {
      findAndCount: jest.fn().mockResolvedValue([[], 101]),
    }
    const service = new ActionLogService(mockEm as any)

    const result = await service.list({
      tenantId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      pageSize: 25,
    })

    expect(result.totalPages).toBe(5)
  })

  it('returns totalPages=1 when total is 0', async () => {
    const mockEm = {
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
    }
    const service = new ActionLogService(mockEm as any)

    const result = await service.list({
      tenantId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    })

    expect(result.totalPages).toBe(1)
  })
})
