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
