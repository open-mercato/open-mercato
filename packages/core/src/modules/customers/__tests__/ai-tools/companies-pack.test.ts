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

  it('filters cross-tenant rows via queryEngine with kind=company filter', async () => {
    // Post-PR #1593: customers.list_companies delegates to queryEngine.query
    // on the `customers:customer_entity` index with `kind=company` filter,
    // then enriches via findWithDecryption for company profiles.
    const ctx = makeCtx()
    ctx.queryEngine.query.mockResolvedValue({
      items: [
        {
          id: 'c1',
          tenant_id: 'tenant-1',
          organization_id: 'org-1',
          display_name: 'Acme',
          kind: 'company',
          created_at: '2024-01-01T00:00:00.000Z',
        },
      ],
      total: 1,
    })
    // Enrichment calls (profiles, tag assignments) return empty arrays so
    // the list path doesn't blow up when downstream enrichment runs.
    findWithDecryptionMock.mockResolvedValue([])
    const result = (await tool.handler({}, ctx as any)) as Record<string, unknown>
    const items = result.items as Array<Record<string, unknown>>
    expect(items.map((entry) => entry.id)).toEqual(['c1'])
    const [entityType, queryArg] = ctx.queryEngine.query.mock.calls[0]
    expect(entityType).toBe('customers:customer_entity')
    expect(queryArg.filters.kind).toBe('company')
    expect(queryArg.tenantId).toBe('tenant-1')
    expect(queryArg.organizationId).toBe('org-1')
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
