import { z } from 'zod'
import type { AwilixContainer } from 'awilix'
import {
  executePendingActionConfirm,
  PENDING_ACTION_CONFIRMED_EVENT_ID,
} from '../pending-action-executor'
import type { AiActionConfirmedPayload } from '../../events'
import type { AiAgentDefinition } from '../ai-agent-definition'
import type { AiToolDefinition } from '../types'
import type { AiPendingAction } from '../../data/entities'

function makeAction(overrides: Partial<AiPendingAction> = {}): AiPendingAction {
  return {
    id: 'pa_1',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    agentId: 'catalog.merchandising_assistant',
    toolName: 'catalog.update_product',
    status: 'pending',
    fieldDiff: [],
    records: null,
    failedRecords: null,
    sideEffectsSummary: null,
    recordVersion: 'v-1',
    attachmentIds: [],
    normalizedInput: { productId: 'p-1', patch: { title: 'New' } },
    queueMode: 'inline',
    executionResult: null,
    targetEntityType: 'product',
    targetRecordId: 'p-1',
    conversationId: null,
    idempotencyKey: 'idem_1',
    createdByUserId: 'user-1',
    createdAt: new Date('2026-04-18T10:00:00.000Z'),
    expiresAt: new Date('2026-04-18T11:00:00.000Z'),
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
    allowedTools: ['catalog.update_product'],
    readOnly: false,
    mutationPolicy: 'confirm-required',
  }
}

function makeTool(overrides: Partial<AiToolDefinition> = {}): AiToolDefinition {
  return {
    name: 'catalog.update_product',
    description: 'Update product',
    inputSchema: z.object({ productId: z.string(), patch: z.object({}).passthrough() }),
    handler: async () => ({ recordId: 'p-1', commandName: 'catalog.product.update' }),
    isMutation: true,
    ...overrides,
  } as AiToolDefinition
}

