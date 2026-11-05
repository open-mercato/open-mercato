/**
 * Step 3.10 — variants unit tests.
 *
 * Phase 3b of `2026-04-27-ai-tools-api-backed-dry-refactor`: the list tool
 * delegates to the in-process API operation runner over
 * `GET /api/catalog/variants`. Tests mock the runner module rather than the
 * ORM/query engine.
 */
const findWithDecryptionMock = jest.fn()
const runMock = jest.fn()
const createRunnerMock = jest.fn(() => ({ run: runMock }))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
  findOneWithDecryption: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn(),
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

import variantsAiTools from '../../ai-tools/variants-pack'
import { knownFeatureIds, makeCtx } from './shared'

describe('catalog.list_variants', () => {
  const tool = variantsAiTools.find((entry) => entry.name === 'catalog.list_variants')!

  beforeEach(() => {
    findWithDecryptionMock.mockReset()
    runMock.mockReset()
    createRunnerMock.mockClear()
  })

  it('declares a RBAC view feature that exists in acl.ts', () => {
    expect(tool.requiredFeatures).toBeDefined()
    for (const feature of tool.requiredFeatures!) {
      expect(knownFeatureIds.has(feature)).toBe(true)
    }
    expect(tool.isMutation).toBeFalsy()
  })

  it('requires productId', () => {
    expect(tool.inputSchema.safeParse({}).success).toBe(false)
  })

  it('caps limit at 100', () => {
    expect(
      tool.inputSchema.safeParse({
        productId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        limit: 101,
      }).success,
    ).toBe(false)
  })

  it('delegates to the API runner with productId in the query', async () => {
    runMock.mockResolvedValue({ success: true, statusCode: 200, data: { items: [], total: 0 } })
    const ctx = makeCtx()
    await tool.handler(
      { productId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      ctx as any,
    )
    expect(runMock).toHaveBeenCalledTimes(1)
    const operation = runMock.mock.calls[0][0]
    expect(operation.method).toBe('GET')
    expect(operation.path).toBe('/catalog/variants')
    expect(operation.query).toMatchObject({
      page: 1,
      pageSize: 50,
      productId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    })
  })

  it('translates limit/offset into page/pageSize', async () => {
    runMock.mockResolvedValue({ success: true, statusCode: 200, data: { items: [], total: 0 } })
    const ctx = makeCtx()
    await tool.handler(
      {
        productId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        limit: 20,
        offset: 40,
      },
      ctx as any,
    )
    const operation = runMock.mock.calls[0][0]
    expect(operation.query.pageSize).toBe(20)
    // offset 40 with limit 20 → page 3
    expect(operation.query.page).toBe(3)
  })

  it('maps API response rows to the AI tool output shape', async () => {
    runMock.mockResolvedValue({
      success: true,
      statusCode: 200,
      data: {
        items: [
          {
            id: 'v1',
            product_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            tenant_id: 'tenant-1',
            organization_id: 'org-1',
            name: 'Default',
            sku: 'A',
            is_active: true,
            is_default: true,
            option_values: { color: 'red' },
            created_at: '2024-01-01T00:00:00.000Z',
          },
        ],
        total: 1,
      },
    })
    const ctx = makeCtx()
    const result = (await tool.handler(
      { productId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      ctx as any,
    )) as Record<string, unknown>
    const items = result.items as Array<Record<string, unknown>>
    expect(items).toHaveLength(1)
    expect(items[0].id).toBe('v1')
    expect(items[0].productId).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    expect(items[0].sku).toBe('A')
    expect(items[0].isActive).toBe(true)
    expect(items[0].isDefault).toBe(true)
    expect(items[0].optionValues).toEqual({ color: 'red' })
    expect(items[0].tenantId).toBe('tenant-1')
    expect(result.total).toBe(1)
    expect(result.limit).toBe(50)
    expect(result.offset).toBe(0)
  })

  it('rejects calls without a tenant context', async () => {
    const ctx = makeCtx({ tenantId: null })
    await expect(
      tool.handler(
        { productId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
        ctx as any,
      ),
    ).rejects.toThrow(/Tenant context is required/)
  })

  it('bubbles a clean Error when the runner reports failure', async () => {
    runMock.mockResolvedValue({ success: false, statusCode: 403, error: 'forbidden by route policy' })
    const ctx = makeCtx()
    await expect(
      tool.handler(
        { productId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
        ctx as any,
      ),
    ).rejects.toThrow('forbidden by route policy')
  })
})
