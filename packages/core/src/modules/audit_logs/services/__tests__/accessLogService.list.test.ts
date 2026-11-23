jest.mock('@open-mercato/shared/lib/encryption/customFieldValues', () => ({
  resolveTenantEncryptionService: jest.fn(() => null),
}))

import { AccessLogService } from '../accessLogService'

const tenantId = '11111111-1111-4111-8111-111111111111'
const orgA = '22222222-2222-4222-8222-222222222222'
const orgB = '44444444-4444-4444-8444-444444444444'

function makeEm() {
  const findAndCount = jest.fn(async () => [[], 0])
  return { em: { findAndCount }, findAndCount }
}

describe('AccessLogService.list organization scoping', () => {
  it('filters by a single organization when organizationId is set, ignoring organizationIds', async () => {
    const { em, findAndCount } = makeEm()
    const service = new AccessLogService(em as never)
    await service.list({ tenantId, organizationId: orgA, organizationIds: [orgB] })
    const where = (findAndCount.mock.calls[0] as unknown[])[1] as Record<string, unknown>
    expect(where.organizationId).toBe(orgA)
  })

  it('filters by the organization set when only organizationIds is set', async () => {
    const { em, findAndCount } = makeEm()
    const service = new AccessLogService(em as never)
    await service.list({ tenantId, organizationIds: [orgA, orgB, orgA] })
    const where = (findAndCount.mock.calls[0] as unknown[])[1] as Record<string, unknown>
    expect(where.organizationId).toEqual({ $in: [orgA, orgB] })
    expect(where.tenantId).toBe(tenantId)
  })

  it('fails closed on an empty organization set without querying', async () => {
    const { em, findAndCount } = makeEm()
    const service = new AccessLogService(em as never)
    const result = await service.list({ tenantId, organizationIds: [], pageSize: 25 })
    expect(findAndCount).not.toHaveBeenCalled()
    expect(result).toEqual({ items: [], total: 0, page: 1, pageSize: 25, totalPages: 1 })
  })

  it('rejects non-uuid organization ids', async () => {
    const { em } = makeEm()
    const service = new AccessLogService(em as never)
    await expect(service.list({ tenantId, organizationIds: ['not-a-uuid'] })).rejects.toThrow()
  })
})

describe('AccessLogService.list ordering', () => {
  it('orders by createdAt with an id tiebreak so tied rows page deterministically', async () => {
    const { em, findAndCount } = makeEm()
    const service = new AccessLogService(em as never)
    await service.list({ tenantId, pageSize: 2, page: 2 })
    const options = (findAndCount.mock.calls[0] as unknown[])[2] as Record<string, unknown>
    expect(options.orderBy).toEqual({ createdAt: 'desc', id: 'desc' })
    expect(options.limit).toBe(2)
    expect(options.offset).toBe(2)
  })
})
