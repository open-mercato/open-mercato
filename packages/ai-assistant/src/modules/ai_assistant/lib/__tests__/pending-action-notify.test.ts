const mockResolveNotificationService = jest.fn()
const mockReportError = jest.fn()

jest.mock('@open-mercato/core/modules/notifications/lib/notificationService', () => ({
  resolveNotificationService: (container: unknown) => mockResolveNotificationService(container),
}))

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: mockReportError }),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  loadDictionary: jest.fn(async () => ({
    'ai_assistant.notifications.pendingActionAwaitingApproval.title': 'Awaiting approval: {toolName}',
    'ai_assistant.notifications.pendingActionAwaitingApproval.body': 'Tool {toolName} needs approval.',
  })),
}))

jest.mock('@open-mercato/shared/lib/logger', () => {
  const mocked = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(),
  }
  mocked.child.mockImplementation(() => mocked)
  return { createLogger: jest.fn(() => mocked) }
})

type StoredRow = {
  id: string
  tenantId: string
  organizationId: string | null
  agentId: string
  toolName: string
  idempotencyKey: string
  createdByUserId: string
  channel: string
  status: string
  records: unknown[] | null
  targetEntityType: string | null
  targetRecordId: string | null
  expiresAt: Date
}

const mockStoredRows: StoredRow[] = []

jest.mock('../../data/repositories/AiPendingActionRepository', () => ({
  AiPendingActionRepository: class {
    async createOrReuse(
      input: {
        agentId: string
        toolName: string
        idempotencyKey: string
        createdByUserId: string
        channel?: string
      },
      ctx: { tenantId: string; organizationId?: string | null },
    ): Promise<{ row: StoredRow; created: boolean }> {
      const existing = mockStoredRows.find(
        (row) =>
          row.tenantId === ctx.tenantId &&
          row.idempotencyKey === input.idempotencyKey &&
          row.status === 'pending',
      )
      if (existing) return { row: existing, created: false }
      const row: StoredRow = {
        id: `00000000-0000-4000-8000-${String(mockStoredRows.length + 1).padStart(12, '0')}`,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId ?? null,
        agentId: input.agentId,
        toolName: input.toolName,
        idempotencyKey: input.idempotencyKey,
        createdByUserId: input.createdByUserId,
        channel: input.channel ?? 'agent',
        status: 'pending',
        records: null,
        targetEntityType: null,
        targetRecordId: null,
        expiresAt: new Date(Date.now() + 60_000),
      }
      mockStoredRows.push(row)
      return { row, created: true }
    }
  },
}))

import { z } from 'zod'
import type { AwilixContainer } from 'awilix'
import {
  AI_PENDING_ACTION_SOURCE_ENTITY_TYPE,
  clearPendingActionNotifications,
  notifyPendingActionAwaitingApproval,
} from '../pending-action-notify'
import { prepareMutation, prepareRawToolMutation } from '../prepare-mutation'
import { executePendingActionCancel } from '../pending-action-cancel'
import { executePendingActionConfirm } from '../pending-action-executor'
import { runPendingActionCleanup } from '../../workers/ai-pending-action-cleanup'
import type { AiPendingAction } from '../../data/entities'
import type { AiPendingActionRepository } from '../../data/repositories/AiPendingActionRepository'
import type { AiToolDefinition, McpToolContext } from '../types'
import type { AiAgentDefinition } from '../ai-agent-definition'

const TENANT_ID = 'tenant-1'
const ORG_ID = 'org-1'
const REQUESTER_ID = '11111111-1111-4111-8111-111111111111'
const ROW_ID = '33333333-3333-4333-8333-333333333333'

type FakeNotificationService = {
  create: jest.Mock
  createForFeature: jest.Mock
  deleteBySource: jest.Mock
}

function makeService(): FakeNotificationService {
  return {
    create: jest.fn(async () => ({})),
    createForFeature: jest.fn(async () => []),
    deleteBySource: jest.fn(async () => 1),
  }
}

function makeContainer(options: { notificationsRegistered?: boolean } = {}) {
  const registered = options.notificationsRegistered ?? true
  return {
    resolve: jest.fn((name: string) => {
      if (name === 'notificationService') {
        if (!registered) throw new Error('not registered')
        return {}
      }
      if (name === 'em') return {}
      return {}
    }),
  }
}

