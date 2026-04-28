/**
 * Step 5.13 — unit coverage for `customers.update_deal_stage`, the first
 * mutation-capable tool in the customers pack. The tool drives the full
 * pending-action approval contract end-to-end:
 *
 * - `isMutation: true` flag is set (the Step 5.6 runtime wrapper keys off
 *   this flag to intercept the call and emit a `mutation-preview-card`).
 * - `requiredFeatures` matches an existing ACL feature (`customers.deals.manage`).
 * - `loadBeforeRecord` snapshots `{ status, pipelineStage, pipelineStageId }`
 *   with the deal's `updatedAt` as the recordVersion — the Step 5.8 confirm
 *   route uses that version to reject stale writes (`stale_version` 412).
 * - `loadBeforeRecord` returns `null` when the deal is outside the caller's
 *   tenant / organization scope — the Step 5.8 route turns that into a 404.
 * - `handler` delegates to the `customers.deals.update` command via the
 *   shared `commandBus` so all downstream side effects (audit log,
 *   `customers.deal.updated` event, query index refresh, notifications)
 *   match a direct API write.
 * - `handler` is tenant-scoped and carries the organization id through to
 *   the command context.
 * - Validation: exactly one of `toPipelineStageId` / `toStage` must be set.
 */
/**
 * Phase 4 of `2026-04-27-ai-tools-api-backed-dry-refactor.md`: the
 * confirmed handler now executes the write through the in-process API
 * operation runner over `PUT /api/customers/deals`. Pending-action
 * contract, prepare/preview, mutation policy, and `loadBeforeRecord`
 * are unchanged.
 */
const findOneWithDecryptionMock = jest.fn()
const runMock = jest.fn()
const createRunnerMock = jest.fn(() => ({ run: runMock }))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
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

import dealsAiTools from '../../ai-tools/deals-pack'
import { knownFeatureIds } from './shared'

function findTool(name: string) {
  const tool = dealsAiTools.find((entry) => entry.name === name)
  if (!tool) throw new Error(`tool ${name} missing`)
  return tool
}

type FakeContainer = {
  resolve: jest.Mock
}

function makeMutationCtx(options: {
  tenantId?: string | null
  organizationId?: string | null
  em?: { findOne: jest.Mock }
  userFeatures?: string[]
} = {}) {
  const em = options.em ?? { findOne: jest.fn() }
  const container: FakeContainer = {
    resolve: jest.fn((name: string) => {
      if (name === 'em') return em
      throw new Error(`unexpected resolve: ${name}`)
    }),
  }
  return {
    tenantId: 'tenantId' in options ? options.tenantId : 'tenant-1',
    organizationId: 'organizationId' in options ? options.organizationId : 'org-1',
    userId: 'user-1',
    container: container as any,
    userFeatures: options.userFeatures ?? ['customers.deals.manage'],
    isSuperAdmin: false,
    em,
  }
}

const DEAL_ID = '8b1d0f8f-5c5c-4c5f-9c5c-9c5c9c5c9c5c'
const STAGE_ID = 'a1b2c3d4-e5f6-4f01-8f02-0123456789ab'

describe('customers.update_deal_stage — contract', () => {
  const tool = findTool('customers.update_deal_stage')

  beforeEach(() => {
    findOneWithDecryptionMock.mockReset()
    runMock.mockReset()
    createRunnerMock.mockClear()
  })

  it('declares isMutation=true', () => {
    expect(tool.isMutation).toBe(true)
  })

  it('declares an existing ACL feature', () => {
    expect(tool.requiredFeatures).toContain('customers.deals.manage')
    for (const feature of tool.requiredFeatures ?? []) {
      expect(knownFeatureIds.has(feature)).toBe(true)
    }
  })

  it('declares a loadBeforeRecord resolver', () => {
    expect(typeof tool.loadBeforeRecord).toBe('function')
  })

  it('requires dealId to be a UUID', () => {
    const result = tool.inputSchema.safeParse({ dealId: 'not-a-uuid', toStage: 'won' })
    expect(result.success).toBe(false)
  })

  it('rejects input without toPipelineStageId or toStage', () => {
    const result = tool.inputSchema.safeParse({ dealId: DEAL_ID })
    expect(result.success).toBe(false)
  })

  it('rejects input with both toPipelineStageId and toStage', () => {
    const result = tool.inputSchema.safeParse({
      dealId: DEAL_ID,
      toPipelineStageId: STAGE_ID,
      toStage: 'won',
    })
    expect(result.success).toBe(false)
  })

  it('accepts toStage only', () => {
    const result = tool.inputSchema.safeParse({ dealId: DEAL_ID, toStage: 'won' })
    expect(result.success).toBe(true)
  })

  it('accepts toPipelineStageId only', () => {
    const result = tool.inputSchema.safeParse({ dealId: DEAL_ID, toPipelineStageId: STAGE_ID })
    expect(result.success).toBe(true)
  })
})

