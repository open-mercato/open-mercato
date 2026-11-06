const mockFindOneWithDecryption = jest.fn()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
}))

import { asValue, createContainer, InjectionMode } from 'awilix'
import { CommandBus, commandRegistry, registerCommand } from '@open-mercato/shared/lib/commands'
import { getAmbientAuditCorrelation } from '@open-mercato/shared/lib/commands/auditCorrelationScope'
import { reportKnowledgeVersion, reportRetrieval } from '@open-mercato/shared/lib/ai/run-observation'
import type { McpToolExecutionObserverContext } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/mcp-tool-execution-observer'
import {
  createMcpToolObservationBinder,
  type ObservedAgentRun,
  type ToolObservationWrite,
} from '../lib/runtime/mcpToolObservationBinder'
import { InMemoryAgentRunSessionStore } from '../lib/runtime/agentRunSessionStore'
import { isRuntimeAuditWriteActive } from '../lib/identity/agentWriteScope'

const RUN: ObservedAgentRun = {
  id: 'run-1',
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  parentRunId: 'parent-run-1',
  workflowInstanceId: null,
}

const CONTEXT: McpToolExecutionObserverContext = {
  sessionId: 'sess_run_1',
  toolName: 'kb.search',
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  correlationId: 'corr-1',
}

function makeBinder(options: { run?: ObservedAgentRun | null; writes?: ToolObservationWrite[]; failWrite?: boolean } = {}) {
  const writes = options.writes ?? []
  const resolveRun = jest.fn(async (sessionId: string) =>
    sessionId === CONTEXT.sessionId ? (options.run === undefined ? RUN : options.run) : null,
  )
  const binder = createMcpToolObservationBinder({ resolve: jest.fn() } as never, {
    resolveRun,
    writeObservation: async (input) => {
      if (options.failWrite) throw new Error('db down')
      writes.push(input)
    },
    generateId: () => 'generated-id',
  })
  return { binder, resolveRun, writes }
}