function makeRow(overrides: Partial<AiPendingAction> = {}): AiPendingAction {
  return {
    id: ROW_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    agentId: 'ai_assistant.raw_tool',
    toolName: 'customers.update_person',
    createdByUserId: REQUESTER_ID,
    channel: 'mcp',
    status: 'pending',
    normalizedInput: {},
    fieldDiff: [],
    records: null,
    failedRecords: null,
    executionResult: null,
    expiresAt: new Date(Date.now() + 60_000),
    resolvedAt: null,
    resolvedByUserId: null,
    ...overrides,
  } as unknown as AiPendingAction
}

function mutationTool(): AiToolDefinition {
  return {
    name: 'customers.update_person',
    description: 'Update a person',
    inputSchema: z.object({ name: z.string() }),
    requiredFeatures: ['customers.people.manage'],
    isMutation: true,
    handler: jest.fn(async () => ({ updated: true })),
  } as unknown as AiToolDefinition
}

function toolContext(container: ReturnType<typeof makeContainer>): McpToolContext {
  return {
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    userId: REQUESTER_ID,
    container: container as unknown as AwilixContainer,
    userFeatures: ['customers.*'],
    isSuperAdmin: false,
  }
}

let service: FakeNotificationService

beforeEach(() => {
  jest.clearAllMocks()
  mockStoredRows.length = 0
  service = makeService()
  mockResolveNotificationService.mockImplementation(() => service)
})

describe('notifyPendingActionAwaitingApproval', () => {
  it('notifies the requester and every approver feature holder with a shared groupKey and source', async () => {
    await notifyPendingActionAwaitingApproval(makeContainer(), makeRow(), {
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    })

    expect(service.create).toHaveBeenCalledTimes(1)
    const [requesterInput, requesterCtx] = service.create.mock.calls[0]
    expect(requesterInput).toMatchObject({
      recipientUserId: REQUESTER_ID,
      type: 'ai_assistant.pending_action.awaiting_approval',
      titleKey: 'ai_assistant.notifications.pendingActionAwaitingApproval.title',
      bodyKey: 'ai_assistant.notifications.pendingActionAwaitingApproval.body',
      titleVariables: { toolName: 'customers.update_person' },
      title: 'Awaiting approval: customers.update_person',
      body: 'Tool customers.update_person needs approval.',
      sourceEntityType: AI_PENDING_ACTION_SOURCE_ENTITY_TYPE,
      sourceEntityId: ROW_ID,
      groupKey: ROW_ID,
      linkHref: `/backend/config/ai-assistant/pending-actions/${ROW_ID}`,
    })
    expect(requesterCtx).toEqual({ tenantId: TENANT_ID, organizationId: ORG_ID })

    expect(service.createForFeature).toHaveBeenCalledTimes(1)
    const [approverInput, approverCtx] = service.createForFeature.mock.calls[0]
    expect(approverInput).toMatchObject({
      requiredFeature: 'ai_assistant.pending_actions.approve',
      restrictRecipientsToOrganization: true,
      sourceEntityType: AI_PENDING_ACTION_SOURCE_ENTITY_TYPE,
      sourceEntityId: ROW_ID,
      groupKey: ROW_ID,
    })
    expect(approverCtx).toEqual({ tenantId: TENANT_ID, organizationId: ORG_ID })
    expect(approverInput.groupKey).toBe(requesterInput.groupKey)
  })

  it('skips chat rows', async () => {
    await notifyPendingActionAwaitingApproval(makeContainer(), makeRow({ channel: 'agent' }), {
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    })
    expect(mockResolveNotificationService).not.toHaveBeenCalled()
    expect(service.create).not.toHaveBeenCalled()
    expect(service.createForFeature).not.toHaveBeenCalled()
  })

  it('does nothing and does not throw when the notifications module is absent', async () => {
    await expect(
      notifyPendingActionAwaitingApproval(
        makeContainer({ notificationsRegistered: false }),
        makeRow(),
        { tenantId: TENANT_ID, organizationId: ORG_ID },
      ),
    ).resolves.toBeUndefined()
    expect(mockResolveNotificationService).not.toHaveBeenCalled()
  })

  it('never throws when the notification service fails and reports the error', async () => {
    service.create.mockRejectedValueOnce(new Error('boom'))
    service.createForFeature.mockRejectedValueOnce(new Error('boom'))
    await expect(
      notifyPendingActionAwaitingApproval(makeContainer(), makeRow(), {
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
      }),
    ).resolves.toBeUndefined()
    expect(mockReportError).toHaveBeenCalledTimes(2)
  })
})

