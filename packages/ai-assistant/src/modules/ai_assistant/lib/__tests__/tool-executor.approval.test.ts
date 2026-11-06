import { z } from 'zod'
import { executeTool, type ExecuteToolOptions } from '../tool-executor'
import type { AiToolDefinition, McpToolContext, McpToolDefinition } from '../types'
import {
  AI_RAW_TOOL_AGENT_ID,
  MCP_PENDING_ACTION_DEFAULT_TTL_SECONDS,
  MCP_PENDING_ACTION_TTL_ENV_VAR,
  resolveMcpPendingActionTtlSeconds,
} from '../pending-action-types'

type StoredRow = {
  id: string
  tenantId: string
  organizationId: string | null
  agentId: string
  toolName: string
  idempotencyKey: string
  createdByUserId: string
  channel: string
  apiKeyId: string | null
  correlationId: string | null
  conversationId: string | null
  targetEntityType: string | null
  targetRecordId: string | null
  records: unknown[] | null
  normalizedInput: Record<string, unknown>
  status: string
  expiresAt: Date
}

type CreateInput = {
  agentId: string
  toolName: string
  idempotencyKey: string
  createdByUserId: string
  normalizedInput: Record<string, unknown>
  conversationId?: string | null
  targetEntityType?: string | null
  targetRecordId?: string | null
  records?: unknown[] | null
  channel?: string
  apiKeyId?: string | null
  correlationId?: string | null
  ttlSeconds?: number
  now?: Date
}

type CreateContext = { tenantId: string; organizationId?: string | null; userId?: string | null }

const mockStoredRows: StoredRow[] = []
const mockCreateCalls: Array<{ input: CreateInput; ctx: CreateContext }> = []

jest.mock('../../data/repositories/AiPendingActionRepository', () => ({
  AiPendingActionRepository: class {
    async createOrReuse(
      input: CreateInput,
      ctx: CreateContext,
    ): Promise<{ row: StoredRow; created: boolean }> {
      const before = mockStoredRows.length
      const row = await this.create(input, ctx)
      return { row, created: mockStoredRows.length > before }
    }

    async create(input: CreateInput, ctx: CreateContext): Promise<StoredRow> {
      mockCreateCalls.push({ input, ctx })
      const existing = mockStoredRows.find(
        (row) =>
          row.tenantId === ctx.tenantId &&
          row.organizationId === (ctx.organizationId ?? null) &&
          row.idempotencyKey === input.idempotencyKey &&
          row.status === 'pending',
      )
      if (existing) return existing
      const now = input.now ?? new Date()
      const row: StoredRow = {
        id: `00000000-0000-4000-8000-${String(mockStoredRows.length + 1).padStart(12, '0')}`,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId ?? null,
        agentId: input.agentId,
        toolName: input.toolName,
        idempotencyKey: input.idempotencyKey,
        createdByUserId: input.createdByUserId,
        channel: input.channel ?? 'agent',
        apiKeyId: input.apiKeyId ?? null,
        correlationId: input.correlationId ?? null,
        conversationId: input.conversationId ?? null,
        targetEntityType: input.targetEntityType ?? null,
        targetRecordId: input.targetRecordId ?? null,
        records: input.records ?? null,
        normalizedInput: input.normalizedInput,
        status: 'pending',
        expiresAt: new Date(now.getTime() + (input.ttlSeconds ?? 900) * 1000),
      }
      mockStoredRows.push(row)
      return row
    }
  },
}))

const mockRegisteredTools = new Map<string, McpToolDefinition>()

jest.mock('../tool-registry', () => ({
  getToolRegistry: () => ({
    getTool: (name: string) => mockRegisteredTools.get(name),
  }),
}))

const REQUESTER_ID = '11111111-1111-4111-8111-111111111111'
const API_KEY_ID = '22222222-2222-4222-8222-222222222222'
const MUTATION_TOOL = 'customers.update_person'

const mutationHandler = jest.fn(async () => ({ updated: true }))

function buildContext(userFeatures: string[] = ['customers.*']): McpToolContext {
  return {
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    userId: REQUESTER_ID,
    container: {
      resolve: (name: string) => (name === 'em' ? {} : {}),
    } as unknown as McpToolContext['container'],
    userFeatures,
    isSuperAdmin: false,
  }
}

