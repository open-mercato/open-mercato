/**
 * Step 5.14 — unit coverage for the four D18 mutation tools in
 * `catalog/ai-tools/mutation-pack.ts`:
 *
 * - `catalog.update_product` (single-record, isBulk=false)
 * - `catalog.bulk_update_products` (batch, isBulk=true)
 * - `catalog.apply_attribute_extraction` (batch, isBulk=true,
 *   schema-drift aware)
 * - `catalog.update_product_media_descriptions` (batch, isBulk=true,
 *   direct EM write via `em.flush`)
 *
 * All four tools drive the pending-action approval contract end-to-end:
 *
 * - `isMutation: true` flag is set (Step 5.6 runtime wrapper uses this
 *   to intercept the call and emit a `mutation-preview-card`).
 * - `requiredFeatures` maps to an existing ACL feature in `catalog/acl.ts`.
 * - `loadBeforeRecord` / `loadBeforeRecords` returns tenant + org scoped
 *   before-state; cross-tenant rows are filtered out silently (not
 *   raised) so the Step 5.8 executor can treat them as missing.
 * - `handler` delegates to the `catalog.products.update` command via the
 *   shared `commandBus` for the product-level tools (identical side
 *   effects to a direct API write).
 * - The batch tools collect per-record results in `records[]` and expose
 *   `failedRecordIds[]` so the Step 5.8 executor can persist
 *   `failedRecords[]` on the `AiPendingAction` row without aborting the
 *   batch.
 * - Input schemas are `z.object(...).strict()` per spec §7 — unknown
 *   fields (including hallucinated attribute names) are rejected.
 */
/**
 * Phase 4 of `2026-04-27-ai-tools-api-backed-dry-refactor.md`: the
 * confirmed handlers for `catalog.update_product`,
 * `catalog.bulk_update_products`, and `catalog.apply_attribute_extraction`
 * now route the write through the in-process API operation runner over
 * `PUT /api/catalog/products`. Pending-action contract, prepare/preview,
 * mutation policy, `loadBeforeRecord(s)`, and AI output shape are
 * unchanged. `catalog.update_product_media_descriptions` remains a
 * direct EM write (Phase 5 exception — no documented attachment metadata
 * API/command).
 */
const findOneWithDecryptionMock = jest.fn()
const findWithDecryptionMock = jest.fn()
const loadCustomFieldDefinitionIndexMock = jest.fn()
const runMock = jest.fn()
const createRunnerMock = jest.fn(() => ({ run: runMock }))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn(),
  loadCustomFieldDefinitionIndex: (...args: unknown[]) => loadCustomFieldDefinitionIndexMock(...args),
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

import mutationAiTools from '../../ai-tools/mutation-pack'
import { knownFeatureIds } from './shared'

function findTool(name: string) {
  const tool = mutationAiTools.find((entry) => entry.name === name)
  if (!tool) throw new Error(`tool ${name} missing`)
  return tool
}

type FakeContainer = {
  resolve: jest.Mock
}

type FakeBus = {
  execute: jest.Mock
}

type MutationCtxOptions = {
  tenantId?: string | null
  organizationId?: string | null
  commandBus?: FakeBus
  em?: {
    flush: jest.Mock
  }
  userFeatures?: string[]
}

function makeMutationCtx(options: MutationCtxOptions = {}) {
  const em = options.em ?? { flush: jest.fn().mockResolvedValue(undefined) }
  const bus = options.commandBus ?? { execute: jest.fn().mockResolvedValue({ result: { productId: 'product-1' } }) }
  const container: FakeContainer = {
    resolve: jest.fn((name: string) => {
      if (name === 'em') return em
      if (name === 'commandBus') return bus
      throw new Error(`unexpected resolve: ${name}`)
    }),
  }
  return {
    tenantId: 'tenantId' in options ? options.tenantId : 'tenant-1',
    organizationId: 'organizationId' in options ? options.organizationId : 'org-1',
    userId: 'user-1',
    container: container as any,
    userFeatures: options.userFeatures ?? ['catalog.products.manage'],
    isSuperAdmin: false,
    em,
    bus,
  }
}

