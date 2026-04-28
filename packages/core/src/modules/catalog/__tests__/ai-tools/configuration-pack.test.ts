/**
 * Step 3.10 — option schemas / unit conversions unit tests.
 *
 * Phase 3c of `2026-04-27-ai-tools-api-backed-dry-refactor`:
 * `catalog.list_option_schemas` delegates to the in-process API operation
 * runner over `GET /api/catalog/option-schemas`. Tests mock the runner module
 * rather than the ORM/query engine for that tool.
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

import configurationAiTools from '../../ai-tools/configuration-pack'
import { knownFeatureIds, makeCtx } from './shared'

function findTool(name: string) {
  const tool = configurationAiTools.find((entry) => entry.name === name)
  if (!tool) throw new Error(`tool ${name} missing`)
  return tool
}

describe('catalog.list_option_schemas', () => {
  const tool = findTool('catalog.list_option_schemas')

  beforeEach(() => {
    findWithDecryptionMock.mockReset()
    runMock.mockReset()
    createRunnerMock.mockClear()
  })

  it('declares known RBAC features and is read-only', () => {
    expect(tool.requiredFeatures).toEqual(['catalog.products.view'])
    for (const feature of tool.requiredFeatures!) expect(knownFeatureIds.has(feature)).toBe(true)
    expect(tool.isMutation).toBeFalsy()
  })

  it('caps limit at 100', () => {
    expect(tool.inputSchema.safeParse({ limit: 200 }).success).toBe(false)
    expect(tool.inputSchema.safeParse({ limit: 100 }).success).toBe(true)
  })

  it('delegates to the API runner with default page/pageSize and maps the response', async () => {
    runMock.mockResolvedValue({
      success: true,
      statusCode: 200,
      data: {
        items: [
          {
            id: 's1',
            code: 'size',
            name: 'Size',
            description: null,
            schema: { type: 'enum', values: ['S', 'M'] },
            metadata: null,
            is_active: true,
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
    expect(items.map((entry) => entry.code)).toEqual(['size'])
    expect(items[0].name).toBe('Size')
    expect(items[0].isActive).toBe(true)
    expect(items[0].tenantId).toBe('tenant-1')
    expect(result.limit).toBe(50)
    expect(result.offset).toBe(0)

    expect(runMock).toHaveBeenCalledTimes(1)
    const operation = runMock.mock.calls[0][0]
    expect(operation.method).toBe('GET')
    expect(operation.path).toBe('/catalog/option-schemas')
    expect(operation.query).toMatchObject({ page: 1, pageSize: 50 })
  })

  it('translates limit/offset into page/pageSize', async () => {
    runMock.mockResolvedValue({ success: true, statusCode: 200, data: { items: [], total: 0 } })
    const ctx = makeCtx()
    await tool.handler({ limit: 25, offset: 50 }, ctx as any)
    const operation = runMock.mock.calls[0][0]
    expect(operation.query.pageSize).toBe(25)
    expect(operation.query.page).toBe(3)
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

describe('catalog.list_unit_conversions', () => {
  const tool = findTool('catalog.list_unit_conversions')

  beforeEach(() => {
    findWithDecryptionMock.mockReset()
  })

  it('scopes by product when provided', async () => {
    findWithDecryptionMock.mockResolvedValue([])
    const ctx = makeCtx()
    ctx.em.count.mockResolvedValue(0)
    await tool.handler({ productId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, ctx as any)
    const whereArg = findWithDecryptionMock.mock.calls[0][2]
    expect(whereArg.product).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    expect(whereArg.deletedAt).toBeNull()
  })

  it('rejects missing tenant', async () => {
    const ctx = makeCtx({ tenantId: null })
    await expect(tool.handler({}, ctx as any)).rejects.toThrow(/Tenant context is required/)
  })
})
