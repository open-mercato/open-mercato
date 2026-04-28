/**
 * Step 3.9 — `customers.list_deals` / `customers.get_deal` unit tests.
 *
 * Phase 3a of `2026-04-27-ai-tools-api-backed-dry-refactor`: the list tool
 * delegates to the in-process API operation runner over
 * `GET /api/customers/deals`.
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

import dealsAiTools from '../../ai-tools/deals-pack'
import { knownFeatureIds, makeCtx } from './shared'

function findTool(name: string) {
  const tool = dealsAiTools.find((entry) => entry.name === name)
  if (!tool) throw new Error(`tool ${name} missing`)
  return tool
}

describe('customers.list_deals', () => {
  const tool = findTool('customers.list_deals')

  beforeEach(() => {
    findWithDecryptionMock.mockReset()
    runMock.mockReset()
    createRunnerMock.mockClear()
  })

  it('declares existing RBAC features and has no isMutation flag', () => {
    expect(tool.requiredFeatures).toContain('customers.deals.view')
    for (const feature of tool.requiredFeatures!) expect(knownFeatureIds.has(feature)).toBe(true)
    expect(tool.isMutation).toBeFalsy()
  })

  it('rejects limit > 100', () => {
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
            id: 'd1',
            title: 'Deal A',
            status: 'open',
            pipeline_stage_id: 'stage-1',
            value_amount: '1000',
            value_currency: 'USD',
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
    expect(items.map((entry) => entry.id)).toEqual(['d1'])
    expect(items[0].title).toBe('Deal A')
    expect(items[0].pipelineStageId).toBe('stage-1')
    expect(items[0].valueAmount).toBe('1000')
    expect(items[0].valueCurrency).toBe('USD')

    expect(runMock).toHaveBeenCalledTimes(1)
    const operation = runMock.mock.calls[0][0]
    expect(operation.method).toBe('GET')
    expect(operation.path).toBe('/customers/deals')
    expect(operation.query).toMatchObject({ page: 1, pageSize: 50 })
  })

  it('translates personId/companyId/pipelineStageId/status filters to API query params', async () => {
    runMock.mockResolvedValue({ success: true, statusCode: 200, data: { items: [], total: 0 } })
    const ctx = makeCtx()
    await tool.handler(
      {
        q: '  expansion  ',
        limit: 20,
        offset: 40,
        personId: '11111111-1111-1111-1111-111111111111',
        companyId: '22222222-2222-2222-2222-222222222222',
        pipelineStageId: '33333333-3333-3333-3333-333333333333',
        status: 'open',
      },
      ctx as any,
    )
    const operation = runMock.mock.calls[0][0]
    expect(operation.query.search).toBe('expansion')
    expect(operation.query.pageSize).toBe(20)
    // offset 40 with limit 20 → page 3
    expect(operation.query.page).toBe(3)
    expect(operation.query.personId).toBe('11111111-1111-1111-1111-111111111111')
    expect(operation.query.companyId).toBe('22222222-2222-2222-2222-222222222222')
    expect(operation.query.pipelineStageId).toBe('33333333-3333-3333-3333-333333333333')
    expect(operation.query.status).toBe('open')
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

describe('customers.get_deal', () => {
  const tool = findTool('customers.get_deal')

  beforeEach(() => {
    findOneWithDecryptionMock.mockReset()
    loadCustomFieldValuesMock.mockReset()
    loadCustomFieldValuesMock.mockResolvedValue({})
  })

  const dealId = '35dc2d65-6b3f-4846-a37f-a5ca7b89037c'

  it('returns { found: false } on miss (no throw)', async () => {
    findOneWithDecryptionMock.mockResolvedValue(null)
    const ctx = makeCtx()
    const result = (await tool.handler({ dealId }, ctx as any)) as Record<string, unknown>
    expect(result.found).toBe(false)
  })

  it('returns { found: false } when tenant mismatches', async () => {
    findOneWithDecryptionMock.mockResolvedValue({
      id: dealId,
      tenantId: 'tenant-2',
      organizationId: 'org-1',
      title: 'Leak',
      status: 'open',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    const ctx = makeCtx()
    const result = (await tool.handler({ dealId }, ctx as any)) as Record<string, unknown>
    expect(result.found).toBe(false)
  })
})
