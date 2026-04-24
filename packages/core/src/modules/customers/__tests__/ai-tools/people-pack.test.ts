/**
 * Step 3.9 — `customers.list_people` / `customers.get_person` unit tests.
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

import peopleAiTools from '../../ai-tools/people-pack'
import { knownFeatureIds, makeCtx } from './shared'

function findTool(name: string) {
  const tool = peopleAiTools.find((entry) => entry.name === name)
  if (!tool) throw new Error(`tool ${name} missing`)
  return tool
}

describe('customers.list_people', () => {
  const tool = findTool('customers.list_people')

  beforeEach(() => {
    findWithDecryptionMock.mockReset()
    findOneWithDecryptionMock.mockReset()
    loadCustomFieldValuesMock.mockReset()
  })

  it('declares a RBAC view feature that exists in acl.ts', () => {
    expect(tool.requiredFeatures).toBeDefined()
    expect(tool.requiredFeatures!.length).toBeGreaterThan(0)
    for (const feature of tool.requiredFeatures!) {
      expect(knownFeatureIds.has(feature)).toBe(true)
    }
    expect(tool.isMutation).toBeFalsy()
  })

  it('filters rows to the caller tenant via queryEngine (tenant scope threaded through query args)', async () => {
    const ctx = makeCtx()
    // Post-PR #1593: customers.list_people delegates to queryEngine.query,
    // which handles tenant scoping + search_token filtering internally. The
    // tool trusts the engine to return only tenant-scoped rows.
    ctx.queryEngine.query.mockResolvedValue({
      items: [
        { id: 'p1', tenant_id: 'tenant-1', organization_id: 'org-1', display_name: 'Alice', created_at: '2024-01-01T00:00:00.000Z' },
      ],
      total: 1,
    })
    const result = (await tool.handler({}, ctx as any)) as Record<string, unknown>
    const items = result.items as Array<Record<string, unknown>>
    expect(items.map((entry) => entry.id)).toEqual(['p1'])
    expect(ctx.queryEngine.query).toHaveBeenCalled()
    const [entityType, queryArg] = ctx.queryEngine.query.mock.calls[0]
    expect(entityType).toBe('customers:customer_entity')
    expect(queryArg.tenantId).toBe('tenant-1')
    expect(queryArg.organizationId).toBe('org-1')
  })

  it('rejects calls without a tenant context', async () => {
    const ctx = makeCtx({ tenantId: null })
    await expect(tool.handler({}, ctx as any)).rejects.toThrow(/Tenant context is required/)
  })

  it('caps limit at 100 via input schema', () => {
    const parsed = tool.inputSchema.safeParse({ limit: 150 })
    expect(parsed.success).toBe(false)
  })

  it('defaults limit to 50 and passes pageSize to queryEngine', async () => {
    const ctx = makeCtx()
    ctx.queryEngine.query.mockResolvedValue({ items: [], total: 0 })
    const result = (await tool.handler({}, ctx as any)) as Record<string, unknown>
    expect(result.limit).toBe(50)
    const [, queryArg] = ctx.queryEngine.query.mock.calls[0]
    expect(queryArg.page.pageSize).toBe(50)
    expect(queryArg.tenantId).toBe('tenant-1')
    expect(queryArg.organizationId).toBe('org-1')
  })
})

describe('customers.get_person', () => {
  const tool = findTool('customers.get_person')

  beforeEach(() => {
    findWithDecryptionMock.mockReset()
    findOneWithDecryptionMock.mockReset()
    loadCustomFieldValuesMock.mockReset()
    loadCustomFieldValuesMock.mockResolvedValue({})
  })

  const missingId = '0e4a4e66-2894-4f6c-96bb-fdfa32a9177b'
  const existingId = 'ba9d7593-367c-4a93-9918-c998ff3e5a1d'

  it('returns { found: false } for missing / cross-tenant records (no throw)', async () => {
    findOneWithDecryptionMock.mockResolvedValue(null)
    const ctx = makeCtx()
    const result = (await tool.handler({ personId: missingId }, ctx as any)) as Record<string, unknown>
    expect(result.found).toBe(false)
    expect(result.personId).toBe(missingId)
  })

  it('returns found=false when entity tenant mismatches ctx.tenantId', async () => {
    findOneWithDecryptionMock.mockResolvedValue({
      id: existingId,
      tenantId: 'tenant-2',
      organizationId: 'org-1',
      displayName: 'Leak',
    })
    const ctx = makeCtx()
    const result = (await tool.handler({ personId: existingId }, ctx as any)) as Record<string, unknown>
    expect(result.found).toBe(false)
  })

  it('returns a populated record with profile and custom fields on happy path', async () => {
    findOneWithDecryptionMock.mockResolvedValue({
      id: existingId,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      displayName: 'Alice',
      description: null,
      primaryEmail: 'alice@example.com',
      primaryPhone: null,
      status: 'active',
      lifecycleStage: null,
      source: null,
      ownerUserId: null,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-02'),
      personProfile: {
        id: 'prof-1',
        firstName: 'Alice',
        lastName: 'Example',
        preferredName: null,
        jobTitle: 'CTO',
        department: null,
        seniority: null,
        timezone: null,
        linkedInUrl: null,
        twitterUrl: null,
        company: null,
      },
    })
    loadCustomFieldValuesMock.mockResolvedValue({
      [existingId]: { notes: 'vip' },
    })
    const ctx = makeCtx()
    const result = (await tool.handler({ personId: existingId }, ctx as any)) as Record<string, unknown>
    expect(result.found).toBe(true)
    const person = result.person as Record<string, unknown>
    expect(person.displayName).toBe('Alice')
    const profile = result.profile as Record<string, unknown>
    expect(profile.jobTitle).toBe('CTO')
    expect(result.customFields).toEqual({ notes: 'vip' })
    expect(result.related).toBeNull()
  })
})