describe('createMcpToolObservationBinder', () => {
  beforeEach(() => {
    mockFindOneWithDecryption.mockReset()
  })

  it('binds the run audit correlation around the tool call', async () => {
    const { binder, resolveRun } = makeBinder()
    const correlation = await binder.wrap(CONTEXT, async () => getAmbientAuditCorrelation())
    expect(resolveRun).toHaveBeenCalledWith('sess_run_1')
    expect(correlation).toEqual({ agentRunId: 'run-1', parentAgentRunId: 'parent-run-1' })
  })

  it('stamps the run id on command writes made inside the tool call', async () => {
    const logMock = jest.fn(async () => ({ id: 'log-1' }))
    registerCommand({
      id: 'test.mcp_observed_write',
      execute: jest.fn(async () => ({ ok: true })),
      buildLog: jest.fn(() => ({ actionLabel: 'Write', resourceKind: 'test', resourceId: '1' })),
    })
    const commandContainer = createContainer({ injectionMode: InjectionMode.CLASSIC })
    commandContainer.register({ actionLogService: asValue({ log: logMock }) })
    const { binder } = makeBinder()
    try {
      await binder.wrap(CONTEXT, () =>
        new CommandBus().execute('test.mcp_observed_write', {
          input: {},
          ctx: {
            container: commandContainer,
            auth: { sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' },
            organizationScope: null,
            selectedOrganizationId: 'org-1',
            organizationIds: ['org-1'],
          },
        }),
      )
    } finally {
      commandRegistry.clear()
    }
    const logPayload = logMock.mock.calls[0][0] as { context?: { correlation?: Record<string, string> } }
    expect(logPayload.context?.correlation).toMatchObject({ agentRunId: 'run-1' })
  })

  it('writes one observation span when the tool reported knowledge or retrieval', async () => {
    const { binder, writes } = makeBinder()
    const result = await binder.wrap(CONTEXT, async () => {
      reportKnowledgeVersion('kb.policy', 'v4')
      reportRetrieval({ source: 'kb', queryHash: 'qh', k: 2, hits: [{ ref: 'doc-1', score: 0.7 }] })
      return 'ok'
    })
    expect(result).toBe('ok')
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({
      run: RUN,
      toolName: 'kb.search',
      observationId: 'corr-1',
      status: 'ok',
      snapshot: {
        knowledge: { 'kb.policy': { version: 'v4' } },
        retrievals: [{ source: 'kb', queryHash: 'qh', k: 2, hits: [{ ref: 'doc-1', score: 0.7 }] }],
      },
    })
  })

  it('writes nothing when the tool reported nothing', async () => {
    const { binder, writes } = makeBinder()
    await binder.wrap(CONTEXT, async () => 'ok')
    expect(writes).toHaveLength(0)
  })

  it('records an error status and rethrows the tool error', async () => {
    const { binder, writes } = makeBinder()
    const toolError = new Error('tool failed')
    await expect(
      binder.wrap({ ...CONTEXT, correlationId: undefined }, async () => {
        reportKnowledgeVersion('kb.policy', 'v4')
        throw toolError
      }),
    ).rejects.toBe(toolError)
    expect(writes[0]).toMatchObject({ status: 'error', observationId: 'generated-id' })
  })

  it('runs the tool plainly for an unknown session', async () => {
    const { binder, writes } = makeBinder({ run: null })
    const correlation = await binder.wrap(CONTEXT, async () => {
      reportKnowledgeVersion('kb.policy', 'v4')
      return getAmbientAuditCorrelation()
    })
    expect(correlation).toBeNull()
    expect(writes).toHaveLength(0)
  })

  it('runs the tool plainly without a session id', async () => {
    const { binder, resolveRun } = makeBinder()
    await expect(binder.wrap({ ...CONTEXT, sessionId: undefined }, async () => 'ok')).resolves.toBe('ok')
    expect(resolveRun).not.toHaveBeenCalled()
  })

  it('runs the tool plainly when the session scope does not match the run', async () => {
    const { binder } = makeBinder()
    const correlation = await binder.wrap({ ...CONTEXT, organizationId: 'org-other' }, async () =>
      getAmbientAuditCorrelation(),
    )
    expect(correlation).toBeNull()
  })

  it('keeps the tool result when the observation write fails', async () => {
    const { binder } = makeBinder({ failWrite: true })
    await expect(
      binder.wrap(CONTEXT, async () => {
        reportKnowledgeVersion('kb.policy', 'v4')
        return 'ok'
      }),
    ).resolves.toBe('ok')
  })

  it('resolves the run from the session store and appends the span under the runtime audit scope', async () => {
    const store = new InMemoryAgentRunSessionStore()
    await store.open({ sessionToken: 'sess_run_1', agentId: 'kb.agent', runId: 'run-1' })
    mockFindOneWithDecryption.mockResolvedValue({
      id: 'run-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      parentRunId: null,
      workflowInstanceId: 'wf-1',
    })
    const created: Array<Record<string, unknown>> = []
    const flushScopes: boolean[] = []
    const forkedEm = {
      count: jest.fn(async (_entity: unknown, where: Record<string, unknown>) => ('externalSpanId' in where ? 0 : 3)),
      create: jest.fn((_entity: unknown, data: Record<string, unknown>) => {
        created.push(data)
        return data
      }),
      persist: jest.fn(),
      flush: jest.fn(async () => {
        flushScopes.push(isRuntimeAuditWriteActive())
      }),
    }
    const container = {
      resolve: (name: string) => {
        if (name === 'agentRunSessionStore') return store
        if (name === 'em') return { fork: () => forkedEm }
        throw new Error(`unexpected resolve(${name})`)
      },
    }
    const binder = createMcpToolObservationBinder(container as never)

    const correlation = await binder.wrap({ ...CONTEXT, tenantId: null, organizationId: null }, async () => {
      reportKnowledgeVersion('kb.policy', 'v4')
      return getAmbientAuditCorrelation()
    })

    expect(correlation).toEqual({ agentRunId: 'run-1', workflowInstanceId: 'wf-1' })
    expect(mockFindOneWithDecryption.mock.calls[0][2]).toEqual({ id: 'run-1', deletedAt: null })
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({
      agentRunId: 'run-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      externalSpanId: 'run-1:obs:corr-1',
      sequence: 3,
      name: 'tool.observation',
      kind: 'system',
      status: 'ok',
      attributes: { 'om.tool.name': 'kb.search', 'om.knowledge': { 'kb.policy': 'v4' }, 'om.retrieval': [] },
    })
    expect(flushScopes).toEqual([true])
  })

  it('skips the append when the observation span already exists', async () => {
    const store = new InMemoryAgentRunSessionStore()
    await store.open({ sessionToken: 'sess_run_1', agentId: 'kb.agent', runId: 'run-1' })
    mockFindOneWithDecryption.mockResolvedValue({ id: 'run-1', tenantId: 'tenant-1', organizationId: 'org-1' })
    const forkedEm = { count: jest.fn(async () => 1), create: jest.fn(), persist: jest.fn(), flush: jest.fn() }
    const container = {
      resolve: (name: string) => (name === 'agentRunSessionStore' ? store : { fork: () => forkedEm }),
    }
    const binder = createMcpToolObservationBinder(container as never)

    await binder.wrap(CONTEXT, async () => reportKnowledgeVersion('kb.policy', 'v4'))

    expect(forkedEm.create).not.toHaveBeenCalled()
    expect(forkedEm.flush).not.toHaveBeenCalled()
  })
})
