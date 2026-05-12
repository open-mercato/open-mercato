/**
 * Step 3.10 — `catalog.list_categories` / `catalog.get_category` unit tests.
 */
const findWithDecryptionMock = jest.fn()
const findOneWithDecryptionMock = jest.fn()
const loadCustomFieldValuesMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: (...args: unknown[]) => loadCustomFieldValuesMock(...args),
}))

import categoriesAiTools from '../../ai-tools/categories-pack'
import { knownFeatureIds, makeCtx } from './shared'

function findTool(name: string) {
  const tool = categoriesAiTools.find((entry) => entry.name === name)
  if (!tool) throw new Error(`tool ${name} missing`)
  return tool
}

describe('catalog.list_categories', () => {
  const tool = findTool('catalog.list_categories')

  beforeEach(() => {
    findWithDecryptionMock.mockReset()
    findOneWithDecryptionMock.mockReset()
    loadCustomFieldValuesMock.mockReset()
  })

  it('caps limit at 100', () => {
    expect(tool.inputSchema.safeParse({ limit: 500 }).success).toBe(false)
  })

  it('defaults to active-only and narrows by parentId: null for roots', async () => {
    findWithDecryptionMock.mockResolvedValue([
      { id: 'c1', tenantId: 'tenant-1', organizationId: 'org-1', name: 'Root', parentId: null, depth: 0, childIds: [], isActive: true },
    ])
    const ctx = makeCtx()
    ctx.em.count.mockResolvedValue(1)
    const result = (await tool.handler({ parentId: null }, ctx as any)) as Record<string, unknown>
    const whereArg = findWithDecryptionMock.mock.calls[0][2]
    expect(whereArg.parentId).toBeNull()
    expect(whereArg.deletedAt).toBeNull()
    expect(whereArg.tenantId).toBe('tenant-1')
    expect((result.items as any[]).length).toBe(1)
  })

  it('filters cross-tenant rows out of the result', async () => {
    findWithDecryptionMock.mockResolvedValue([
      { id: 'c1', tenantId: 'tenant-1', organizationId: 'org-1', name: 'Ours', parentId: null, depth: 0, childIds: [], isActive: true },
      { id: 'c2', tenantId: 'tenant-2', organizationId: 'org-1', name: 'Theirs', parentId: null, depth: 0, childIds: [], isActive: true },
    ])
    const ctx = makeCtx()
    ctx.em.count.mockResolvedValue(2)
    const result = (await tool.handler({}, ctx as any)) as Record<string, unknown>
    const ids = (result.items as any[]).map((r) => r.id)
    expect(ids).toEqual(['c1'])
  })

  it('rejects calls without tenant context', async () => {
    const ctx = makeCtx({ tenantId: null })
    await expect(tool.handler({}, ctx as any)).rejects.toThrow(/Tenant context is required/)
  })
})

describe('catalog.get_category', () => {
  const tool = findTool('catalog.get_category')

  beforeEach(() => {
    findWithDecryptionMock.mockReset()
    findOneWithDecryptionMock.mockReset()
    loadCustomFieldValuesMock.mockReset()
    loadCustomFieldValuesMock.mockResolvedValue({})
  })

  const existingId = 'ba9d7593-367c-4a93-9918-c998ff3e5a1d'

  it('returns { found: false } for missing records', async () => {
    findOneWithDecryptionMock.mockResolvedValue(null)
    const ctx = makeCtx()
    const result = (await tool.handler({ categoryId: existingId }, ctx as any)) as Record<string, unknown>
    expect(result.found).toBe(false)
  })

  it('returns { found: false } when cross-tenant data slips through decryption', async () => {
    findOneWithDecryptionMock.mockResolvedValue({
      id: existingId,
      tenantId: 'tenant-2',
      organizationId: 'org-1',
      name: 'Leak',
      depth: 0,
      childIds: [],
      ancestorIds: [],
      descendantIds: [],
    })
    const ctx = makeCtx()
    const result = (await tool.handler({ categoryId: existingId }, ctx as any)) as Record<string, unknown>
    expect(result.found).toBe(false)
  })

  it('declares a RBAC view feature that exists in acl.ts', () => {
    for (const feature of tool.requiredFeatures!) {
      expect(knownFeatureIds.has(feature)).toBe(true)
    }
  })
})
