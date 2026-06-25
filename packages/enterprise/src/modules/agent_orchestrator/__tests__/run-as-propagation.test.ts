import type { AwilixContainer } from 'awilix'
import { buildCommandContext } from '../lib/runtime/persistence'
import { AgentWorkflowBridgeService } from '../lib/runtime/invokeAgentForWorkflow'
import { AgentPrincipal } from '../data/entities'

const TENANT = 'tenant-1'
const ORG = 'org-1'
const HUMAN = 'human-1'
const AGENT_USER = 'agent-user-1'
const AGENT_ID = 'deals.health_check'

const fakeContainer = { resolve: () => undefined } as unknown as AwilixContainer

describe('runAs propagation (Wave 4 P2)', () => {
  describe('buildCommandContext', () => {
    it('threads runAs onto the command context as { actorUserId: agent, onBehalfOfUserId: human, source: agent }', () => {
      const ctx = buildCommandContext(fakeContainer, {
        tenantId: TENANT,
        organizationId: ORG,
        userId: HUMAN,
        runAs: { agentUserId: AGENT_USER, onBehalfOfUserId: HUMAN },
      })

      expect(ctx.runAs).toEqual({
        actorUserId: AGENT_USER,
        onBehalfOfUserId: HUMAN,
        source: 'agent',
      })
      // The invoking human still carries the JWT auth; runAs is the audit attribution.
      expect(ctx.auth?.sub).toBe(HUMAN)
    })

    it('omits runAs for legacy/playground runs (no principal) — existing attribution unchanged', () => {
      const ctx = buildCommandContext(fakeContainer, {
        tenantId: TENANT,
        organizationId: ORG,
        userId: HUMAN,
      })
      expect(ctx.runAs).toBeUndefined()
      expect(ctx.auth?.sub).toBe(HUMAN)
    })

    it('records onBehalfOfUserId=null for a system-invoked agent run (no human)', () => {
      const ctx = buildCommandContext(fakeContainer, {
        tenantId: TENANT,
        organizationId: ORG,
        userId: '',
        runAs: { agentUserId: AGENT_USER, onBehalfOfUserId: null },
      })
      expect(ctx.runAs).toEqual({ actorUserId: AGENT_USER, onBehalfOfUserId: null, source: 'agent' })
    })
  })

  describe('AgentWorkflowBridgeService resolves runAs from the agent principal', () => {
    function buildBridge(principal: AgentPrincipal | null) {
      const em = {
        fork: () => ({
          findOne: async (_entity: unknown, _where: unknown) => principal,
        }),
      }
      const container = {
        resolve: (token: string) => {
          if (token === 'em') return em
          return undefined
        },
      } as unknown as AwilixContainer

      const runCalls: Array<Record<string, unknown>> = []
      const agentRuntime = {
        run: jest.fn(async (_agentId: string, _input: unknown, ctx: Record<string, unknown>) => {
          runCalls.push(ctx)
          // Informative result short-circuits before disposition.
          return { kind: 'informative', data: { ok: true } }
        }),
      }
      const dispositionService = { dispose: jest.fn() }

      const bridge = new AgentWorkflowBridgeService({
        container,
        agentRuntime: agentRuntime as never,
        dispositionService: dispositionService as never,
      })
      return { bridge, runCalls, agentRuntime }
    }

    it('passes runAs={ agentUserId, onBehalfOfUserId: human } when an enabled principal exists', async () => {
      const principal = {
        userId: AGENT_USER,
        agentDefinitionId: AGENT_ID,
        enabled: true,
        tenantId: TENANT,
        organizationId: ORG,
      } as unknown as AgentPrincipal

      const { bridge, runCalls } = buildBridge(principal)
      await bridge.invokeAgentForWorkflow({
        agentId: AGENT_ID,
        input: {},
        onResult: { alwaysAsk: true },
        ctx: { tenantId: TENANT, organizationId: ORG, userId: HUMAN, processId: 'p1', stepId: 's1' },
      })

      expect(runCalls).toHaveLength(1)
      expect(runCalls[0].runAs).toEqual({ agentUserId: AGENT_USER, onBehalfOfUserId: HUMAN })
    })

    it('omits runAs when the agent has no provisioned principal (fail-open)', async () => {
      const { bridge, runCalls } = buildBridge(null)
      await bridge.invokeAgentForWorkflow({
        agentId: AGENT_ID,
        input: {},
        onResult: { alwaysAsk: true },
        ctx: { tenantId: TENANT, organizationId: ORG, userId: HUMAN, processId: 'p1', stepId: 's1' },
      })

      expect(runCalls).toHaveLength(1)
      expect(runCalls[0].runAs).toBeUndefined()
    })

    it('omits runAs when the principal is disabled', async () => {
      const principal = {
        userId: AGENT_USER,
        agentDefinitionId: AGENT_ID,
        enabled: false,
        tenantId: TENANT,
        organizationId: ORG,
      } as unknown as AgentPrincipal

      const { bridge, runCalls } = buildBridge(principal)
      await bridge.invokeAgentForWorkflow({
        agentId: AGENT_ID,
        input: {},
        onResult: { alwaysAsk: true },
        ctx: { tenantId: TENANT, organizationId: ORG, userId: HUMAN, processId: 'p1', stepId: 's1' },
      })

      expect(runCalls[0].runAs).toBeUndefined()
    })
  })
})
