/**
 * Step 3.9 — `customers.list_companies` / `customers.get_company` unit tests.
 *
 * Phase 3a of `2026-04-27-ai-tools-api-backed-dry-refactor`: the list tool
 * delegates to the in-process API operation runner over
 * `GET /api/customers/companies`.
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
    runMock.mockReset()
    createRunnerMock.mockClear()
  })

  it('declares existing RBAC features', () => {
    expect(tool.requiredFeatures).toContain('customers.companies.view')
    for (const feature of tool.requiredFeatures!) expect(knownFeatureIds.has(feature)).toBe(true)
    expect(tool.isMutation).toBeFalsy()
  })

  it('caps limit at 100', () => {
    expect(tool.inputSchema.safeParse({ limit: 101 }).success).toBe(false)
    expect(tool.inputSchema.safeParse({ limit: 100 }).success).toBe(true)
  })

  it('delegates to the API runner with default page/pageSize and maps the response', async () => {
    runMock.mockResolvedValue({
      success: true,
      statusCode: 200,
      data: {
        items: [
          {
            id: 'c1',
            display_name: 'Acme',
            primary_email: 'hello@acme.example',
            domain: 'acme.example',
            website_url: 'https://acme.example',
            industry: 'manufacturing',
            size_bucket: 'medium',
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
    expect(items.map((entry) => entry.id)).toEqual(['c1'])
    expect(items[0].displayName).toBe('Acme')
    expect(items[0].domain).toBe('acme.example')
    expect(items[0].websiteUrl).toBe('https://acme.example')
    expect(items[0].industry).toBe('manufacturing')
    expect(items[0].sizeBucket).toBe('medium')

    expect(runMock).toHaveBeenCalledTimes(1)
    const operation = runMock.mock.calls[0][0]
    expect(operation.method).toBe('GET')
    expect(operation.path).toBe('/customers/companies')
    expect(operation.query).toMatchObject({ page: 1, pageSize: 50 })
  })

  it('translates q/limit/offset/tags inputs to API query params', async () => {
    runMock.mockResolvedValue({ success: true, statusCode: 200, data: { items: [], total: 0 } })
    const ctx = makeCtx()
    await tool.handler(
      {
        q: '  acme  ',
        limit: 25,
        offset: 75,
        tags: ['11111111-1111-1111-1111-111111111111'],
      },
      ctx as any,
    )
    const operation = runMock.mock.calls[0][0]
    expect(operation.query.search).toBe('acme')
    expect(operation.query.pageSize).toBe(25)
    // offset 75 with limit 25 → page 4
    expect(operation.query.page).toBe(4)
    expect(operation.query.tagIds).toBe('11111111-1111-1111-1111-111111111111')
  })

  it('throws when tenant context is missing', async () => {
    const ctx = makeCtx({ tenantId: null })
    await expect(tool.handler({}, ctx as any)).rejects.toThrow(/Tenant context is required/)
  })

  it('bubbles a clean Error when the runner reports failure', async () => {
    runMock.mockResolvedValue({ success: false, statusCode: 403, error: 'forbidden by route policy' })
    const ctx = makeCtx()
    await expect(tool.handler({}, ctx as any)).rejects.toThrow('forbidden by route policy')
  })
})

describe('customers.get_company', () => {
  const tool = findTool('customers.get_company')

  beforeEach(() => {
    findOneWithDecryptionMock.mockReset()
    loadCustomFieldValuesMock.mockReset()
    runMock.mockReset()
    createRunnerMock.mockClear()
  })

  const companyId = 'a1bd846b-5f8f-43bb-8c79-c6933afa09fe'

  it('declares same name/schema/requiredFeatures and is not a mutation', () => {
    expect(tool.name).toBe('customers.get_company')
    expect(tool.requiredFeatures).toEqual(['customers.companies.view'])
    expect(tool.isMutation).toBeFalsy()
    expect(tool.inputSchema.safeParse({ companyId }).success).toBe(true)
    expect(tool.inputSchema.safeParse({ companyId: 'not-a-uuid' }).success).toBe(false)
  })

  it('returns { found: false } when API responds 404', async () => {
    runMock.mockResolvedValue({ success: false, statusCode: 404, error: 'Company not found' })
    const ctx = makeCtx()
    const result = (await tool.handler({ companyId }, ctx as any)) as Record<string, unknown>
    expect(result.found).toBe(false)
    expect(result.companyId).toBe(companyId)
    const operation = runMock.mock.calls[0][0]
    expect(operation.method).toBe('GET')
    expect(operation.path).toBe(`/customers/companies/${companyId}`)
    expect(operation.query).toBeUndefined()
  })

  it('returns { found: false } when API responds 403', async () => {
    runMock.mockResolvedValue({ success: false, statusCode: 403, error: 'Access denied' })
    const ctx = makeCtx()
    const result = (await tool.handler({ companyId }, ctx as any)) as Record<string, unknown>
    expect(result.found).toBe(false)
  })

  it('bubbles a clean Error for non-404/403 runner failures', async () => {
    runMock.mockResolvedValue({ success: false, statusCode: 500, error: 'boom' })
    const ctx = makeCtx()
    await expect(tool.handler({ companyId }, ctx as any)).rejects.toThrow('boom')
  })

  it('maps a populated detail payload (no includeRelated) into the AI shape', async () => {
    runMock.mockResolvedValue({
      success: true,
      statusCode: 200,
      data: {
        company: {
          id: companyId,
          displayName: 'Acme',
          description: null,
          primaryEmail: 'hello@acme.example',
          primaryPhone: null,
          status: 'active',
          lifecycleStage: null,
          source: null,
          ownerUserId: null,
          organizationId: 'org-1',
          tenantId: 'tenant-1',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-02T00:00:00.000Z',
        },
        profile: {
          id: 'cp-1',
          legalName: 'Acme Inc.',
          brandName: 'Acme',
          domain: 'acme.example',
          websiteUrl: 'https://acme.example',
          industry: 'manufacturing',
          sizeBucket: 'medium',
          annualRevenue: '1000000',
        },
        customFields: { tier: 'gold' },
      },
    })
    const ctx = makeCtx()
    const result = (await tool.handler({ companyId }, ctx as any)) as Record<string, unknown>
    expect(result.found).toBe(true)
    const company = result.company as Record<string, unknown>
    expect(company.displayName).toBe('Acme')
    const profile = result.profile as Record<string, unknown>
    expect(profile.domain).toBe('acme.example')
    expect(profile.industry).toBe('manufacturing')
    expect(result.customFields).toEqual({ tier: 'gold' })
    expect(result.related).toBeNull()
  })

  it('includeRelated: true requests every relation via include and maps the aggregated payload', async () => {
    runMock.mockResolvedValue({
      success: true,
      statusCode: 200,
      data: {
        company: {
          id: companyId,
          displayName: 'Acme',
          tenantId: 'tenant-1',
          organizationId: 'org-1',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-02T00:00:00.000Z',
        },
        profile: null,
        customFields: {},
        addresses: [{ id: 'addr-1', name: 'HQ', addressLine1: '1 Main St', isPrimary: true }],
        activities: [
          {
            id: 'act-1',
            activityType: 'email',
            subject: 'Hi',
            occurredAt: '2024-01-03T00:00:00.000Z',
            createdAt: '2024-01-03T00:00:00.000Z',
          },
        ],
        comments: [
          { id: 'note-1', body: 'note', authorUserId: 'u1', createdAt: '2024-01-03T00:00:00.000Z' },
        ],
        todos: [{ id: 't-1', todoId: 't-1', todoSource: 'example', createdAt: '2024-01-03T00:00:00.000Z' }],
        interactions: [
          { id: 'i-1', interactionType: 'task', title: 'Fu', status: 'planned' },
        ],
        tags: [{ id: 'tag-1', label: 'VIP' }],
        deals: [
          {
            id: 'd-1',
            title: 'Big',
            status: 'open',
            pipelineStageId: 'stage-1',
            valueAmount: '1000',
            valueCurrency: 'USD',
          },
        ],
        people: [
          {
            id: 'p-1',
            displayName: 'Alice',
            primaryEmail: 'alice@example.com',
            jobTitle: 'CTO',
            department: null,
          },
        ],
      },
    })
    const ctx = makeCtx()
    const result = (await tool.handler(
      { companyId, includeRelated: true },
      ctx as any,
    )) as Record<string, unknown>
    expect(result.found).toBe(true)
    const operation = runMock.mock.calls[0][0]
    expect(operation.path).toBe(`/customers/companies/${companyId}`)
    expect(operation.query.include).toBe(
      'addresses,comments,activities,interactions,deals,todos,people',
    )
    const related = result.related as Record<string, unknown>
    expect((related.addresses as any[])[0].id).toBe('addr-1')
    expect((related.activities as any[])[0].activityType).toBe('email')
    expect((related.notes as any[])[0].body).toBe('note')
    expect((related.tasks as any[])[0].todoId).toBe('t-1')
    expect((related.tags as any[])[0]).toEqual({
      id: 'tag-1',
      slug: 'VIP',
      label: 'VIP',
      color: null,
    })
    expect((related.deals as any[])[0].id).toBe('d-1')
    expect((related.people as any[])[0]).toMatchObject({
      id: 'p-1',
      displayName: 'Alice',
      primaryEmail: 'alice@example.com',
      jobTitle: 'CTO',
      department: null,
    })
  })

  it('rejects calls without a tenant context', async () => {
    const ctx = makeCtx({ tenantId: null })
    await expect(tool.handler({ companyId }, ctx as any)).rejects.toThrow(
      /Tenant context is required/,
    )
  })
})
