import { z } from 'zod'
import type { AwilixContainer } from 'awilix'
import { executePendingActionConfirm } from '../pending-action-executor'
import type { AiAgentDefinition } from '../ai-agent-definition'
import type { AiToolDefinition, McpToolContext } from '../types'
import type { AiPendingAction } from '../../data/entities'

const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'
const P3 = '33333333-3333-4333-8333-333333333333'
const V1 = '2026-10-13T10:00:00.000Z'
const V2 = '2026-10-13T10:00:01.000Z'

function previewRecord(recordId: string, recordVersion: string | null) {
  return { recordId, entityType: 'catalog.product', label: recordId, fieldDiff: [], recordVersion }
}

function makeBatchAction(overrides: Partial<AiPendingAction> = {}): AiPendingAction {
  return {
    id: 'pa_batch',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    agentId: 'catalog.merchandising_assistant',
    toolName: 'catalog.bulk_update_products',
    status: 'pending',
    fieldDiff: [],
    records: [previewRecord(P1, V1), previewRecord(P2, V2)],
    failedRecords: null,
    sideEffectsSummary: null,
    recordVersion: null,
    attachmentIds: [],
    normalizedInput: {
      records: [
        { recordId: P1, title: 'AI title 1' },
        { recordId: P2, title: 'AI title 2' },
      ],
    },
    queueMode: 'inline',
    executionResult: null,
    targetEntityType: 'catalog.product',
    targetRecordId: null,
    conversationId: null,
    idempotencyKey: 'idem_batch',
    createdByUserId: 'user-1',
    createdAt: new Date('2026-10-13T09:59:00.000Z'),
    expiresAt: new Date('2026-10-13T11:00:00.000Z'),
    resolvedAt: null,
    resolvedByUserId: null,
    ...overrides,
  } as unknown as AiPendingAction
}

function makeAgent(): AiAgentDefinition {
  return {
    id: 'catalog.merchandising_assistant',
    moduleId: 'catalog',
    label: 'Catalog Agent',
    description: '...',
    systemPrompt: '...',
    allowedTools: ['catalog.bulk_update_products', 'catalog.update_product', 'catalog.update_product_media_descriptions'],
    readOnly: false,
    mutationPolicy: 'confirm-required',
  }
}

type HandlerCall = { input: unknown; ctx: McpToolContext & { expectedRecordVersions?: Record<string, string> } }

function makeRecordingTool(
  name: string,
  respond: (input: unknown) => unknown = (input) => {
    const records = (input as { records?: Array<{ recordId: string }> }).records ?? []
    return {
      commandName: 'catalog.products.update',
      records: records.map((entry) => ({ recordId: entry.recordId, status: 'updated', before: {}, after: {} })),
      failedRecordIds: [],
    }
  },
) {
  const calls: HandlerCall[] = []
  const tool = {
    name,
    description: name,
    inputSchema: z.object({}).passthrough(),
    isMutation: true,
    isBulk: name !== 'catalog.update_product',
    handler: jest.fn(async (input: unknown, ctx: McpToolContext) => {
      calls.push({ input: JSON.parse(JSON.stringify(input)), ctx: ctx as HandlerCall['ctx'] })
      return respond(input)
    }),
  } as unknown as AiToolDefinition
  return { tool, calls }
}

function makeRepoStub(initialRow: AiPendingAction) {
  let row = { ...initialRow } as AiPendingAction & Record<string, unknown>
  const setStatus = jest.fn(
    async (_id: string, nextStatus: string, _scope: unknown, extra?: Record<string, unknown>) => {
      row = { ...row, status: nextStatus as never }
      if (extra && 'executionResult' in extra) row.executionResult = (extra.executionResult ?? null) as never
      if (extra && 'failedRecords' in extra) row.failedRecords = (extra.failedRecords ?? null) as never
      if (nextStatus !== 'executing') row.resolvedAt = ((extra?.now as Date | undefined) ?? new Date()) as never
      return row as AiPendingAction
    },
  )
  return {
    setStatus,
    get current() {
      return row
    },
  }
}

