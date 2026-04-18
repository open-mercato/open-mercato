/**
 * Step 3.9 — `customers.list_companies` / `customers.get_company` unit tests.
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

import companiesAiTools from '../../ai-tools/companies-pack'
import { knownFeatureIds, makeCtx } from './shared'

function findTool(name: string) {
  const tool = companiesAiTools.find((entry) => entry.name === name)
  if (!tool) throw new Error(`tool ${name} missing`)
  return tool
}

describe('customers.list_companies', () => {
  const tool = findTool('customers.list_companies')

  beforeEach(() => {
    findWithDecryptionMock.mockReset()
    loadCustomFieldValuesMock.mockReset()
  })

  it('declares existing RBAC features', () => {
    expect(tool.requiredFeatures).toContain('customers.companies.view')
    for (const feature of tool.requiredFeatures!) expect(knownFeatureIds.has(feature)).toBe(true)
  })

  it('caps limit at 100', () => {
    expect(tool.inputSchema.safeParse({ limit: 101 }).success).toBe(false)
    expect(tool.inputSchema.safeParse({ limit: 100 }).success).toBe(true)
  })

  it('filters cross-tenant rows and scopes queries to ctx.tenantId / ctx.organizationId', async () => {
    findWithDecryptionMock.mockResolvedValue([
      {
        id: 'c1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        displayName: 'Acme',
        createdAt: new Date('2024-01-01'),
      },
      {
        id: 'c2',
        tenantId: 'tenant-2',
        organizationId: 'org-1',
        displayName: 'Wrong Tenant',
        createdAt: new Date('2024-01-02'),
      },
    ])
    const ctx = makeCtx()
    ctx.em.count.mockResolvedValue(2)
    const result = (await tool.handler({}, ctx as any)) as Record<string, unknown>
    const items = result.items as Array<Record<string, unknown>>
    expect(items.map((entry) => entry.id)).toEqual(['c1'])
    expect(findWithDecryptionMock.mock.calls[0][2].kind).toBe('company')
  })

  it('throws when tenant context is missing', async () => {
    const ctx = makeCtx({ tenantId: null })
    await expect(tool.handler({}, ctx as any)).rejects.toThrow(/Tenant context is required/)
  })
})

describe('customers.get_company', () => {
  const tool = findTool('customers.get_company')

  beforeEach(() => {
    findOneWithDecryptionMock.mockReset()
    loadCustomFieldValuesMock.mockReset()
    loadCustomFieldValuesMock.mockResolvedValue({})
  })

  const companyId = 'a1bd846b-5f8f-43bb-8c79-c6933afa09fe'

  it('returns found=false on miss', async () => {
    findOneWithDecryptionMock.mockResolvedValue(null)
    const ctx = makeCtx()
    const result = (await tool.handler({ companyId }, ctx as any)) as Record<string, unknown>
    expect(result.found).toBe(false)
  })

  it('returns found=false when tenant mismatches', async () => {
    findOneWithDecryptionMock.mockResolvedValue({
      id: companyId,
      tenantId: 'tenant-2',
      organizationId: 'org-1',
      displayName: 'Other',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    const ctx = makeCtx()
    const result = (await tool.handler({ companyId }, ctx as any)) as Record<string, unknown>
    expect(result.found).toBe(false)
  })
})