function approvalOptions(overrides: Partial<ExecuteToolOptions> = {}): ExecuteToolOptions {
  return {
    channel: 'mcp',
    mutationMode: 'approval',
    requester: { userId: REQUESTER_ID, apiKeyId: API_KEY_ID },
    correlationId: 'corr-1',
    ...overrides,
  }
}

describe('executeTool approval mode', () => {
  const originalTtl = process.env[MCP_PENDING_ACTION_TTL_ENV_VAR]

  beforeEach(() => {
    mockStoredRows.length = 0
    mockCreateCalls.length = 0
    mockRegisteredTools.clear()
    mutationHandler.mockClear()
    delete process.env[MCP_PENDING_ACTION_TTL_ENV_VAR]
    mockRegisteredTools.set(MUTATION_TOOL, {
      name: MUTATION_TOOL,
      description: 'Update a person',
      inputSchema: z.object({ id: z.string(), name: z.string().optional() }),
      requiredFeatures: ['customers.people.manage'],
      isMutation: true,
      loadBeforeRecord: async (args: { id: string }) => ({
        recordId: args.id,
        entityType: 'customers.person',
        recordVersion: 'v1',
        before: { name: 'Old' },
      }),
      handler: mutationHandler,
    } as unknown as AiToolDefinition)
  })

  afterAll(() => {
    if (originalTtl === undefined) delete process.env[MCP_PENDING_ACTION_TTL_ENV_VAR]
    else process.env[MCP_PENDING_ACTION_TTL_ENV_VAR] = originalTtl
  })

  it('creates exactly one pending row and does not run the handler', async () => {
    const result = await executeTool(MUTATION_TOOL, { id: 'p-1', name: 'New' }, buildContext(), approvalOptions())

    expect(mutationHandler).not.toHaveBeenCalled()
    expect(mockStoredRows).toHaveLength(1)
    const [row] = mockStoredRows
    expect(row).toMatchObject({
      agentId: AI_RAW_TOOL_AGENT_ID,
      toolName: MUTATION_TOOL,
      createdByUserId: REQUESTER_ID,
      channel: 'mcp',
      apiKeyId: API_KEY_ID,
      correlationId: 'corr-1',
      conversationId: null,
      targetEntityType: 'customers.person',
      targetRecordId: 'p-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(result).toEqual({
      success: true,
      pendingApproval: { pendingActionId: row.id, expiresAt: row.expiresAt.toISOString() },
      result: {
        status: 'pending_approval',
        pendingActionId: row.id,
        expiresAt: row.expiresAt.toISOString(),
        approvalPath: `/backend/config/ai-assistant/pending-actions/${row.id}`,
        summary: {
          toolName: MUTATION_TOOL,
          targetEntityType: 'customers.person',
          targetRecordId: 'p-1',
          recordCount: 1,
        },
      },
    })
  })

  it('returns the same pending row when the identical call is repeated', async () => {
    const first = await executeTool(MUTATION_TOOL, { id: 'p-1', name: 'New' }, buildContext(), approvalOptions())
    const second = await executeTool(
      MUTATION_TOOL,
      { name: 'New', id: 'p-1' },
      buildContext(),
      approvalOptions({ correlationId: 'corr-2' }),
    )

    expect(mockStoredRows).toHaveLength(1)
    expect(second.pendingApproval?.pendingActionId).toBe(first.pendingApproval?.pendingActionId)
    expect(mockCreateCalls[0].input.idempotencyKey).toBe(mockCreateCalls[1].input.idempotencyKey)
  })

  it('keys tools-api and mcp calls separately', async () => {
    await executeTool(MUTATION_TOOL, { id: 'p-1' }, buildContext(), approvalOptions())
    await executeTool(MUTATION_TOOL, { id: 'p-1' }, buildContext(), approvalOptions({ channel: 'tools-api' }))

    expect(mockStoredRows).toHaveLength(2)
    expect(mockStoredRows.map((row) => row.channel)).toEqual(['mcp', 'tools-api'])
  })

  it('keys calls from different API keys separately', async () => {
    await executeTool(MUTATION_TOOL, { id: 'p-1' }, buildContext(), approvalOptions())
    await executeTool(
      MUTATION_TOOL,
      { id: 'p-1' },
      buildContext(),
      approvalOptions({ requester: { userId: REQUESTER_ID, apiKeyId: null } }),
    )

    expect(mockStoredRows).toHaveLength(2)
    expect(mockCreateCalls[0].input.idempotencyKey).not.toBe(mockCreateCalls[1].input.idempotencyKey)
    expect(mockStoredRows.map((row) => row.apiKeyId)).toEqual([API_KEY_ID, null])
  })

  it.each<['mcp' | 'tools-api']>([['mcp'], ['tools-api']])(
    'refuses a tool marked approvalMode refuse on the %s channel without queueing it',
    async (channel) => {
      const executeHandler = jest.fn(async () => ({ ran: true }))
      mockRegisteredTools.set('execute', {
        name: 'execute',
        description: 'Run code',
        inputSchema: z.object({ code: z.string() }),
        isMutation: true,
        mcp: { approvalMode: 'refuse' },
        handler: executeHandler,
      } as unknown as AiToolDefinition)

      const result = await executeTool('execute', { code: 'async () => 1' }, buildContext(), approvalOptions({ channel }))

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('MUTATION_REQUIRES_APPROVAL')
      expect(result.error).toContain('"execute" is not available in approval mode')
      expect(mockCreateCalls).toHaveLength(0)
      expect(executeHandler).not.toHaveBeenCalled()
    },
  )

  it('fails validation without creating a row', async () => {
    const result = await executeTool(MUTATION_TOOL, { id: 42 }, buildContext(), approvalOptions())

    expect(result.errorCode).toBe('VALIDATION_ERROR')
    expect(mockCreateCalls).toHaveLength(0)
    expect(mutationHandler).not.toHaveBeenCalled()
  })

  it('fails the ACL check without creating a row', async () => {
    const result = await executeTool(
      MUTATION_TOOL,
      { id: 'p-1' },
      buildContext(['customers.people.view']),
      approvalOptions(),
    )

    expect(result.errorCode).toBe('UNAUTHORIZED')
    expect(mockCreateCalls).toHaveLength(0)
  })

  it.each<[string, ExecuteToolOptions['requester']]>([
    ['missing requester', undefined],
    ['null requester user', { userId: null, apiKeyId: API_KEY_ID }],
    ['api-key subject instead of a user id', { userId: `api_key:${API_KEY_ID}`, apiKeyId: API_KEY_ID }],
  ])('fails closed with MUTATION_REQUESTER_UNRESOLVED on %s', async (_label, requester) => {
    const result = await executeTool(
      MUTATION_TOOL,
      { id: 'p-1' },
      buildContext(),
      approvalOptions({ requester }),
    )

    expect(result).toMatchObject({ success: false, errorCode: 'MUTATION_REQUESTER_UNRESOLVED' })
    expect(result.pendingApproval).toBeUndefined()
    expect(mockCreateCalls).toHaveLength(0)
    expect(mutationHandler).not.toHaveBeenCalled()
  })

  it('uses the default 24h TTL when the env var is unset', async () => {
    await executeTool(MUTATION_TOOL, { id: 'p-1' }, buildContext(), approvalOptions())

    expect(mockCreateCalls[0].input.ttlSeconds).toBe(MCP_PENDING_ACTION_DEFAULT_TTL_SECONDS)
  })

  it('respects OM_MCP_PENDING_ACTION_TTL_SECONDS', async () => {
    process.env[MCP_PENDING_ACTION_TTL_ENV_VAR] = '120'
    const before = Date.now()

    const result = await executeTool(MUTATION_TOOL, { id: 'p-1' }, buildContext(), approvalOptions())

    expect(mockCreateCalls[0].input.ttlSeconds).toBe(120)
    const expiresAt = Date.parse(result.pendingApproval?.expiresAt ?? '')
    expect(expiresAt - before).toBeGreaterThanOrEqual(120_000)
    expect(expiresAt - before).toBeLessThan(130_000)
  })
})

describe('resolveMcpPendingActionTtlSeconds', () => {
  it.each([
    [undefined, MCP_PENDING_ACTION_DEFAULT_TTL_SECONDS],
    ['3600', 3600],
    ['0', MCP_PENDING_ACTION_DEFAULT_TTL_SECONDS],
    ['-5', MCP_PENDING_ACTION_DEFAULT_TTL_SECONDS],
    ['not-a-number', MCP_PENDING_ACTION_DEFAULT_TTL_SECONDS],
  ])('parses %p as %p', (raw, expected) => {
    const env: NodeJS.ProcessEnv = raw === undefined ? {} : { [MCP_PENDING_ACTION_TTL_ENV_VAR]: raw }
    expect(resolveMcpPendingActionTtlSeconds(env)).toBe(expected)
  })
})