const PRODUCT_ID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PRODUCT_ID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const PRODUCT_ID_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const PRODUCT_ID_D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const PRODUCT_ID_E = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const MEDIA_ID_A = '11111111-1111-4111-8111-111111111111'
const MEDIA_ID_B = '22222222-2222-4222-8222-222222222222'

const PRODUCT_EXAMPLE = {
  id: PRODUCT_ID_A,
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  title: 'Widget',
  subtitle: 'shiny',
  description: 'A widget.',
  sku: 'SKU-A',
  handle: 'widget',
  isActive: true,
  primaryCurrencyCode: 'USD',
  updatedAt: new Date('2026-04-18T12:00:00Z'),
}

function clonePrototype(overrides: Record<string, unknown>) {
  return { ...PRODUCT_EXAMPLE, ...overrides }
}

describe('catalog.update_product — contract', () => {
  const tool = findTool('catalog.update_product')

  beforeEach(() => {
    findOneWithDecryptionMock.mockReset()
    findWithDecryptionMock.mockReset()
  })

  it('declares isMutation=true and isBulk=false', () => {
    expect(tool.isMutation).toBe(true)
    expect(tool.isBulk).toBeFalsy()
  })

  it('declares an existing ACL feature', () => {
    expect(tool.requiredFeatures).toContain('catalog.products.manage')
    for (const feature of tool.requiredFeatures ?? []) {
      expect(knownFeatureIds.has(feature)).toBe(true)
    }
  })

  it('declares a loadBeforeRecord resolver', () => {
    expect(typeof tool.loadBeforeRecord).toBe('function')
    expect(tool.loadBeforeRecords).toBeUndefined()
  })

  it('input schema rejects unknown fields (strict)', () => {
    const result = tool.inputSchema.safeParse({ productId: PRODUCT_ID_A, bogus: 1 })
    expect(result.success).toBe(false)
  })

  it('input schema requires productId to be a UUID', () => {
    const result = tool.inputSchema.safeParse({ productId: 'not-a-uuid' })
    expect(result.success).toBe(false)
  })

  it('input schema accepts a minimal title patch', () => {
    const result = tool.inputSchema.safeParse({ productId: PRODUCT_ID_A, title: 'Renamed' })
    expect(result.success).toBe(true)
  })
})

describe('catalog.update_product — loadBeforeRecord', () => {
  const tool = findTool('catalog.update_product')

  beforeEach(() => {
    findOneWithDecryptionMock.mockReset()
  })

  it('returns tenant-scoped snapshot with recordVersion from updatedAt', async () => {
    findOneWithDecryptionMock.mockResolvedValue(clonePrototype({}))
    const ctx = makeMutationCtx()
    const before = await tool.loadBeforeRecord!(
      { productId: PRODUCT_ID_A, title: 'Renamed' } as any,
      ctx as any,
    )
    expect(before).toEqual({
      recordId: PRODUCT_ID_A,
      entityType: 'catalog.product',
      recordVersion: PRODUCT_EXAMPLE.updatedAt.toISOString(),
      before: {
        title: 'Widget',
        subtitle: 'shiny',
        description: 'A widget.',
        sku: 'SKU-A',
        handle: 'widget',
        isActive: true,
        primaryCurrencyCode: 'USD',
      },
    })
  })

  it('returns null when the product is cross-tenant', async () => {
    findOneWithDecryptionMock.mockResolvedValue(clonePrototype({ tenantId: 'tenant-2' }))
    const ctx = makeMutationCtx()
    const before = await tool.loadBeforeRecord!(
      { productId: PRODUCT_ID_A, title: 'X' } as any,
      ctx as any,
    )
    expect(before).toBeNull()
  })

  it('returns null for cross-org rows when caller is org-scoped', async () => {
    findOneWithDecryptionMock.mockResolvedValue(clonePrototype({ organizationId: 'org-2' }))
    const ctx = makeMutationCtx({ organizationId: 'org-1' })
    const before = await tool.loadBeforeRecord!(
      { productId: PRODUCT_ID_A, title: 'X' } as any,
      ctx as any,
    )
    expect(before).toBeNull()
  })

  it('throws when tenantId is missing', async () => {
    const ctx = makeMutationCtx({ tenantId: null })
    await expect(
      tool.loadBeforeRecord!({ productId: PRODUCT_ID_A, title: 'X' } as any, ctx as any),
    ).rejects.toThrow(/Tenant context/)
  })
})