function makeCtx() {
  return {
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    userId: 'user-1',
    userFeatures: ['ai_assistant.view', 'catalog.*'],
    isSuperAdmin: false,
    container: {
      resolve: (name: string) => {
        if (name === 'em') return {}
        throw new Error(`unknown dep ${name}`)
      },
    } as unknown as AwilixContainer,
  }
}

const staleP2 = [{ recordId: P2, error: { code: 'stale_version', message: 'Record version changed since preview.' } }]

describe('executePendingActionConfirm — stale rows never reach the handler', () => {
  it('1. passes only previewed, non-stale rows to the handler, with their captured versions', async () => {
    const action = makeBatchAction()
    const repo = makeRepoStub(action)
    const { tool, calls } = makeRecordingTool('catalog.bulk_update_products')

    const result = await executePendingActionConfirm({
      action,
      agent: makeAgent(),
      tool,
      ctx: makeCtx(),
      repo: repo as unknown as never,
      emitEvent: jest.fn().mockResolvedValue(undefined),
      failedRecords: staleP2,
    })

    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].input).toEqual({ records: [{ recordId: P1, title: 'AI title 1' }] })
    expect(calls[0].ctx.expectedRecordVersions).toEqual({ [P1]: V1 })
    expect(calls[0].ctx.approvedPendingActionId).toBe(action.id)
    const finalExtra = repo.setStatus.mock.calls[2][3] as Record<string, unknown>
    expect(finalExtra.failedRecords).toEqual(staleP2)
    expect(repo.current.failedRecords).toEqual(staleP2)
  })

  it('2. drops input rows that were never previewed and reports them per row', async () => {
    const action = makeBatchAction({
      records: [previewRecord(P1, V1)],
      normalizedInput: {
        records: [
          { recordId: P1, title: 'AI title 1' },
          { recordId: P3, title: 'never previewed' },
        ],
      },
    } as Partial<AiPendingAction>)
    const repo = makeRepoStub(action)
    const { tool, calls } = makeRecordingTool('catalog.bulk_update_products')

    const result = await executePendingActionConfirm({
      action,
      agent: makeAgent(),
      tool,
      ctx: makeCtx(),
      repo: repo as unknown as never,
      emitEvent: jest.fn().mockResolvedValue(undefined),
    })

    expect(result.ok).toBe(true)
    expect(calls[0].input).toEqual({ records: [{ recordId: P1, title: 'AI title 1' }] })
    const merged = (repo.setStatus.mock.calls[2][3] as Record<string, unknown>).failedRecords as Array<{
      recordId: string
      error: { code: string }
    }>
    expect(merged).toEqual([{ recordId: P3, error: { code: 'record_not_previewed', message: expect.any(String) } }])
  })

  it('3. single-record tools receive the captured version for the target record', async () => {
    const action = makeBatchAction({
      toolName: 'catalog.update_product',
      records: null,
      recordVersion: V1,
      targetRecordId: P1,
      normalizedInput: { productId: P1, title: 'AI title' },
    } as Partial<AiPendingAction>)
    const repo = makeRepoStub(action)
    const { tool, calls } = makeRecordingTool('catalog.update_product', () => ({
      recordId: P1,
      commandName: 'catalog.products.update',
    }))

    const result = await executePendingActionConfirm({
      action,
      agent: makeAgent(),
      tool,
      ctx: makeCtx(),
      repo: repo as unknown as never,
      emitEvent: jest.fn().mockResolvedValue(undefined),
    })

    expect(result.ok).toBe(true)
    expect(calls[0].input).toEqual({ productId: P1, title: 'AI title' })
    expect(calls[0].ctx.expectedRecordVersions).toEqual({ [P1]: V1 })
  })

  it('4. refuses before any transition when stale rows exist but the input cannot be narrowed', async () => {
    const action = makeBatchAction({
      toolName: 'catalog.update_product_media_descriptions',
      normalizedInput: {
        mediaUpdates: [
          { mediaId: P1, altText: 'a' },
          { mediaId: P2, altText: 'b' },
        ],
      },
    } as Partial<AiPendingAction>)
    const repo = makeRepoStub(action)
    const emitEvent = jest.fn().mockResolvedValue(undefined)
    const { tool, calls } = makeRecordingTool('catalog.update_product_media_descriptions')

    const result = await executePendingActionConfirm({
      action,
      agent: makeAgent(),
      tool,
      ctx: makeCtx(),
      repo: repo as unknown as never,
      emitEvent,
      failedRecords: staleP2,
    })

    expect(result.ok).toBe(false)
    expect(result.executionResult.error?.code).toBe('stale_version')
    expect(calls).toHaveLength(0)
    expect(repo.setStatus).not.toHaveBeenCalled()
    expect(emitEvent).not.toHaveBeenCalled()
  })

  it('5. a per-row optimistic-lock conflict from the handler is reported and nothing else is marked failed', async () => {
    const action = makeBatchAction()
    const repo = makeRepoStub(action)
    const { tool } = makeRecordingTool('catalog.bulk_update_products', () => ({
      commandName: 'catalog.products.update',
      records: [
        { recordId: P1, status: 'updated', before: {}, after: {} },
        {
          recordId: P2,
          status: 'failed',
          before: {},
          after: null,
          error: { code: 'optimistic_lock_conflict', message: 'record_modified' },
        },
      ],
      failedRecordIds: [P2],
    }))

    const result = await executePendingActionConfirm({
      action,
      agent: makeAgent(),
      tool,
      ctx: makeCtx(),
      repo: repo as unknown as never,
      emitEvent: jest.fn().mockResolvedValue(undefined),
    })

    expect(result.ok).toBe(true)
    expect(repo.current.failedRecords).toEqual([
      { recordId: P2, error: { code: 'optimistic_lock_conflict', message: 'record_modified' } },
    ])
  })

  it('6. with no stale rows the batch input is passed through unchanged (BC pin)', async () => {
    const action = makeBatchAction()
    const repo = makeRepoStub(action)
    const { tool, calls } = makeRecordingTool('catalog.bulk_update_products')

    await executePendingActionConfirm({
      action,
      agent: makeAgent(),
      tool,
      ctx: makeCtx(),
      repo: repo as unknown as never,
      emitEvent: jest.fn().mockResolvedValue(undefined),
    })

    expect(calls[0].input).toEqual(action.normalizedInput)
    expect(repo.current.failedRecords ?? null).toBeNull()
  })

  it('7. matches input ids exactly, as the preview does, so a differently cased id is not written', async () => {
    const PA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const action = makeBatchAction({
      records: [previewRecord(PA, V1), previewRecord(P2, V2)],
      normalizedInput: {
        records: [
          { recordId: PA.toUpperCase(), title: 'AI title 1' },
          { recordId: P2, title: 'AI title 2' },
        ],
      },
    } as Partial<AiPendingAction>)
    const repo = makeRepoStub(action)
    const { tool, calls } = makeRecordingTool('catalog.bulk_update_products')

    const result = await executePendingActionConfirm({
      action,
      agent: makeAgent(),
      tool,
      ctx: makeCtx(),
      repo: repo as unknown as never,
      emitEvent: jest.fn().mockResolvedValue(undefined),
    })

    expect(result.ok).toBe(true)
    expect(calls[0].input).toEqual({ records: [{ recordId: P2, title: 'AI title 2' }] })
    expect(calls[0].ctx.expectedRecordVersions).toEqual({ [P2]: V2 })
    expect(repo.current.failedRecords).toEqual([
      { recordId: PA.toUpperCase(), error: { code: 'record_not_previewed', message: expect.any(String) } },
    ])
  })

  it('8. refuses before any transition when no input row matches a previewed row', async () => {
    const action = makeBatchAction({
      normalizedInput: {
        records: [
          { id: 'line-1', quantity: 1 },
          { id: 'line-2', quantity: 2 },
        ],
      },
    } as Partial<AiPendingAction>)
    const repo = makeRepoStub(action)
    const { tool, calls } = makeRecordingTool('catalog.bulk_update_products', () => ({ commandName: 'x' }))

    const result = await executePendingActionConfirm({
      action,
      agent: makeAgent(),
      tool,
      ctx: makeCtx(),
      repo: repo as unknown as never,
      emitEvent: jest.fn().mockResolvedValue(undefined),
    })

    expect(result.ok).toBe(false)
    expect(result.executionResult.error?.code).toBe('stale_version')
    expect(calls).toHaveLength(0)
    expect(repo.setStatus).not.toHaveBeenCalled()
  })

  it('9. refuses before any transition when every previewed row in the input is stale', async () => {
    const action = makeBatchAction({
      records: [previewRecord(P2, V2)],
      normalizedInput: {
        records: [
          { recordId: P2, title: 'AI title 2' },
          { recordId: P3, title: 'never previewed' },
        ],
      },
    } as Partial<AiPendingAction>)
    const repo = makeRepoStub(action)
    const { tool, calls } = makeRecordingTool('catalog.bulk_update_products')

    const result = await executePendingActionConfirm({
      action,
      agent: makeAgent(),
      tool,
      ctx: makeCtx(),
      repo: repo as unknown as never,
      emitEvent: jest.fn().mockResolvedValue(undefined),
      failedRecords: staleP2,
    })

    expect(result.ok).toBe(false)
    expect(result.executionResult.error?.code).toBe('stale_version')
    expect(calls).toHaveLength(0)
    expect(repo.setStatus).not.toHaveBeenCalled()
  })

  it('10. a single-record conflict thrown by the handler fails the action with its code', async () => {
    const action = makeBatchAction({
      toolName: 'catalog.update_product',
      records: null,
      recordVersion: V1,
      targetRecordId: P1,
      normalizedInput: { productId: P1, title: 'AI title' },
    } as Partial<AiPendingAction>)
    const repo = makeRepoStub(action)
    const { tool } = makeRecordingTool('catalog.update_product', () => {
      throw Object.assign(new Error('record_modified'), { code: 'optimistic_lock_conflict' })
    })

    const result = await executePendingActionConfirm({
      action,
      agent: makeAgent(),
      tool,
      ctx: makeCtx(),
      repo: repo as unknown as never,
      emitEvent: jest.fn().mockResolvedValue(undefined),
    })

    expect(result.ok).toBe(false)
    expect(repo.current.status).toBe('failed')
    expect(result.executionResult.error?.code).toBe('optimistic_lock_conflict')
  })

  it('11. runs only the first entry for a repeated record id, which is the one the preview showed', async () => {
    const action = makeBatchAction({
      records: [previewRecord(P1, V1)],
      normalizedInput: {
        records: [
          { recordId: P1, title: 'previewed' },
          { recordId: P1, title: 'never shown' },
        ],
      },
    } as Partial<AiPendingAction>)
    const repo = makeRepoStub(action)
    const { tool, calls } = makeRecordingTool('catalog.bulk_update_products')

    const result = await executePendingActionConfirm({
      action,
      agent: makeAgent(),
      tool,
      ctx: makeCtx(),
      repo: repo as unknown as never,
      emitEvent: jest.fn().mockResolvedValue(undefined),
    })

    expect(result.ok).toBe(true)
    expect(calls[0].input).toEqual({ records: [{ recordId: P1, title: 'previewed' }] })
    expect(calls[0].ctx.expectedRecordVersions).toEqual({ [P1]: V1 })
    expect(repo.current.failedRecords).toEqual([
      { recordId: P1, error: { code: 'record_duplicate_dropped', message: expect.any(String) } },
    ])
  })

  it('11b. a stale or handler-failed record keeps that error over the dropped-duplicate notice', async () => {
    const action = makeBatchAction({
      normalizedInput: {
        records: [
          { recordId: P1, title: 'previewed 1' },
          { recordId: P2, title: 'previewed 2' },
          { recordId: P1, title: 'repeat 1' },
          { recordId: P2, title: 'repeat 2' },
        ],
      },
    } as Partial<AiPendingAction>)
    const repo = makeRepoStub(action)
    const lockConflict = { code: 'optimistic_lock_conflict', message: 'record_modified' }
    const { tool, calls } = makeRecordingTool('catalog.bulk_update_products', () => ({
      commandName: 'catalog.products.update',
      records: [{ recordId: P1, status: 'failed', before: {}, after: null, error: lockConflict }],
      failedRecordIds: [P1],
    }))

    const result = await executePendingActionConfirm({
      action,
      agent: makeAgent(),
      tool,
      ctx: makeCtx(),
      repo: repo as unknown as never,
      emitEvent: jest.fn().mockResolvedValue(undefined),
      failedRecords: staleP2,
    })

    expect(result.ok).toBe(true)
    expect(calls[0].input).toEqual({ records: [{ recordId: P1, title: 'previewed 1' }] })
    expect(repo.current.failedRecords).toEqual([...staleP2, { recordId: P1, error: lockConflict }])
  })

  it('12. refuses a bulk action whose preview loaded no rows', async () => {
    const action = makeBatchAction({ records: null } as Partial<AiPendingAction>)
    const repo = makeRepoStub(action)
    const { tool, calls } = makeRecordingTool('catalog.bulk_update_products')
    const bulkTool = { ...tool, loadBeforeRecords: jest.fn(async () => []) } as unknown as AiToolDefinition

    const result = await executePendingActionConfirm({
      action,
      agent: makeAgent(),
      tool: bulkTool,
      ctx: makeCtx(),
      repo: repo as unknown as never,
      emitEvent: jest.fn().mockResolvedValue(undefined),
    })

    expect(result.ok).toBe(false)
    expect(result.executionResult.error?.code).toBe('stale_version')
    expect(calls).toHaveLength(0)
    expect(repo.setStatus).not.toHaveBeenCalled()
  })

  it('13. a bulk tool without a preview resolver still runs its input unchanged (BC pin)', async () => {
    const action = makeBatchAction({ records: null } as Partial<AiPendingAction>)
    const repo = makeRepoStub(action)
    const { tool, calls } = makeRecordingTool('catalog.bulk_update_products')

    const result = await executePendingActionConfirm({
      action,
      agent: makeAgent(),
      tool,
      ctx: makeCtx(),
      repo: repo as unknown as never,
      emitEvent: jest.fn().mockResolvedValue(undefined),
    })

    expect(result.ok).toBe(true)
    expect(calls[0].input).toEqual(action.normalizedInput)
    expect(calls[0].ctx.expectedRecordVersions).toEqual({})
  })

  it('14. treats an entry whose recordId and id disagree as input that cannot be narrowed', async () => {
    const action = makeBatchAction({
      normalizedInput: {
        records: [
          { recordId: P1, id: P3, title: 'ambiguous' },
          { recordId: P2, title: 'AI title 2' },
        ],
      },
    } as Partial<AiPendingAction>)
    const repo = makeRepoStub(action)
    const { tool, calls } = makeRecordingTool('catalog.bulk_update_products')

    const result = await executePendingActionConfirm({
      action,
      agent: makeAgent(),
      tool,
      ctx: makeCtx(),
      repo: repo as unknown as never,
      emitEvent: jest.fn().mockResolvedValue(undefined),
      failedRecords: staleP2,
    })

    expect(result.ok).toBe(false)
    expect(calls).toHaveLength(0)
    expect(repo.setStatus).not.toHaveBeenCalled()
  })
})