describe('clearPendingActionNotifications', () => {
  it('deletes notifications by the pending action source', async () => {
    await clearPendingActionNotifications(makeContainer(), ROW_ID, {
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    })
    expect(service.deleteBySource).toHaveBeenCalledWith(AI_PENDING_ACTION_SOURCE_ENTITY_TYPE, ROW_ID, {
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    })
  })

  it('never throws when the service is absent or fails', async () => {
    await expect(
      clearPendingActionNotifications(makeContainer({ notificationsRegistered: false }), ROW_ID, {
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
      }),
    ).resolves.toBeUndefined()
    service.deleteBySource.mockRejectedValueOnce(new Error('boom'))
    await expect(
      clearPendingActionNotifications(makeContainer(), ROW_ID, {
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
      }),
    ).resolves.toBeUndefined()
    expect(mockReportError).toHaveBeenCalledTimes(1)
  })
})

describe('notification wiring on pending action creation', () => {
  it('notifies once for a raw MCP row and skips idempotent repeats', async () => {
    const container = makeContainer()
    const input = {
      tool: mutationTool(),
      toolCallArgs: { name: 'Taylor' },
      channel: 'mcp' as const,
      requesterUserId: REQUESTER_ID,
      apiKeyId: null,
      correlationId: null,
    }
    const first = await prepareRawToolMutation(input, toolContext(container))
    const second = await prepareRawToolMutation(input, toolContext(container))

    expect(second.pendingAction.id).toBe(first.pendingAction.id)
    expect(service.create).toHaveBeenCalledTimes(1)
    expect(service.createForFeature).toHaveBeenCalledTimes(1)
  })

  it('does not notify for chat agent rows', async () => {
    const container = makeContainer()
    const agent = {
      id: 'customers.account_assistant',
      moduleId: 'customers',
      label: 'Account assistant',
      description: 'Test agent',
      systemPrompt: 'Test',
      allowedTools: ['customers.update_person'],
      mutationPolicy: 'confirm-required',
    } as unknown as AiAgentDefinition
    await prepareMutation(
      { agent, tool: mutationTool(), toolCallArgs: { name: 'Taylor' } },
      { ...toolContext(container), container: container as unknown as AwilixContainer, features: ['customers.*'] } as never,
    )
    expect(mockStoredRows).toHaveLength(1)
    expect(mockStoredRows[0].channel).toBe('agent')
    expect(service.create).not.toHaveBeenCalled()
    expect(service.createForFeature).not.toHaveBeenCalled()
  })

  it('notifies for agent runs started on the MCP channel', async () => {
    const container = makeContainer()
    const agent = {
      id: 'customers.account_assistant',
      moduleId: 'customers',
      label: 'Account assistant',
      description: 'Test agent',
      systemPrompt: 'Test',
      allowedTools: ['customers.update_person'],
      mutationPolicy: 'confirm-required',
    } as unknown as AiAgentDefinition
    await prepareMutation(
      { agent, tool: mutationTool(), toolCallArgs: { name: 'Taylor' }, channel: 'mcp' },
      { ...toolContext(container), container: container as unknown as AwilixContainer, features: ['customers.*'] } as never,
    )
    expect(service.create).toHaveBeenCalledTimes(1)
    expect(service.createForFeature).toHaveBeenCalledTimes(1)
  })
})

function makeStatusRepo(row: AiPendingAction) {
  const current = { ...row } as AiPendingAction
  return {
    setStatus: jest.fn(async (_id: string, status: string, _scope: unknown, extra?: Record<string, unknown>) => {
      Object.assign(current, { status, resolvedAt: new Date() })
      if (extra?.executionResult) Object.assign(current, { executionResult: extra.executionResult })
      return { ...current } as AiPendingAction
    }),
  } as unknown as AiPendingActionRepository
}