describe('customers.update_deal_stage — loadBeforeRecord', () => {
  const tool = findTool('customers.update_deal_stage')

  beforeEach(() => {
    findOneWithDecryptionMock.mockReset()
    runMock.mockReset()
    createRunnerMock.mockClear()
  })

  it('returns the current stage snapshot keyed to updatedAt as recordVersion', async () => {
    const updatedAt = new Date('2026-04-18T12:00:00Z')
    findOneWithDecryptionMock.mockResolvedValue({
      id: DEAL_ID,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      status: 'open',
      pipelineStage: 'Prospect',
      pipelineStageId: STAGE_ID,
      updatedAt,
    })
    const ctx = makeMutationCtx()
    const before = await tool.loadBeforeRecord!(
      { dealId: DEAL_ID, toStage: 'won' } as any,
      ctx as any,
    )
    expect(before).toEqual({
      recordId: DEAL_ID,
      entityType: 'customers.deal',
      recordVersion: updatedAt.toISOString(),
      before: {
        status: 'open',
        pipelineStage: 'Prospect',
        pipelineStageId: STAGE_ID,
      },
    })
  })

  it('returns null when the deal is missing', async () => {
    findOneWithDecryptionMock.mockResolvedValue(null)
    const ctx = makeMutationCtx()
    const before = await tool.loadBeforeRecord!(
      { dealId: DEAL_ID, toStage: 'won' } as any,
      ctx as any,
    )
    expect(before).toBeNull()
  })

  it('returns null for cross-tenant rows', async () => {
    findOneWithDecryptionMock.mockResolvedValue({
      id: DEAL_ID,
      tenantId: 'tenant-2', // foreign tenant
      organizationId: 'org-1',
      status: 'open',
      updatedAt: new Date(),
    })
    const ctx = makeMutationCtx({ tenantId: 'tenant-1' })
    const before = await tool.loadBeforeRecord!(
      { dealId: DEAL_ID, toStage: 'won' } as any,
      ctx as any,
    )
    expect(before).toBeNull()
  })

  it('returns null for cross-org rows when caller is org-scoped', async () => {
    findOneWithDecryptionMock.mockResolvedValue({
      id: DEAL_ID,
      tenantId: 'tenant-1',
      organizationId: 'org-2', // foreign org
      status: 'open',
      updatedAt: new Date(),
    })
    const ctx = makeMutationCtx({ organizationId: 'org-1' })
    const before = await tool.loadBeforeRecord!(
      { dealId: DEAL_ID, toStage: 'won' } as any,
      ctx as any,
    )
    expect(before).toBeNull()
  })

  it('throws when tenantId is missing', async () => {
    const ctx = makeMutationCtx({ tenantId: null })
    await expect(
      tool.loadBeforeRecord!({ dealId: DEAL_ID, toStage: 'won' } as any, ctx as any),
    ).rejects.toThrow(/Tenant context/)
  })
})

describe('customers.update_deal_stage — prepare phase issues no API write', () => {
  const tool = findTool('customers.update_deal_stage')

  beforeEach(() => {
    findOneWithDecryptionMock.mockReset()
    runMock.mockReset()
    createRunnerMock.mockClear()
  })

  it('loadBeforeRecord does NOT invoke the API operation runner', async () => {
    findOneWithDecryptionMock.mockResolvedValue({
      id: DEAL_ID,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      status: 'open',
      pipelineStage: 'Prospect',
      pipelineStageId: STAGE_ID,
      updatedAt: new Date('2026-04-18T12:00:00Z'),
    })
    const ctx = makeMutationCtx()
    await tool.loadBeforeRecord!(
      { dealId: DEAL_ID, toStage: 'won' } as any,
      ctx as any,
    )
    expect(runMock).not.toHaveBeenCalled()
    expect(createRunnerMock).not.toHaveBeenCalled()
  })
})

