import { z } from 'zod'
import type { AwilixContainer } from 'awilix'
import {
  AiMutationPreparationError,
  computeMutationIdempotencyKey,
  prepareMutation,
} from '../prepare-mutation'
import { resolveAiAgentTools } from '../agent-tools'
import type { AiAgentDefinition } from '../ai-agent-definition'
import type { AiToolDefinition } from '../types'
import {
  resetAgentRegistryForTests,
  seedAgentRegistryForTests,
} from '../agent-registry'
import { registerMcpTool, toolRegistry } from '../tool-registry'
import type {
  AiPendingActionStatus,
  AiPendingActionQueueMode,
} from '../pending-action-types'

type Row = {
  id: string
  tenantId: string
  organizationId: string | null
  agentId: string
  toolName: string
  conversationId: string | null
  targetEntityType: string | null
  targetRecordId: string | null
  normalizedInput: Record<string, unknown>
  fieldDiff: Array<{ field: string; before: unknown; after: unknown }>
  records: Array<Record<string, unknown>> | null
  failedRecords: Array<Record<string, unknown>> | null
  sideEffectsSummary: string | null
  recordVersion: string | null
  attachmentIds: string[]
  idempotencyKey: string
  createdByUserId: string
  status: AiPendingActionStatus
  queueMode: AiPendingActionQueueMode
  executionResult: Record<string, unknown> | null
  createdAt: Date
  expiresAt: Date
  resolvedAt: Date | null
  resolvedByUserId: string | null
}

let idCounter = 0

function rowMatchesWhere(row: Row, where: any): boolean {
  if (!where) return true
  if (where.id && row.id !== where.id) return false
  if (where.tenantId && row.tenantId !== where.tenantId) return false
  if ('organizationId' in where) {
    const expected = where.organizationId ?? null
    if ((row.organizationId ?? null) !== expected) return false
  }
  if (where.idempotencyKey && row.idempotencyKey !== where.idempotencyKey) {
    return false
  }
  if (where.status && row.status !== where.status) return false
  return true
}

function mockEm() {
  const store: Row[] = []

  const find = async (_entity: unknown, where: any, options?: any): Promise<Row[]> => {
    let rows = store.filter((row) => rowMatchesWhere(row, where))
    if (options?.orderBy?.createdAt === 'desc') {
      rows = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    }
    if (typeof options?.limit === 'number') rows = rows.slice(0, options.limit)
    return rows
  }

  const em: any = {
    find,
    findOne: async (_entity: unknown, where: any, options?: any) => {
      const rows = await find(_entity, where, options)
      return rows[0] ?? null
    },
    create: (_entity: unknown, data: any) => {
      idCounter += 1
      const row: Row = {
        id: `row-${idCounter}`,
        tenantId: data.tenantId,
        organizationId: data.organizationId ?? null,
        agentId: data.agentId,
        toolName: data.toolName,
        conversationId: data.conversationId ?? null,
        targetEntityType: data.targetEntityType ?? null,
        targetRecordId: data.targetRecordId ?? null,
        normalizedInput: data.normalizedInput ?? {},
        fieldDiff: Array.isArray(data.fieldDiff) ? data.fieldDiff : [],
        records: data.records ?? null,
        failedRecords: data.failedRecords ?? null,
        sideEffectsSummary: data.sideEffectsSummary ?? null,
        recordVersion: data.recordVersion ?? null,
        attachmentIds: Array.isArray(data.attachmentIds) ? data.attachmentIds : [],
        idempotencyKey: data.idempotencyKey,
        createdByUserId: data.createdByUserId,
        status: (data.status ?? 'pending') as AiPendingActionStatus,
        queueMode: (data.queueMode ?? 'inline') as AiPendingActionQueueMode,
        executionResult: data.executionResult ?? null,
        createdAt: data.createdAt instanceof Date ? data.createdAt : new Date(),
        expiresAt: data.expiresAt instanceof Date ? data.expiresAt : new Date(),
        resolvedAt: data.resolvedAt ?? null,
        resolvedByUserId: data.resolvedByUserId ?? null,
      }
      return row
    },
    persistAndFlush: async (row: Row) => {
      const idx = store.findIndex((candidate) => candidate.id === row.id)
      if (idx >= 0) store[idx] = row
      else store.push(row)
    },
    transactional: async (fn: (tx: any) => Promise<unknown>) => fn(em),
    __store: store,
  }

  return em
}

function makeContainer(em: any): AwilixContainer {
  return {
    resolve: (name: string) => {
      if (name === 'em') return em
      throw new Error(`unknown dependency ${name}`)
    },
  } as unknown as AwilixContainer
}