function makeRepoStub(initialRow: AiPendingAction) {
  let row = { ...initialRow } as AiPendingAction & Record<string, unknown>
  const setStatus = jest.fn(
    async (_id: string, nextStatus: string, _scope: unknown, extra?: Record<string, unknown>) => {
      row = {
        ...row,
        status: nextStatus as never,
      }
      if (extra && 'executionResult' in extra) {
        row.executionResult = (extra.executionResult ?? null) as never
      }
      if (extra && 'failedRecords' in extra) {
        row.failedRecords = (extra.failedRecords ?? null) as never
      }
      if (extra && 'resolvedByUserId' in extra) {
        row.resolvedByUserId = extra.resolvedByUserId as never
      }
      if (nextStatus !== 'executing') {
        row.resolvedAt = ((extra?.now as Date | undefined) ?? new Date()) as never
      }
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
    userFeatures: ['ai_assistant.view'],
    isSuperAdmin: false,
    container: {
      resolve: (name: string) => {
        if (name === 'em') return {}
        if (name === 'eventBus') return { emitEvent: async () => {} }
        throw new Error(`unknown dep ${name}`)
      },
    } as unknown as AwilixContainer,
  }
}

describe('executePendingActionConfirm', () => {
  it('transitions pending → confirmed → executing → confirmed on handler success and emits typed ai.action.confirmed', async () => {
    const repo = makeRepoStub(makeAction())
    const emitEvent = jest.fn().mockResolvedValue(undefined)
    const result = await executePendingActionConfirm({
      action: makeAction(),
      agent: makeAgent(),
      tool: makeTool(),
      ctx: makeCtx(),
      repo: repo as unknown as never,
      emitEvent,
    })
    expect(result.ok).toBe(true)
    expect(repo.setStatus).toHaveBeenCalledTimes(3)
    expect(repo.setStatus.mock.calls.map((call) => call[1])).toEqual([
      'confirmed',
      'executing',
      'confirmed',
    ])
    expect(result.executionResult).toEqual({
      recordId: 'p-1',
      commandName: 'catalog.product.update',
    })
    expect(emitEvent).toHaveBeenCalledTimes(1)
    const [emittedId, emittedPayload] = emitEvent.mock.calls[0] as [
      'ai.action.confirmed',
      AiActionConfirmedPayload,
    ]
    expect(emittedId).toBe(PENDING_ACTION_CONFIRMED_EVENT_ID)
    expect(emittedPayload).toMatchObject({
      pendingActionId: 'pa_1',
      agentId: 'catalog.merchandising_assistant',
      toolName: 'catalog.update_product',
      status: 'confirmed',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      userId: 'user-1',
      resolvedByUserId: 'user-1',
      executionResult: {
        recordId: 'p-1',
        commandName: 'catalog.product.update',
      },
    })
    expect(typeof emittedPayload.resolvedAt).toBe('string')
  })

  it('transitions pending → confirmed → executing → failed on handler throw and emits typed failure payload', async () => {
    const repo = makeRepoStub(makeAction())
    const emitEvent = jest.fn().mockResolvedValue(undefined)
    const throwingTool = makeTool({
      handler: async () => {
        throw new Error('db constraint')
      },
    })
    const result = await executePendingActionConfirm({
      action: makeAction(),
      agent: makeAgent(),
      tool: throwingTool,
      ctx: makeCtx(),
      repo: repo as unknown as never,
      emitEvent,
    })
    expect(result.ok).toBe(false)
    expect(repo.setStatus.mock.calls.map((call) => call[1])).toEqual([
      'confirmed',
      'executing',
      'failed',
    ])
    expect(result.executionResult.error).toMatchObject({ code: 'handler_error', message: 'db constraint' })
    expect(emitEvent).toHaveBeenCalledTimes(1)
    const [emittedId, emittedPayload] = emitEvent.mock.calls[0] as [
      'ai.action.confirmed',
      AiActionConfirmedPayload,
    ]
    expect(emittedId).toBe(PENDING_ACTION_CONFIRMED_EVENT_ID)
    expect(emittedPayload.status).toBe('failed')
    expect(emittedPayload.executionResult).toMatchObject({
      error: { code: 'handler_error', message: 'db constraint' },
    })
  })

  it('idempotent: calling twice on already-confirmed row returns prior result without re-executing', async () => {
    const priorResult = { recordId: 'p-1', commandName: 'catalog.product.update' }
    const repo = makeRepoStub(
      makeAction({
        status: 'confirmed' as never,
        executionResult: priorResult as never,
      }),
    )
    const emitEvent = jest.fn().mockResolvedValue(undefined)
    const handlerSpy = jest.fn(async () => ({ recordId: 'p-2' }))
    const result = await executePendingActionConfirm({
      action: makeAction({
        status: 'confirmed' as never,
        executionResult: priorResult as never,
      }),
      agent: makeAgent(),
      tool: makeTool({ handler: handlerSpy }),
      ctx: makeCtx(),
      repo: repo as unknown as never,
      emitEvent,
    })
    expect(result.ok).toBe(true)
    expect(result.executionResult).toEqual(priorResult)
    expect(handlerSpy).not.toHaveBeenCalled()
    expect(repo.setStatus).not.toHaveBeenCalled()
    expect(emitEvent).not.toHaveBeenCalled()
  })

  it('carries partial-stale failedRecords[] onto the confirmed row', async () => {
    const repo = makeRepoStub(makeAction())
    const emitEvent = jest.fn().mockResolvedValue(undefined)
    const failed = [
      { recordId: 'r-2', error: { code: 'stale_version', message: 'x' } },
    ]
    const result = await executePendingActionConfirm({
      action: makeAction(),
      agent: makeAgent(),
      tool: makeTool(),
      ctx: makeCtx(),
      repo: repo as unknown as never,
      emitEvent,
      failedRecords: failed,
    })
    expect(result.ok).toBe(true)
    const firstCallExtra = repo.setStatus.mock.calls[0][3]
    expect(firstCallExtra).toMatchObject({ failedRecords: failed })
  })
})
