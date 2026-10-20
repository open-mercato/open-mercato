jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: () => null,
  })),
}))

jest.mock('../tool-loader', () => ({
  ensureModuleToolsLoaded: jest.fn(async () => undefined),
}))

import { z } from 'zod'
import type { AwilixContainer } from 'awilix'
import {
  getAmbientCausation,
  runEntryWithCausation,
  type CausationEnvelope,
} from '@open-mercato/shared/lib/causation/server'
import type { ApiRouteManifestEntry } from '@open-mercato/shared/modules/registry'
import { buildAiToolCausationFrame, executeTool } from '../tool-executor'
import {
  buildPendingActionCausationFrame,
  executePendingActionConfirm,
} from '../pending-action-executor'
import { createAiApiOperationRunner } from '../ai-api-operation-runner'
import { resolveAiAgentTools } from '../agent-tools'
import { resetAgentRegistryForTests, seedAgentRegistryForTests } from '../agent-registry'
import { registerMcpTool, toolRegistry } from '../tool-registry'
import type { AiAgentDefinition } from '../ai-agent-definition'
import type { AiToolDefinition, McpToolContext } from '../types'
import type { AiPendingAction } from '../../data/entities'

const TOOL_NAME = 'customers.causation_probe'
const AGENT_ID = 'customers.account_assistant'
const PENDING_ACTION_ID = '5b0f4a6e-8c1d-4f2a-9b3e-7d6c5a4b3f21'

function makeTool(overrides: Partial<AiToolDefinition> = {}): AiToolDefinition {
  return {
    name: TOOL_NAME,
    description: 'Causation probe tool',
    inputSchema: z.object({}).passthrough(),
    handler: async () => ({ ok: true }),
    ...overrides,
  } as AiToolDefinition
}

function makeToolContext(): McpToolContext {
  return {
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    userId: 'user-1',
    container: { resolve: () => null } as unknown as AwilixContainer,
    userFeatures: ['*'],
    isSuperAdmin: true,
  }
}

function makeAgent(): AiAgentDefinition {
  return {
    id: AGENT_ID,
    moduleId: 'customers',
    label: 'Account assistant',
    description: 'Test agent',
    systemPrompt: 'You are a test agent.',
    allowedTools: [TOOL_NAME],
    readOnly: false,
    mutationPolicy: 'confirm-required',
  }
}

function makeAction(): AiPendingAction {
  return {
    id: PENDING_ACTION_ID,
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    agentId: AGENT_ID,
    toolName: TOOL_NAME,
    status: 'pending',
    fieldDiff: [],
    records: null,
    failedRecords: null,
    sideEffectsSummary: null,
    recordVersion: null,
    attachmentIds: [],
    normalizedInput: { secret: 'payload-value' },
    queueMode: 'inline',
    executionResult: null,
    targetEntityType: null,
    targetRecordId: null,
    conversationId: null,
    idempotencyKey: 'idem-1',
    createdByUserId: 'user-1',
    createdAt: new Date('2026-10-08T10:00:00.000Z'),
    expiresAt: new Date('2026-10-08T11:00:00.000Z'),
    resolvedAt: null,
    resolvedByUserId: null,
  } as unknown as AiPendingAction
}

function makeRepoStub(initialRow: AiPendingAction) {
  let row = { ...initialRow } as AiPendingAction
  return {
    setStatus: jest.fn(async (_id: string, nextStatus: string, _scope: unknown, extra?: Record<string, unknown>) => {
      row = {
        ...row,
        status: nextStatus,
        ...(extra && 'executionResult' in extra ? { executionResult: extra.executionResult ?? null } : {}),
        resolvedAt: nextStatus === 'executing' ? null : new Date('2026-10-08T10:30:00.000Z'),
      } as AiPendingAction
      return row
    }),
  }
}

function makeExecuteContext() {
  return {
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    userId: 'user-1',
    userFeatures: ['*'],
    isSuperAdmin: false,
    container: { resolve: () => ({}) } as unknown as AwilixContainer,
  }
}

async function confirmWithHandler(handler: AiToolDefinition['handler']) {
  const action = makeAction()
  return executePendingActionConfirm({
    action,
    agent: makeAgent(),
    tool: makeTool({ handler, isMutation: true }),
    ctx: makeExecuteContext(),
    repo: makeRepoStub(action) as never,
    emitEvent: jest.fn().mockResolvedValue(undefined),
  })
}

function innermostFrame(envelope: CausationEnvelope | null) {
  return envelope?.frames[envelope.frames.length - 1] ?? null
}