function makeAgent(
  overrides: Partial<AiAgentDefinition> & Pick<AiAgentDefinition, 'id'>,
): AiAgentDefinition {
  return {
    id: overrides.id,
    moduleId: 'catalog',
    label: `${overrides.id} label`,
    description: `${overrides.id} description`,
    systemPrompt: 'You are a test agent.',
    allowedTools: [],
    readOnly: false,
    mutationPolicy: 'confirm-required',
    ...overrides,
  }
}

function makeTool(
  overrides: Partial<AiToolDefinition> & Pick<AiToolDefinition, 'name'>,
): AiToolDefinition {
  return {
    description: `${overrides.name} description`,
    inputSchema: z.object({}).passthrough(),
    handler: async () => ({ ok: true }),
    ...overrides,
  }
}

const baseCtx = {
  tenantId: 't-alpha',
  organizationId: 'org-alpha',
  userId: 'u-1',
  features: ['*'],
  isSuperAdmin: true,
}

describe('prepareMutation', () => {
  beforeEach(() => {
    idCounter = 0
  })

  it('computeMutationIdempotencyKey is stable under object key reordering', () => {
    const a = computeMutationIdempotencyKey({
      tenantId: 't-alpha',
      organizationId: 'org-alpha',
      agentId: 'catalog.merch',
      conversationId: 'conv-1',
      toolName: 'catalog.products.update',
      normalizedInput: { productId: 'p-1', patch: { name: 'new', sku: 'sku-1' } },
    })
    const b = computeMutationIdempotencyKey({
      tenantId: 't-alpha',
      organizationId: 'org-alpha',
      agentId: 'catalog.merch',
      conversationId: 'conv-1',
      toolName: 'catalog.products.update',
      normalizedInput: { patch: { sku: 'sku-1', name: 'new' }, productId: 'p-1' },
    })
    expect(a).toBe(b)
    expect(a).toHaveLength(64)
  })

  it('single-record happy path: emits mutation-preview-card with pendingActionId and a computed fieldDiff', async () => {
    const em = mockEm()
    const container = makeContainer(em)
    const tool = makeTool({
      name: 'catalog.products.update',
      isMutation: true,
      loadBeforeRecord: async () => ({
        recordId: 'p-1',
        entityType: 'catalog.product',
        recordVersion: 'v-1',
        before: { name: 'old', sku: 'sku-1' },
      }),
    })
    const agent = makeAgent({ id: 'catalog.merch' })

    const { uiPart, pendingAction } = await prepareMutation(
      {
        agent,
        tool,
        toolCallArgs: { productId: 'p-1', patch: { name: 'new', sku: 'sku-1' } },
        conversationId: 'conv-1',
      },
      { ...baseCtx, container },
    )

    expect(uiPart.componentId).toBe('mutation-preview-card')
    expect(uiPart.props.pendingActionId).toBe(pendingAction.id)
    expect(uiPart.props.fieldDiff).toEqual([
      { field: 'name', before: 'old', after: 'new' },
    ])
    expect(pendingAction.targetEntityType).toBe('catalog.product')
    expect(pendingAction.targetRecordId).toBe('p-1')
    expect(pendingAction.recordVersion).toBe('v-1')
    expect(pendingAction.tenantId).toBe('t-alpha')
    expect(pendingAction.organizationId).toBe('org-alpha')
  })

  it('batch happy path: populates records[] with per-record diffs (fieldDiff stays []) when isBulk=true', async () => {
    const em = mockEm()
    const container = makeContainer(em)
    const tool = makeTool({
      name: 'catalog.products.bulk_update',
      isMutation: true,
      isBulk: true,
      loadBeforeRecords: async () => [
        {
          recordId: 'p-1',
          entityType: 'catalog.product',
          label: 'Widget',
          recordVersion: 'v-1',
          before: { name: 'old', sku: 'sku-1' },
        },
        {
          recordId: 'p-2',
          entityType: 'catalog.product',
          label: 'Gadget',
          recordVersion: 'v-2',
          before: { name: 'gadget-old', sku: 'sku-2' },
        },
      ],
    })
    const agent = makeAgent({ id: 'catalog.merch' })

    const { uiPart, pendingAction } = await prepareMutation(
      {
        agent,
        tool,
        toolCallArgs: {
          records: [
            { recordId: 'p-1', patch: { name: 'new-1' } },
            { recordId: 'p-2', patch: { name: 'new-2', sku: 'sku-2-new' } },
          ],
        },
      },
      { ...baseCtx, container },
    )

    expect(uiPart.componentId).toBe('mutation-preview-card')
    expect(uiPart.props.records).toBeDefined()
    expect(uiPart.props.fieldDiff).toBeUndefined()
    const records = pendingAction.records as Array<{
      recordId: string
      label: string
      fieldDiff: Array<{ field: string; before: unknown; after: unknown }>
    }>
    expect(records).toHaveLength(2)
    expect(records[0].recordId).toBe('p-1')
    expect(records[0].label).toBe('Widget')
    // Patch only carries `name` — keys present in `before` but not in `after`
    // still surface as diff entries with after=undefined (they are "cleared").
    expect(records[0].fieldDiff).toEqual(
      expect.arrayContaining([{ field: 'name', before: 'old', after: 'new-1' }]),
    )
    expect(records[1].fieldDiff).toEqual(
      expect.arrayContaining([
        { field: 'name', before: 'gadget-old', after: 'new-2' },
        { field: 'sku', before: 'sku-2', after: 'sku-2-new' },
      ]),
    )
    expect(pendingAction.fieldDiff).toEqual([])
  })

  it('missing loadBeforeRecord: ships fieldDiff=[] + sideEffectsSummary warning + still creates the pending row', async () => {
    const em = mockEm()
    const container = makeContainer(em)
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const tool = makeTool({
      name: 'catalog.products.update',
      isMutation: true,
    })
    const agent = makeAgent({ id: 'catalog.merch' })

    const { uiPart, pendingAction } = await prepareMutation(
      {
        agent,
        tool,
        toolCallArgs: { productId: 'p-1', patch: { name: 'new' } },
      },
      { ...baseCtx, container },
    )

    expect(uiPart.props.fieldDiff).toEqual([])
    expect(uiPart.props.sideEffectsSummary).toMatch(/did not declare a field-diff resolver/)
    expect(pendingAction.sideEffectsSummary).toMatch(/did not declare a field-diff resolver/)
    expect(pendingAction.status).toBe('pending')
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('fails closed with read_only_agent when effective mutationPolicy is read-only', async () => {
    const em = mockEm()
    const container = makeContainer(em)
    const tool = makeTool({ name: 'catalog.products.update', isMutation: true })
    const agent = makeAgent({
      id: 'catalog.merch',
      readOnly: true,
      mutationPolicy: 'read-only',
    })

    await expect(
      prepareMutation(
        {
          agent,
          tool,
          toolCallArgs: { productId: 'p-1' },
        },
        { ...baseCtx, container },
      ),
    ).rejects.toMatchObject({
      name: 'AiMutationPreparationError',
      code: 'read_only_agent',
    })
  })

  it('fails closed with not_a_mutation_tool when the tool is not marked isMutation', async () => {
    const em = mockEm()
    const container = makeContainer(em)
    const tool = makeTool({ name: 'catalog.products.list' })
    const agent = makeAgent({ id: 'catalog.merch' })

    await expect(
      prepareMutation(
        { agent, tool, toolCallArgs: {} },
        { ...baseCtx, container },
      ),
    ).rejects.toBeInstanceOf(AiMutationPreparationError)
    await expect(
      prepareMutation(
        { agent, tool, toolCallArgs: {} },
        { ...baseCtx, container },
      ),
    ).rejects.toMatchObject({ code: 'not_a_mutation_tool' })
  })

  it('is idempotent: same (agent, tool, args, conversationId) returns the same pendingActionId', async () => {
    const em = mockEm()
    const container = makeContainer(em)
    const tool = makeTool({
      name: 'catalog.products.update',
      isMutation: true,
      loadBeforeRecord: async () => ({
        recordId: 'p-1',
        entityType: 'catalog.product',
        recordVersion: 'v-1',
        before: { name: 'old' },
      }),
    })
    const agent = makeAgent({ id: 'catalog.merch' })
    const args = { productId: 'p-1', patch: { name: 'new' } }

    const first = await prepareMutation(
      { agent, tool, toolCallArgs: args, conversationId: 'conv-1' },
      { ...baseCtx, container },
    )
    const second = await prepareMutation(
      { agent, tool, toolCallArgs: args, conversationId: 'conv-1' },
      { ...baseCtx, container },
    )
    expect(second.pendingAction.id).toBe(first.pendingAction.id)
    expect(em.__store.length).toBe(1)
  })

  it('enforces tenant scoping: persisted row carries ctx.tenantId + ctx.organizationId', async () => {
    const em = mockEm()
    const container = makeContainer(em)
    const tool = makeTool({
      name: 'catalog.products.update',
      isMutation: true,
      loadBeforeRecord: async () => ({
        recordId: 'p-1',
        entityType: 'catalog.product',
        recordVersion: null,
        before: {},
      }),
    })
    const agent = makeAgent({ id: 'catalog.merch' })

    const { pendingAction } = await prepareMutation(
      { agent, tool, toolCallArgs: {} },
      {
        tenantId: 't-beta',
        organizationId: 'org-beta',
        userId: 'u-2',
        features: ['*'],
        isSuperAdmin: false,
        container,
      },
    )
    expect(pendingAction.tenantId).toBe('t-beta')
    expect(pendingAction.organizationId).toBe('org-beta')
    expect(pendingAction.createdByUserId).toBe('u-2')
  })

  it('passes attachmentIds through from toolCallArgs into the pending action row', async () => {
    const em = mockEm()
    const container = makeContainer(em)
    const tool = makeTool({
      name: 'catalog.products.update',
      isMutation: true,
      loadBeforeRecord: async () => ({
        recordId: 'p-1',
        entityType: 'catalog.product',
        recordVersion: null,
        before: {},
      }),
    })
    const agent = makeAgent({ id: 'catalog.merch' })

    const { pendingAction } = await prepareMutation(
      {
        agent,
        tool,
        toolCallArgs: {
          productId: 'p-1',
          patch: {},
          attachmentIds: ['att-1', 'att-2'],
        },
      },
      { ...baseCtx, container },
    )
    expect(pendingAction.attachmentIds).toEqual(['att-1', 'att-2'])
  })
})

describe('resolveAiAgentTools mutation interception (Step 5.6)', () => {
  let warnSpy: jest.SpyInstance

  beforeEach(() => {
    resetAgentRegistryForTests()
    toolRegistry.clear()
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  afterAll(() => {
    resetAgentRegistryForTests()
    toolRegistry.clear()
  })

  it('replaces the mutation-tool handler with a wrapper that creates a pending action and enqueues a UI part (original handler NEVER invoked)', async () => {
    const em = mockEm()
    const container = makeContainer(em)
    const handlerSpy = jest.fn(async () => ({ shouldNeverRun: true }))
    const tool: AiToolDefinition = {
      name: 'catalog.products.update',
      description: 'update',
      inputSchema: z.object({}).passthrough(),
      handler: handlerSpy,
      isMutation: true,
      loadBeforeRecord: async () => ({
        recordId: 'p-1',
        entityType: 'catalog.product',
        recordVersion: null,
        before: { name: 'old' },
      }),
    }
    registerMcpTool(tool, { moduleId: 'catalog' })
    seedAgentRegistryForTests([
      makeAgent({
        id: 'catalog.merch',
        moduleId: 'catalog',
        allowedTools: ['catalog.products.update'],
        readOnly: false,
        mutationPolicy: 'confirm-required',
      }),
    ])

    const resolved = await resolveAiAgentTools({
      agentId: 'catalog.merch',
      authContext: {
        tenantId: 't-alpha',
        organizationId: 'org-alpha',
        userId: 'u-1',
        features: ['*'],
        isSuperAdmin: true,
      },
      container,
      conversationId: 'conv-1',
    })

    expect(Object.keys(resolved.tools)).toContain('catalog.products.update')
    const adapted = resolved.tools['catalog.products.update'] as unknown as {
      execute: (args: unknown) => Promise<unknown>
    }
    const outcome = await adapted.execute({ productId: 'p-1', patch: { name: 'new' } })
    expect(handlerSpy).not.toHaveBeenCalled()
    expect(em.__store).toHaveLength(1)
    expect(em.__store[0].status).toBe('pending')
    expect(resolved.uiPartQueue.size()).toBe(1)
    const drained = resolved.uiPartQueue.drain()
    expect(drained[0].componentId).toBe('mutation-preview-card')
    expect(String(outcome)).toMatch(/pending-confirmation/)
  })

  it('does NOT intercept non-mutation tools even when the agent is mutation-capable', async () => {
    const em = mockEm()
    const container = makeContainer(em)
    const handlerSpy = jest.fn(async () => ({ ok: true, items: [] }))
    const tool: AiToolDefinition = {
      name: 'catalog.products.list',
      description: 'list',
      inputSchema: z.object({}).passthrough(),
      handler: handlerSpy,
    }
    registerMcpTool(tool, { moduleId: 'catalog' })
    seedAgentRegistryForTests([
      makeAgent({
        id: 'catalog.merch',
        moduleId: 'catalog',
        allowedTools: ['catalog.products.list'],
        readOnly: false,
        mutationPolicy: 'confirm-required',
      }),
    ])

    const resolved = await resolveAiAgentTools({
      agentId: 'catalog.merch',
      authContext: {
        tenantId: 't-alpha',
        organizationId: 'org-alpha',
        userId: 'u-1',
        features: ['*'],
        isSuperAdmin: true,
      },
      container,
    })
    const adapted = resolved.tools['catalog.products.list'] as unknown as {
      execute: (args: unknown) => Promise<unknown>
    }
    await adapted.execute({})
    expect(handlerSpy).toHaveBeenCalledTimes(1)
    expect(em.__store).toHaveLength(0)
    expect(resolved.uiPartQueue.size()).toBe(0)
  })
})
