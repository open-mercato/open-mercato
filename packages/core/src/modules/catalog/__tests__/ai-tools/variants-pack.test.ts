/**
 * Step 3.10 — variants unit tests.
 */
const findWithDecryptionMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
  findOneWithDecryption: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn(),
}))

import variantsAiTools from '../../ai-tools/variants-pack'
import { makeCtx } from './shared'

describe('catalog.list_variants', () => {
  const tool = variantsAiTools.find((entry) => entry.name === 'catalog.list_variants')!

  beforeEach(() => {
    findWithDecryptionMock.mockReset()
  })

  it('scopes query by product + tenant + organization', async () => {
    findWithDecryptionMock.mockResolvedValue([])
    const ctx = makeCtx()
    ctx.em.count.mockResolvedValue(0)
    await tool.handler({ productId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, ctx as any)
    const whereArg = findWithDecryptionMock.mock.calls[0][2]
    expect(whereArg.product).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    expect(whereArg.tenantId).toBe('tenant-1')
    expect(whereArg.organizationId).toBe('org-1')
    expect(whereArg.deletedAt).toBeNull()
  })

  it('drops cross-tenant leaks', async () => {
    findWithDecryptionMock.mockResolvedValue([
      { id: 'v1', tenantId: 'tenant-1', organizationId: 'org-1', sku: 'A', isActive: true, isDefault: true, createdAt: new Date('2024-01-01') },
      { id: 'v2', tenantId: 'tenant-2', organizationId: 'org-1', sku: 'B', isActive: true, isDefault: false, createdAt: new Date('2024-01-02') },
    ])
    const ctx = makeCtx()
    ctx.em.count.mockResolvedValue(2)
    const result = (await tool.handler(
      { productId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      ctx as any,
    )) as Record<string, unknown>
    expect((result.items as any[]).map((r) => r.id)).toEqual(['v1'])
  })

  it('requires productId', () => {
    expect(tool.inputSchema.safeParse({}).success).toBe(false)
  })

  it('caps limit at 100', () => {
    expect(
      tool.inputSchema.safeParse({
        productId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        limit: 101,
      }).success,
    ).toBe(false)
  })
})
