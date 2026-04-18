/**
 * Step 3.10 — option schemas / unit conversions unit tests.
 */
const findWithDecryptionMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
  findOneWithDecryption: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn(),
}))

import configurationAiTools from '../../ai-tools/configuration-pack'
import { makeCtx } from './shared'

function findTool(name: string) {
  const tool = configurationAiTools.find((entry) => entry.name === name)
  if (!tool) throw new Error(`tool ${name} missing`)
  return tool
}

describe('catalog.list_option_schemas', () => {
  const tool = findTool('catalog.list_option_schemas')

  beforeEach(() => {
    findWithDecryptionMock.mockReset()
  })

  it('caps limit at 100', () => {
    expect(tool.inputSchema.safeParse({ limit: 200 }).success).toBe(false)
  })

  it('drops cross-tenant leaks', async () => {
    findWithDecryptionMock.mockResolvedValue([
      { id: 's1', tenantId: 'tenant-1', organizationId: 'org-1', code: 'size', name: 'Size', description: null, schema: {}, isActive: true, createdAt: new Date('2024-01-01') },
      { id: 's2', tenantId: 'tenant-2', organizationId: 'org-1', code: 'color', name: 'Color', description: null, schema: {}, isActive: true, createdAt: new Date('2024-01-02') },
    ])
    const ctx = makeCtx()
    ctx.em.count.mockResolvedValue(2)
    const result = (await tool.handler({}, ctx as any)) as Record<string, unknown>
    const codes = (result.items as any[]).map((r) => r.code)
    expect(codes).toEqual(['size'])
  })
})

describe('catalog.list_unit_conversions', () => {
  const tool = findTool('catalog.list_unit_conversions')

  beforeEach(() => {
    findWithDecryptionMock.mockReset()
  })

  it('scopes by product when provided', async () => {
    findWithDecryptionMock.mockResolvedValue([])
    const ctx = makeCtx()
    ctx.em.count.mockResolvedValue(0)
    await tool.handler({ productId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, ctx as any)
    const whereArg = findWithDecryptionMock.mock.calls[0][2]
    expect(whereArg.product).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    expect(whereArg.deletedAt).toBeNull()
  })

  it('rejects missing tenant', async () => {
    const ctx = makeCtx({ tenantId: null })
    await expect(tool.handler({}, ctx as any)).rejects.toThrow(/Tenant context is required/)
  })
})