describe('catalog.update_product — prepare phase issues no API write', () => {
  const tool = findTool('catalog.update_product')

  beforeEach(() => {
    findOneWithDecryptionMock.mockReset()
    runMock.mockReset()
    createRunnerMock.mockClear()
  })

  it('loadBeforeRecord does NOT invoke the API operation runner', async () => {
    findOneWithDecryptionMock.mockResolvedValue(clonePrototype({}))
    const ctx = makeMutationCtx()
    await tool.loadBeforeRecord!(
      { productId: PRODUCT_ID_A, title: 'Renamed' } as any,
      ctx as any,
    )
    expect(runMock).not.toHaveBeenCalled()
    expect(createRunnerMock).not.toHaveBeenCalled()
  })
})

describe('catalog.update_product — handler delegates to API runner', () => {
  const tool = findTool('catalog.update_product')

  beforeEach(() => {
    findOneWithDecryptionMock.mockReset()
    runMock.mockReset()
    createRunnerMock.mockClear()
  })

  it('issues PUT /catalog/products with id+tenant+org+patch body shape', async () => {
    findOneWithDecryptionMock
      .mockResolvedValueOnce(clonePrototype({}))
      .mockResolvedValueOnce(clonePrototype({ title: 'Renamed', subtitle: null }))
    runMock.mockResolvedValue({ success: true, statusCode: 200, data: { ok: true } })
    const ctx = makeMutationCtx()
    const result = await tool.handler(
      { productId: PRODUCT_ID_A, title: 'Renamed', subtitle: null } as any,
      ctx as any,
    )
    expect(runMock).toHaveBeenCalledTimes(1)
    const operation = runMock.mock.calls[0][0]
    expect(operation.method).toBe('PUT')
    expect(operation.path).toBe('/catalog/products')
    expect(operation.body).toEqual({
      id: PRODUCT_ID_A,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      title: 'Renamed',
      subtitle: null,
    })
    expect(result).toMatchObject({
      recordId: PRODUCT_ID_A,
      commandName: 'catalog.products.update',
      before: { title: 'Widget' },
      after: { title: 'Renamed', subtitle: null },
    })
  })

  it('throws without calling the runner when the product is out of scope', async () => {
    findOneWithDecryptionMock.mockResolvedValue(null)
    const ctx = makeMutationCtx()
    await expect(
      tool.handler({ productId: PRODUCT_ID_A, title: 'X' } as any, ctx as any),
    ).rejects.toThrow(/not accessible/)
    expect(runMock).not.toHaveBeenCalled()
  })

  it('bubbles a clean error when the API runner returns success=false', async () => {
    findOneWithDecryptionMock.mockResolvedValueOnce(clonePrototype({}))
    runMock.mockResolvedValue({
      success: false,
      statusCode: 412,
      error: 'stale_version',
    })
    const ctx = makeMutationCtx()
    await expect(
      tool.handler({ productId: PRODUCT_ID_A, title: 'X' } as any, ctx as any),
    ).rejects.toThrow(/stale_version/)
  })
})