describe('customers.update_deal_stage — handler delegates to API runner', () => {
  const tool = findTool('customers.update_deal_stage')

  beforeEach(() => {
    findOneWithDecryptionMock.mockReset()
    runMock.mockReset()
    createRunnerMock.mockClear()
  })

  it('issues PUT /customers/deals with pipelineStageId and id+tenant+org body shape', async () => {
    const initialUpdatedAt = new Date('2026-04-18T12:00:00Z')
    const laterUpdatedAt = new Date('2026-04-18T13:00:00Z')
    findOneWithDecryptionMock
      .mockResolvedValueOnce({
        id: DEAL_ID,
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        status: 'open',
        pipelineStage: 'Prospect',
        pipelineStageId: null,
        updatedAt: initialUpdatedAt,
      })
      .mockResolvedValueOnce({
        id: DEAL_ID,
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        status: 'open',
        pipelineStage: 'Negotiation',
        pipelineStageId: STAGE_ID,
        updatedAt: laterUpdatedAt,
      })
    const em = {
      findOne: jest.fn().mockResolvedValue({ id: STAGE_ID, label: 'Negotiation' }),
    }
    runMock.mockResolvedValue({ success: true, statusCode: 200, data: { ok: true } })
    const ctx = makeMutationCtx({ em })
    const result = await tool.handler(
      { dealId: DEAL_ID, toPipelineStageId: STAGE_ID },
      ctx as any,
    )
    expect(runMock).toHaveBeenCalledTimes(1)
    const operation = runMock.mock.calls[0][0]
    expect(operation.method).toBe('PUT')
    expect(operation.path).toBe('/customers/deals')
    expect(operation.body).toEqual({
      id: DEAL_ID,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      pipelineStageId: STAGE_ID,
    })
    expect(result).toMatchObject({
      recordId: DEAL_ID,
      commandName: 'customers.deals.update',
      before: {
        status: 'open',
        pipelineStage: 'Prospect',
        pipelineStageId: null,
      },
      after: {
        status: 'open',
        pipelineStage: 'Negotiation',
        pipelineStageId: STAGE_ID,
      },
    })
  })

  it('issues PUT /customers/deals with status when toStage is provided', async () => {
    findOneWithDecryptionMock
      .mockResolvedValueOnce({
        id: DEAL_ID,
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        status: 'open',
        pipelineStage: null,
        pipelineStageId: null,
        updatedAt: new Date(),
      })
      .mockResolvedValueOnce({
        id: DEAL_ID,
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        status: 'won',
        pipelineStage: null,
        pipelineStageId: null,
        updatedAt: new Date(),
      })
    runMock.mockResolvedValue({ success: true, statusCode: 200, data: { ok: true } })
    const ctx = makeMutationCtx()
    await tool.handler({ dealId: DEAL_ID, toStage: 'won' }, ctx as any)
    const operation = runMock.mock.calls[0][0]
    expect(operation.method).toBe('PUT')
    expect(operation.path).toBe('/customers/deals')
    expect(operation.body.status).toBe('won')
    expect(operation.body.pipelineStageId).toBeUndefined()
    expect(operation.body.id).toBe(DEAL_ID)
    expect(operation.body.tenantId).toBe('tenant-1')
    expect(operation.body.organizationId).toBe('org-1')
  })

  it('throws without calling the runner when the deal is outside the caller scope', async () => {
    findOneWithDecryptionMock.mockResolvedValue(null)
    const ctx = makeMutationCtx()
    await expect(
      tool.handler({ dealId: DEAL_ID, toStage: 'won' }, ctx as any),
    ).rejects.toThrow(/not accessible/)
    expect(runMock).not.toHaveBeenCalled()
  })

  it('throws when the pipeline stage id is unknown', async () => {
    findOneWithDecryptionMock.mockResolvedValue({
      id: DEAL_ID,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      status: 'open',
      pipelineStage: null,
      pipelineStageId: null,
      updatedAt: new Date(),
    })
    const em = { findOne: jest.fn().mockResolvedValue(null) }
    const ctx = makeMutationCtx({ em })
    await expect(
      tool.handler({ dealId: DEAL_ID, toPipelineStageId: STAGE_ID }, ctx as any),
    ).rejects.toThrow(/Pipeline stage/)
    expect(runMock).not.toHaveBeenCalled()
  })

  it('bubbles a clean error when the API runner returns success=false', async () => {
    findOneWithDecryptionMock.mockResolvedValueOnce({
      id: DEAL_ID,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      status: 'open',
      pipelineStage: null,
      pipelineStageId: null,
      updatedAt: new Date(),
    })
    runMock.mockResolvedValue({
      success: false,
      statusCode: 412,
      error: 'stale_version',
    })
    const ctx = makeMutationCtx()
    await expect(
      tool.handler({ dealId: DEAL_ID, toStage: 'won' }, ctx as any),
    ).rejects.toThrow(/stale_version/)
  })
})
