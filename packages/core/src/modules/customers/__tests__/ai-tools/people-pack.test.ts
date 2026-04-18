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

  it('filters rows to the caller tenant and drops cross-tenant data', async () => {
    findWithDecryptionMock.mockResolvedValue([
      { id: 'p1', tenantId: 'tenant-1', organizationId: 'org-1', displayName: 'Alice', createdAt: new Date('2024-01-01') },
      { id: 'p2', tenantId: 'tenant-2', organizationId: 'org-1', displayName: 'Eve', createdAt: new Date('2024-01-02') },
    ])
    const ctx = makeCtx()
    ctx.em.count.mockResolvedValue(2)
    const result = (await tool.handler({}, ctx as any)) as Record<string, unknown>
    const items = result.items as Array<Record<string, unknown>>
    expect(items.map((entry) => entry.id)).toEqual(['p1'])
    expect(findWithDecryptionMock).toHaveBeenCalled()
    const whereArg = findWithDecryptionMock.mock.calls[0][2]
    expect(whereArg.tenantId).toBe('tenant-1')
    expect(whereArg.organizationId).toBe('org-1')
    expect(whereArg.kind).toBe('person')
  })

  it('rejects calls without a tenant context', async () => {
    const ctx = makeCtx({ tenantId: null })
    await expect(tool.handler({}, ctx as any)).rejects.toThrow(/Tenant context is required/)
  })

  it('caps limit at 100 via input schema', () => {
    const parsed = tool.inputSchema.safeParse({ limit: 150 })
    expect(parsed.success).toBe(false)
  })

  it('defaults limit to 50 and passes tenant + org scope to findWithDecryption', async () => {
    findWithDecryptionMock.mockResolvedValue([])
    const ctx = makeCtx()
    ctx.em.count.mockResolvedValue(0)
    const result = (await tool.handler({}, ctx as any)) as Record<string, unknown>
    expect(result.limit).toBe(50)
    const options = findWithDecryptionMock.mock.calls[0][3]
    expect(options.limit).toBe(50)
    const scopeArg = findWithDecryptionMock.mock.calls[0][4]
    expect(scopeArg).toEqual({ tenantId: 'tenant-1', organizationId: 'org-1' })
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