describe('notification clearing on resolution', () => {
  const executeCtx = (container: ReturnType<typeof makeContainer>) => ({
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    userId: REQUESTER_ID,
    userFeatures: ['customers.*'],
    isSuperAdmin: false,
    container: container as unknown as AwilixContainer,
  })

  it('clears notifications after a successful confirm', async () => {
    const container = makeContainer()
    const row = makeRow()
    await executePendingActionConfirm({
      action: row,
      agent: null,
      tool: mutationTool(),
      ctx: executeCtx(container),
      repo: makeStatusRepo(row),
      emitEvent: jest.fn(async () => undefined),
    })
    expect(service.deleteBySource).toHaveBeenCalledWith(AI_PENDING_ACTION_SOURCE_ENTITY_TYPE, ROW_ID, {
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    })
  })

  it('clears notifications after a failed confirm', async () => {
    const container = makeContainer()
    const row = makeRow()
    const tool = mutationTool()
    ;(tool.handler as jest.Mock).mockRejectedValueOnce(new Error('handler failed'))
    const result = await executePendingActionConfirm({
      action: row,
      agent: null,
      tool,
      ctx: executeCtx(container),
      repo: makeStatusRepo(row),
      emitEvent: jest.fn(async () => undefined),
    })
    expect(result.ok).toBe(false)
    expect(service.deleteBySource).toHaveBeenCalledTimes(1)
  })

  it('leaves chat rows untouched on confirm', async () => {
    const container = makeContainer()
    const row = makeRow({ channel: 'agent' })
    await executePendingActionConfirm({
      action: row,
      agent: null,
      tool: mutationTool(),
      ctx: executeCtx(container),
      repo: makeStatusRepo(row),
      emitEvent: jest.fn(async () => undefined),
    })
    expect(service.deleteBySource).not.toHaveBeenCalled()
  })

  it('clears notifications after cancel and after a TTL expiry on cancel', async () => {
    const container = makeContainer()
    const ctx = { tenantId: TENANT_ID, organizationId: ORG_ID, userId: REQUESTER_ID, container: container as unknown as AwilixContainer }
    const pendingRow = makeRow()
    await executePendingActionCancel({
      action: pendingRow,
      ctx,
      repo: makeStatusRepo(pendingRow),
      emitEvent: jest.fn(async () => undefined),
    })
    const expiredRow = makeRow({ expiresAt: new Date(Date.now() - 1_000) })
    const expired = await executePendingActionCancel({
      action: expiredRow,
      ctx,
      repo: makeStatusRepo(expiredRow),
      emitEvent: jest.fn(async () => undefined),
    })
    expect(expired.status).toBe('expired')
    expect(service.deleteBySource).toHaveBeenCalledTimes(2)
  })

  it('clears notifications for rows expired by the cleanup worker, skipping chat rows', async () => {
    const mcpRow = makeRow({ id: 'pa-mcp', expiresAt: new Date('2026-01-01T00:00:00.000Z') })
    const chatRow = makeRow({ id: 'pa-chat', channel: 'agent', expiresAt: new Date('2026-01-01T00:00:00.000Z') })
    const rows = [mcpRow, chatRow]
    const repo = {
      listExpired: jest.fn(async () => rows.splice(0, rows.length)),
      setStatus: jest.fn(async (id: string) => {
        const source = id === mcpRow.id ? mcpRow : chatRow
        return { ...source, status: 'expired', resolvedAt: new Date() } as AiPendingAction
      }),
    } as unknown as AiPendingActionRepository
    const clearNotifications = jest.fn(async () => undefined)
    const summary = await runPendingActionCleanup({
      em: {} as never,
      repo,
      emitEvent: jest.fn(async () => undefined),
      discoverTenants: async () => [{ tenantId: TENANT_ID, organizationId: ORG_ID }],
      clearNotifications,
      now: new Date('2026-02-01T00:00:00.000Z'),
    })
    expect(summary.rowsExpired).toBe(2)
    expect(clearNotifications).toHaveBeenCalledTimes(1)
    expect(clearNotifications).toHaveBeenCalledWith('pa-mcp', { tenantId: TENANT_ID, organizationId: ORG_ID })
  })

  it('uses the worker container to clear notifications when no seam is injected', async () => {
    const container = makeContainer()
    const mcpRow = makeRow({ expiresAt: new Date('2026-01-01T00:00:00.000Z') })
    const rows = [mcpRow]
    const repo = {
      listExpired: jest.fn(async () => rows.splice(0, rows.length)),
      setStatus: jest.fn(async () => ({ ...mcpRow, status: 'expired', resolvedAt: new Date() }) as AiPendingAction),
    } as unknown as AiPendingActionRepository
    await runPendingActionCleanup({
      em: {} as never,
      repo,
      emitEvent: jest.fn(async () => undefined),
      discoverTenants: async () => [{ tenantId: TENANT_ID, organizationId: ORG_ID }],
      container,
      now: new Date('2026-02-01T00:00:00.000Z'),
    })
    expect(service.deleteBySource).toHaveBeenCalledWith(AI_PENDING_ACTION_SOURCE_ENTITY_TYPE, ROW_ID, {
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    })
  })
})