describe('AI causation frames', () => {
  const originalCausationFlag = process.env.OM_CAUSATION

  beforeEach(() => {
    toolRegistry.clear()
    resetAgentRegistryForTests()
  })

  afterEach(() => {
    if (originalCausationFlag === undefined) delete process.env.OM_CAUSATION
    else process.env.OM_CAUSATION = originalCausationFlag
  })

  afterAll(() => {
    toolRegistry.clear()
    resetAgentRegistryForTests()
  })

  describe('with causation disabled', () => {
    it('runs a tool handler without installing an envelope', async () => {
      process.env.OM_CAUSATION = 'off'
      const observed: Array<CausationEnvelope | null> = []
      registerMcpTool(
        makeTool({
          handler: async () => {
            observed.push(getAmbientCausation())
            return { ok: true }
          },
        }),
        { moduleId: 'customers' },
      )

      const result = await executeTool(TOOL_NAME, {}, makeToolContext(), { agentId: AGENT_ID })

      expect(result).toEqual({ success: true, result: { ok: true } })
      expect(observed).toEqual([null])
    })

    it('confirms a pending action without installing an envelope', async () => {
      process.env.OM_CAUSATION = 'off'
      const observed: Array<CausationEnvelope | null> = []

      const result = await confirmWithHandler(async () => {
        observed.push(getAmbientCausation())
        return { recordId: 'rec-1' }
      })

      expect(result.ok).toBe(true)
      expect(observed).toEqual([null])
    })
  })

  describe('buildAiToolCausationFrame', () => {
    it('carries the agent id as meta only when one is known', () => {
      expect(buildAiToolCausationFrame(TOOL_NAME, AGENT_ID)).toEqual({
        kind: 'ai_tool',
        id: TOOL_NAME,
        meta: { agentId: AGENT_ID },
      })
      expect(buildAiToolCausationFrame(TOOL_NAME)).toEqual({ kind: 'ai_tool', id: TOOL_NAME })
      expect(buildAiToolCausationFrame(TOOL_NAME, '   ')).toEqual({ kind: 'ai_tool', id: TOOL_NAME })
      expect(buildAiToolCausationFrame(TOOL_NAME, null)).toEqual({ kind: 'ai_tool', id: TOOL_NAME })
    })
  })

  describe('executeTool', () => {
    it('runs the tool handler inside an ai_tool frame named after the tool', async () => {
      let observed: CausationEnvelope | null = null
      registerMcpTool(
        makeTool({
          handler: async () => {
            observed = getAmbientCausation()
            return { ok: true }
          },
        }),
        { moduleId: 'customers' },
      )

      const result = await executeTool(TOOL_NAME, {}, makeToolContext(), { agentId: AGENT_ID })

      expect(result).toEqual({ success: true, result: { ok: true } })
      expect(observed).not.toBeNull()
      expect(observed!.frames).toEqual([{ kind: 'ai_tool', id: TOOL_NAME, meta: { agentId: AGENT_ID } }])
      expect(getAmbientCausation()).toBeNull()
    })

    it('omits agent meta when the caller has no agent (MCP / Code Mode paths)', async () => {
      let observed: CausationEnvelope | null = null
      registerMcpTool(
        makeTool({
          handler: async () => {
            observed = getAmbientCausation()
            return { ok: true }
          },
        }),
        { moduleId: 'customers' },
      )

      await executeTool(TOOL_NAME, {}, makeToolContext())

      expect(observed!.frames).toEqual([{ kind: 'ai_tool', id: TOOL_NAME }])
    })

    it('stacks the ai_tool frame on top of the caller entry frame and keeps its correlation', async () => {
      let observed: CausationEnvelope | null = null
      registerMcpTool(
        makeTool({
          handler: async () => {
            observed = getAmbientCausation()
            return { ok: true }
          },
        }),
        { moduleId: 'customers' },
      )

      const entry = await runEntryWithCausation({ kind: 'user' }, async () => {
        await executeTool(TOOL_NAME, {}, makeToolContext(), { agentId: AGENT_ID })
        return getAmbientCausation()
      })

      expect(observed!.frames).toEqual([
        { kind: 'user' },
        { kind: 'ai_tool', id: TOOL_NAME, meta: { agentId: AGENT_ID } },
      ])
      expect(observed!.correlationId).toBe(entry!.correlationId)
      expect(entry!.frames).toEqual([{ kind: 'user' }])
    })

    it('reports handler errors exactly as before and does not leak the frame', async () => {
      registerMcpTool(
        makeTool({
          handler: async () => {
            throw new Error('handler exploded')
          },
        }),
        { moduleId: 'customers' },
      )

      const result = await executeTool(TOOL_NAME, {}, makeToolContext(), { agentId: AGENT_ID })

      expect(result).toEqual({ success: false, error: 'handler exploded', errorCode: 'EXECUTION_ERROR' })
      expect(getAmbientCausation()).toBeNull()
    })

    it('reports synchronous handler throws exactly as before', async () => {
      registerMcpTool(
        makeTool({
          handler: (() => {
            throw new Error('sync explosion')
          }) as unknown as AiToolDefinition['handler'],
        }),
        { moduleId: 'customers' },
      )

      const result = await executeTool(TOOL_NAME, {}, makeToolContext())

      expect(result).toEqual({ success: false, error: 'sync explosion', errorCode: 'EXECUTION_ERROR' })
    })

    it('keeps the ai_tool frame inside route handlers called by the in-process API runner', async () => {
      let observedInRoute: CausationEnvelope | null = null
      const routeHandler = jest.fn(async () => {
        observedInRoute = getAmbientCausation()
        return new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      })
      const apiRoutes: ApiRouteManifestEntry[] = [
        {
          moduleId: 'customers',
          kind: 'route-file',
          path: '/customers/people',
          methods: ['GET'],
          load: async () => ({
            GET: routeHandler,
            openApi: { tag: 'Customers', methods: { GET: {} } },
            metadata: { GET: { requireAuth: true, requireFeatures: ['customers.people.view'] } },
          }),
        },
      ]
      registerMcpTool(
        makeTool({
          requiredFeatures: ['customers.people.view'],
          handler: async (_input, ctx) => {
            const runner = createAiApiOperationRunner({ ...ctx, tool: ctx.tool! }, { apiRoutes })
            return runner.run({ method: 'GET', path: '/customers/people' })
          },
        }),
        { moduleId: 'customers' },
      )
      const result = await runEntryWithCausation({ kind: 'user' }, () =>
        executeTool(TOOL_NAME, {}, makeToolContext(), { agentId: AGENT_ID }),
      )

      expect(result.success).toBe(true)
      expect(routeHandler).toHaveBeenCalledTimes(1)
      expect(observedInRoute!.frames).toEqual([
        { kind: 'user' },
        { kind: 'ai_tool', id: TOOL_NAME, meta: { agentId: AGENT_ID } },
      ])
    })
  })

  describe('agent tool dispatch', () => {
    it('passes the agent id into the ai_tool frame for agent-run tools', async () => {
      let observed: CausationEnvelope | null = null
      registerMcpTool(
        makeTool({
          handler: async () => {
            observed = getAmbientCausation()
            return { ok: true }
          },
        }),
        { moduleId: 'customers' },
      )
      seedAgentRegistryForTests([{ ...makeAgent(), readOnly: true, mutationPolicy: 'read-only' }])

      const resolved = await resolveAiAgentTools({
        agentId: AGENT_ID,
        authContext: {
          tenantId: 'tenant-1',
          organizationId: 'org-1',
          userId: 'user-1',
          features: ['*'],
          isSuperAdmin: true,
        },
      })
      const adapted = resolved.tools['customers__causation_probe'] as unknown as {
        execute: (args: unknown) => Promise<unknown>
      }
      await adapted.execute({})

      expect(innermostFrame(observed)).toEqual({ kind: 'ai_tool', id: TOOL_NAME, meta: { agentId: AGENT_ID } })
    })
  })

  describe('executePendingActionConfirm', () => {
    it('builds an ai_action frame from identifiers only', () => {
      expect(buildPendingActionCausationFrame(PENDING_ACTION_ID, AGENT_ID, TOOL_NAME)).toEqual({
        kind: 'ai_action',
        id: PENDING_ACTION_ID,
        meta: { agentId: AGENT_ID, toolName: TOOL_NAME },
      })
    })

    it('runs the confirmed handler inside an ai_action frame keyed by the pending action id', async () => {
      let observed: CausationEnvelope | null = null
      const result = await confirmWithHandler(async () => {
        observed = getAmbientCausation()
        return { recordId: 'rec-1' }
      })

      expect(result.ok).toBe(true)
      expect(observed!.frames).toEqual([
        { kind: 'ai_action', id: PENDING_ACTION_ID, meta: { agentId: AGENT_ID, toolName: TOOL_NAME } },
      ])
      expect(JSON.stringify(observed)).not.toContain('payload-value')
      expect(getAmbientCausation()).toBeNull()
    })

    it('stacks the ai_action frame on top of the confirming request entry frame', async () => {
      let observed: CausationEnvelope | null = null
      const entry = await runEntryWithCausation({ kind: 'user' }, async () => {
        await confirmWithHandler(async () => {
          observed = getAmbientCausation()
          return { recordId: 'rec-1' }
        })
        return getAmbientCausation()
      })

      expect(observed!.frames).toEqual([
        { kind: 'user' },
        { kind: 'ai_action', id: PENDING_ACTION_ID, meta: { agentId: AGENT_ID, toolName: TOOL_NAME } },
      ])
      expect(observed!.correlationId).toBe(entry!.correlationId)
      expect(entry!.frames).toEqual([{ kind: 'user' }])
    })

    it('surfaces the original handler error unchanged', async () => {
      const failure = new Error('confirm handler failed')
      const result = await confirmWithHandler(async () => {
        throw failure
      })

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.cause).toBe(failure)
      expect(result.executionResult.error).toMatchObject({ code: 'handler_error', message: 'confirm handler failed' })
      expect(getAmbientCausation()).toBeNull()
    })
  })
})
