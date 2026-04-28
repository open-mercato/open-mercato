/**
 * Step 3.9 — `customers.list_people` / `customers.get_person` unit tests.
 *
 * Phase 3a of `2026-04-27-ai-tools-api-backed-dry-refactor`: the list tool
 * delegates to the in-process API operation runner over
 * `GET /api/customers/people`. Tests mock the runner module rather than the
 * ORM/query engine.
 */
const findWithDecryptionMock = jest.fn()
const findOneWithDecryptionMock = jest.fn()
const loadCustomFieldValuesMock = jest.fn()
const runMock = jest.fn()
const createRunnerMock = jest.fn(() => ({ run: runMock }))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: (...args: unknown[]) => loadCustomFieldValuesMock(...args),
}))

jest.mock(
  '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-api-operation-runner',
  () => {
    const actual = jest.requireActual(
      '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-api-operation-runner',
    )
    return {
      ...actual,
      createAiApiOperationRunner: (...args: unknown[]) => createRunnerMock(...args),
    }
  },
)

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
    runMock.mockReset()
    createRunnerMock.mockClear()
  })

  it('declares a RBAC view feature that exists in acl.ts', () => {
    expect(tool.requiredFeatures).toBeDefined()
    expect(tool.requiredFeatures!.length).toBeGreaterThan(0)
    for (const feature of tool.requiredFeatures!) {
      expect(knownFeatureIds.has(feature)).toBe(true)
    }
    expect(tool.isMutation).toBeFalsy()
  })

  it('caps limit at 100 via input schema', () => {
    const parsed = tool.inputSchema.safeParse({ limit: 150 })
    expect(parsed.success).toBe(false)
  })

  it('delegates to the API runner with default page/pageSize and maps the response', async () => {
    runMock.mockResolvedValue({
      success: true,
      statusCode: 200,
      data: {
        items: [
          {
            id: 'p1',
            display_name: 'Alice',
            primary_email: 'alice@example.com',
            tenant_id: 'tenant-1',
            organization_id: 'org-1',
            created_at: '2024-01-01T00:00:00.000Z',
          },
        ],
        total: 1,
      },
    })
    const ctx = makeCtx()
    const result = (await tool.handler({}, ctx as any)) as Record<string, unknown>
    const items = result.items as Array<Record<string, unknown>>
    expect(items.map((entry) => entry.id)).toEqual(['p1'])
    expect(items[0].displayName).toBe('Alice')
    expect(items[0].primaryEmail).toBe('alice@example.com')
    expect(result.limit).toBe(50)
    expect(result.offset).toBe(0)
    expect(result.total).toBe(1)

    expect(runMock).toHaveBeenCalledTimes(1)
    const operation = runMock.mock.calls[0][0]
    expect(operation.method).toBe('GET')
    expect(operation.path).toBe('/customers/people')
    expect(operation.query).toMatchObject({ page: 1, pageSize: 50 })
    expect(operation.query.search).toBeUndefined()
  })

  it('translates q/limit/offset/tags inputs to API query params', async () => {
    runMock.mockResolvedValue({ success: true, statusCode: 200, data: { items: [], total: 0 } })
    const ctx = makeCtx()
    await tool.handler(
      {
        q: '  taylor  ',
        limit: 10,
        offset: 20,
        tags: ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'],
      },
      ctx as any,
    )
    const operation = runMock.mock.calls[0][0]
    expect(operation.query.search).toBe('taylor')
    expect(operation.query.pageSize).toBe(10)
    // offset 20 with limit 10 → page 3
    expect(operation.query.page).toBe(3)
    expect(operation.query.tagIds).toBe(
      '11111111-1111-1111-1111-111111111111,22222222-2222-2222-2222-222222222222',
    )
  })

  it('pre-resolves companyId via CustomerPersonProfile and passes ids filter', async () => {
    findWithDecryptionMock.mockResolvedValueOnce([
      { entity: { id: 'p1' } },
      { entity: 'p2' },
      { entity: null },
    ])
    runMock.mockResolvedValue({ success: true, statusCode: 200, data: { items: [], total: 0 } })
    const ctx = makeCtx()
    await tool.handler(
      { companyId: '33333333-3333-3333-3333-333333333333' },
      ctx as any,
    )
    expect(findWithDecryptionMock).toHaveBeenCalledTimes(1)
    const operation = runMock.mock.calls[0][0]
    expect(operation.query.ids).toBe('p1,p2')
  })

  it('feeds nil uuid as ids when companyId resolves to no people (route returns empty)', async () => {
    findWithDecryptionMock.mockResolvedValueOnce([])
    runMock.mockResolvedValue({ success: true, statusCode: 200, data: { items: [], total: 0 } })
    const ctx = makeCtx()
    const result = (await tool.handler(
      { companyId: '33333333-3333-3333-3333-333333333333' },
      ctx as any,
    )) as Record<string, unknown>
    const operation = runMock.mock.calls[0][0]
    expect(operation.query.ids).toBe('00000000-0000-0000-0000-000000000000')
    expect((result.items as unknown[]).length).toBe(0)
    expect(result.total).toBe(0)
  })

  it('rejects calls without a tenant context', async () => {
    const ctx = makeCtx({ tenantId: null })
    await expect(tool.handler({}, ctx as any)).rejects.toThrow(/Tenant context is required/)
  })

  it('bubbles a clean Error when the runner reports failure', async () => {
    runMock.mockResolvedValue({ success: false, statusCode: 403, error: 'forbidden by route policy' })
    const ctx = makeCtx()
    await expect(tool.handler({}, ctx as any)).rejects.toThrow('forbidden by route policy')
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