describe('catalog.bulk_update_products — contract', () => {
  const tool = findTool('catalog.bulk_update_products')

  it('declares isMutation=true and isBulk=true', () => {
    expect(tool.isMutation).toBe(true)
    expect(tool.isBulk).toBe(true)
  })

  it('declares an existing ACL feature', () => {
    expect(tool.requiredFeatures).toContain('catalog.products.manage')
    for (const feature of tool.requiredFeatures ?? []) {
      expect(knownFeatureIds.has(feature)).toBe(true)
    }
  })

  it('declares a loadBeforeRecords resolver (batch contract)', () => {
    expect(typeof tool.loadBeforeRecords).toBe('function')
    expect(tool.loadBeforeRecord).toBeUndefined()
  })

  it('rejects unknown fields (strict)', () => {
    const result = tool.inputSchema.safeParse({
      records: [{ recordId: PRODUCT_ID_A, title: 'X', rogue: 'nope' }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects an empty records array', () => {
    const result = tool.inputSchema.safeParse({ records: [] })
    expect(result.success).toBe(false)
  })
})

describe('catalog.bulk_update_products — loadBeforeRecords', () => {
  const tool = findTool('catalog.bulk_update_products')

  beforeEach(() => {
    findOneWithDecryptionMock.mockReset()
  })

  it('drops cross-tenant rows silently (Step 5.13 / 5.14 discipline)', async () => {
    findOneWithDecryptionMock
      .mockResolvedValueOnce(clonePrototype({ id: PRODUCT_ID_A }))
      .mockResolvedValueOnce(clonePrototype({ id: PRODUCT_ID_B }))
      .mockResolvedValueOnce(clonePrototype({ id: PRODUCT_ID_C, tenantId: 'tenant-2' }))
      .mockResolvedValueOnce(clonePrototype({ id: PRODUCT_ID_D }))
      .mockResolvedValueOnce(clonePrototype({ id: PRODUCT_ID_E }))
    const ctx = makeMutationCtx()
    const rows = await tool.loadBeforeRecords!(
      {
        records: [
          { recordId: PRODUCT_ID_A, title: 'T-A' },
          { recordId: PRODUCT_ID_B, title: 'T-B' },
          { recordId: PRODUCT_ID_C, title: 'T-C' }, // cross-tenant
          { recordId: PRODUCT_ID_D, title: 'T-D' },
          { recordId: PRODUCT_ID_E, title: 'T-E' },
        ],
      } as any,
      ctx as any,
    )
    const ids = rows.map((row) => row.recordId)
    expect(ids).toEqual([PRODUCT_ID_A, PRODUCT_ID_B, PRODUCT_ID_D, PRODUCT_ID_E])
    expect(rows[0]).toMatchObject({
      entityType: 'catalog.product',
      label: 'Widget',
    })
    expect(rows[0].recordVersion).toBe(PRODUCT_EXAMPLE.updatedAt.toISOString())
  })
})

describe('catalog.bulk_update_products — prepare phase issues no API write', () => {
  const tool = findTool('catalog.bulk_update_products')

  beforeEach(() => {
    findOneWithDecryptionMock.mockReset()
    runMock.mockReset()
    createRunnerMock.mockClear()
  })

  it('loadBeforeRecords does NOT invoke the API operation runner', async () => {
    findOneWithDecryptionMock
      .mockResolvedValueOnce(clonePrototype({ id: PRODUCT_ID_A }))
      .mockResolvedValueOnce(clonePrototype({ id: PRODUCT_ID_B }))
    const ctx = makeMutationCtx()
    await tool.loadBeforeRecords!(
      {
        records: [
          { recordId: PRODUCT_ID_A, title: 'T-A' },
          { recordId: PRODUCT_ID_B, title: 'T-B' },
        ],
      } as any,
      ctx as any,
    )
    expect(runMock).not.toHaveBeenCalled()
    expect(createRunnerMock).not.toHaveBeenCalled()
  })
})

describe('catalog.bulk_update_products — handler delegates to API runner per record', () => {
  const tool = findTool('catalog.bulk_update_products')

  beforeEach(() => {
    findOneWithDecryptionMock.mockReset()
    runMock.mockReset()
    createRunnerMock.mockClear()
  })

  it('issues one PUT /catalog/products call per accessible record and emits a single pending action', async () => {
    findOneWithDecryptionMock
      .mockResolvedValueOnce(clonePrototype({ id: PRODUCT_ID_A }))
      .mockResolvedValueOnce(clonePrototype({ id: PRODUCT_ID_A, title: 'T-A' }))
      .mockResolvedValueOnce(null) // cross-tenant B
      .mockResolvedValueOnce(clonePrototype({ id: PRODUCT_ID_C }))
      .mockResolvedValueOnce(clonePrototype({ id: PRODUCT_ID_C, title: 'T-C' }))
    runMock.mockResolvedValue({ success: true, statusCode: 200, data: { ok: true } })
    const ctx = makeMutationCtx()
    const result = (await tool.handler(
      {
        records: [
          { recordId: PRODUCT_ID_A, title: 'T-A' },
          { recordId: PRODUCT_ID_B, title: 'T-B' },
          { recordId: PRODUCT_ID_C, title: 'T-C' },
        ],
      } as any,
      ctx as any,
    )) as any
    expect(createRunnerMock).toHaveBeenCalledTimes(1) // single pending action / single runner instance
    expect(runMock).toHaveBeenCalledTimes(2)
    const firstCall = runMock.mock.calls[0][0]
    expect(firstCall.method).toBe('PUT')
    expect(firstCall.path).toBe('/catalog/products')
    expect(firstCall.body).toEqual({
      id: PRODUCT_ID_A,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      title: 'T-A',
    })
    expect(result.commandName).toBe('catalog.products.update')
    expect(result.failedRecordIds).toEqual([PRODUCT_ID_B])
    expect(result.records).toHaveLength(3)
    expect(result.records[0]).toMatchObject({
      recordId: PRODUCT_ID_A,
      status: 'updated',
      before: { title: 'Widget' },
      after: { title: 'T-A' },
    })
    expect(result.records[1]).toMatchObject({
      recordId: PRODUCT_ID_B,
      status: 'skipped',
      error: { code: 'record_not_found' },
    })
    expect(result.records[2]).toMatchObject({ recordId: PRODUCT_ID_C, status: 'updated' })
    expect(result.error).toBeUndefined()
  })

  it('marks all_records_failed when every record is out of scope without calling the runner', async () => {
    findOneWithDecryptionMock.mockResolvedValue(null)
    const ctx = makeMutationCtx()
    const result = (await tool.handler(
      {
        records: [
          { recordId: PRODUCT_ID_A, title: 'x' },
          { recordId: PRODUCT_ID_B, title: 'y' },
        ],
      } as any,
      ctx as any,
    )) as any
    expect(runMock).not.toHaveBeenCalled()
    expect(result.failedRecordIds).toEqual([PRODUCT_ID_A, PRODUCT_ID_B])
    expect(result.error).toEqual({ code: 'all_records_failed', message: expect.any(String) })
  })

  it('records per-record failure with succeeded rows preserved when the runner returns success=false', async () => {
    findOneWithDecryptionMock
      .mockResolvedValueOnce(clonePrototype({ id: PRODUCT_ID_A }))
      .mockResolvedValueOnce(clonePrototype({ id: PRODUCT_ID_A, title: 'A' })) // after read for A
      .mockResolvedValueOnce(clonePrototype({ id: PRODUCT_ID_B }))
    runMock
      .mockResolvedValueOnce({ success: true, statusCode: 200, data: { ok: true } })
      .mockResolvedValueOnce({
        success: false,
        statusCode: 412,
        error: 'stale',
        details: { code: 'stale_version' },
      })
    const ctx = makeMutationCtx()
    const result = (await tool.handler(
      {
        records: [
          { recordId: PRODUCT_ID_A, title: 'A' },
          { recordId: PRODUCT_ID_B, title: 'B' },
        ],
      } as any,
      ctx as any,
    )) as any
    expect(result.records[0]).toMatchObject({
      recordId: PRODUCT_ID_A,
      status: 'updated',
      before: { title: 'Widget' },
      after: { title: 'A' },
    })
    expect(result.records[1]).toMatchObject({
      recordId: PRODUCT_ID_B,
      status: 'failed',
      error: { code: 'stale_version', message: 'stale' },
    })
    expect(result.failedRecordIds).toEqual([PRODUCT_ID_B])
  })

  it('records per-record failure when the runner throws', async () => {
    findOneWithDecryptionMock
      .mockResolvedValueOnce(clonePrototype({ id: PRODUCT_ID_A }))
      .mockResolvedValueOnce(clonePrototype({ id: PRODUCT_ID_A, title: 'A' }))
      .mockResolvedValueOnce(clonePrototype({ id: PRODUCT_ID_B }))
    runMock
      .mockResolvedValueOnce({ success: true, statusCode: 200, data: { ok: true } })
      .mockRejectedValueOnce(Object.assign(new Error('boom'), { code: 'runner_failed' }))
    const ctx = makeMutationCtx()
    const result = (await tool.handler(
      {
        records: [
          { recordId: PRODUCT_ID_A, title: 'A' },
          { recordId: PRODUCT_ID_B, title: 'B' },
        ],
      } as any,
      ctx as any,
    )) as any
    expect(result.records[0]).toMatchObject({ recordId: PRODUCT_ID_A, status: 'updated' })
    expect(result.records[1]).toMatchObject({
      recordId: PRODUCT_ID_B,
      status: 'failed',
      error: { code: 'runner_failed', message: 'boom' },
    })
    expect(result.failedRecordIds).toEqual([PRODUCT_ID_B])
  })
})

describe('catalog.apply_attribute_extraction — contract', () => {
  const tool = findTool('catalog.apply_attribute_extraction')

  it('declares isMutation=true and isBulk=true', () => {
    expect(tool.isMutation).toBe(true)
    expect(tool.isBulk).toBe(true)
  })

  it('declares an existing ACL feature', () => {
    expect(tool.requiredFeatures).toContain('catalog.products.manage')
  })

  it('declares a loadBeforeRecords resolver', () => {
    expect(typeof tool.loadBeforeRecords).toBe('function')
  })

  it('rejects unknown top-level fields (strict)', () => {
    const result = tool.inputSchema.safeParse({
      records: [{ recordId: PRODUCT_ID_A, attributes: { color: 'red' } }],
      bogus: 1,
    })
    expect(result.success).toBe(false)
  })
})

describe('catalog.apply_attribute_extraction — handler', () => {
  const tool = findTool('catalog.apply_attribute_extraction')

  beforeEach(() => {
    findOneWithDecryptionMock.mockReset()
    loadCustomFieldDefinitionIndexMock.mockReset()
  })

  it('surfaces attribute_not_in_schema when an attribute key is unknown', async () => {
    findOneWithDecryptionMock.mockResolvedValueOnce(clonePrototype({ id: PRODUCT_ID_A }))
    loadCustomFieldDefinitionIndexMock.mockResolvedValue(new Map([['color', {}]]))
    const bus: FakeBus = { execute: jest.fn() }
    const ctx = makeMutationCtx({ commandBus: bus })
    const result = (await tool.handler(
      {
        records: [
          {
            recordId: PRODUCT_ID_A,
            attributes: { color: 'red', unknown_attr: 42 },
          },
        ],
      } as any,
      ctx as any,
    )) as any
    expect(bus.execute).not.toHaveBeenCalled()
    expect(result.records[0]).toMatchObject({
      recordId: PRODUCT_ID_A,
      status: 'failed',
      error: { code: 'attribute_not_in_schema' },
    })
    expect(result.failedRecordIds).toEqual([PRODUCT_ID_A])
  })

  it('delegates to catalog.products.update with cf_* keys when every attribute is in the schema', async () => {
    findOneWithDecryptionMock.mockResolvedValueOnce(clonePrototype({ id: PRODUCT_ID_A }))
    loadCustomFieldDefinitionIndexMock.mockResolvedValue(
      new Map([
        ['color', {}],
        ['weight_kg', {}],
      ]),
    )
    const bus: FakeBus = { execute: jest.fn().mockResolvedValue({ result: { productId: PRODUCT_ID_A } }) }
    const ctx = makeMutationCtx({ commandBus: bus })
    const result = (await tool.handler(
      {
        records: [
          {
            recordId: PRODUCT_ID_A,
            attributes: { color: 'red', weight_kg: 12 },
          },
        ],
      } as any,
      ctx as any,
    )) as any
    expect(bus.execute).toHaveBeenCalledTimes(1)
    const [, options] = bus.execute.mock.calls[0]
    expect(options.input).toMatchObject({
      id: PRODUCT_ID_A,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      cf_color: 'red',
      cf_weight_kg: 12,
    })
    expect(result.records[0]).toMatchObject({ recordId: PRODUCT_ID_A, status: 'updated' })
  })
})

describe('catalog.update_product_media_descriptions — contract', () => {
  const tool = findTool('catalog.update_product_media_descriptions')

  it('declares isMutation=true and isBulk=true', () => {
    expect(tool.isMutation).toBe(true)
    expect(tool.isBulk).toBe(true)
  })

  it('declares an existing ACL feature', () => {
    expect(tool.requiredFeatures).toContain('catalog.products.manage')
    for (const feature of tool.requiredFeatures ?? []) {
      expect(knownFeatureIds.has(feature)).toBe(true)
    }
  })

  it('rejects unknown fields (strict)', () => {
    const result = tool.inputSchema.safeParse({
      mediaUpdates: [{ mediaId: MEDIA_ID_A, altText: 'x', rogue: true }],
    })
    expect(result.success).toBe(false)
  })

  it('requires at least one mediaUpdates entry', () => {
    const result = tool.inputSchema.safeParse({ mediaUpdates: [] })
    expect(result.success).toBe(false)
  })

  it('declares a loadBeforeRecords resolver (always batch)', () => {
    expect(typeof tool.loadBeforeRecords).toBe('function')
  })
})

describe('catalog.update_product_media_descriptions — handler', () => {
  const tool = findTool('catalog.update_product_media_descriptions')

  beforeEach(() => {
    findOneWithDecryptionMock.mockReset()
  })

  it('handles a single media update (one-or-many contract)', async () => {
    const mediaRow = {
      id: MEDIA_ID_A,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      fileName: 'hero.jpg',
      storageMetadata: null,
      createdAt: new Date('2026-04-01T00:00:00Z'),
    }
    findOneWithDecryptionMock.mockResolvedValueOnce(mediaRow)
    const em = { flush: jest.fn().mockResolvedValue(undefined) }
    const ctx = makeMutationCtx({ em })
    const result = (await tool.handler(
      {
        mediaUpdates: [{ mediaId: MEDIA_ID_A, altText: 'Hero shot' }],
      } as any,
      ctx as any,
    )) as any
    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(result.records[0]).toMatchObject({
      recordId: MEDIA_ID_A,
      status: 'updated',
      after: { altText: 'Hero shot' },
    })
    expect(mediaRow.storageMetadata).toEqual({ altText: 'Hero shot' })
  })

  it('handles many media updates in a single flush', async () => {
    const first = {
      id: MEDIA_ID_A,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      fileName: 'a.jpg',
      storageMetadata: { altText: 'old' } as Record<string, unknown>,
      createdAt: new Date(),
    }
    const second = {
      id: MEDIA_ID_B,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      fileName: 'b.jpg',
      storageMetadata: null,
      createdAt: new Date(),
    }
    findOneWithDecryptionMock.mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    const em = { flush: jest.fn().mockResolvedValue(undefined) }
    const ctx = makeMutationCtx({ em })
    const result = (await tool.handler(
      {
        mediaUpdates: [
          { mediaId: MEDIA_ID_A, altText: 'new alt' },
          { mediaId: MEDIA_ID_B, caption: 'New caption' },
        ],
      } as any,
      ctx as any,
    )) as any
    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(result.records).toHaveLength(2)
    expect(first.storageMetadata).toEqual({ altText: 'new alt' })
    expect(second.storageMetadata).toEqual({ caption: 'New caption' })
  })

  it('skips cross-tenant media silently and reports all_records_failed if none match', async () => {
    findOneWithDecryptionMock.mockResolvedValue(null)
    const em = { flush: jest.fn().mockResolvedValue(undefined) }
    const ctx = makeMutationCtx({ em })
    const result = (await tool.handler(
      {
        mediaUpdates: [{ mediaId: MEDIA_ID_A, altText: 'x' }],
      } as any,
      ctx as any,
    )) as any
    expect(em.flush).not.toHaveBeenCalled()
    expect(result.records[0]).toMatchObject({
      recordId: MEDIA_ID_A,
      status: 'skipped',
      error: { code: 'record_not_found' },
    })
    expect(result.error).toEqual({ code: 'all_records_failed', message: expect.any(String) })
  })
})
