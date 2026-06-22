import type { AwilixContainer } from 'awilix'
import { runAiAgentObject } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-runtime'
import type { AiChatRequestContext } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/attachment-bridge-types'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { getAgentEntry, ensureAgentsLoaded } from '../sdk/defineAgent'
import { type AgentResult, type AgentProposalPayload } from '../../data/validators'

export type AgentRunCtx = {
  tenantId: string
  organizationId: string
  userId: string
  /** Set for workflow-originated runs (area 02) → stamped onto the AgentProposal; null for the playground. */
  processId?: string
  stepId?: string
}

export class AgentNotFoundError extends Error {
  readonly code = 'agent_not_found'
  constructor(agentId: string) {
    super(`[internal] unknown agent id "${agentId}"`)
    this.name = 'AgentNotFoundError'
  }
}

export class AgentOutputInvalidError extends Error {
  readonly code = 'agent_output_invalid'
  constructor(agentId: string, detail: string) {
    super(`[internal] agent "${agentId}" produced output failing its result schema: ${detail}`)
    this.name = 'AgentOutputInvalidError'
  }
}

export type AgentRuntimeDeps = {
  container: AwilixContainer
  commandBus: CommandBus
}

/**
 * In-process runtime that runs an agent in object mode under the caller scope,
 * validates the structured output against the agent's result schema, persists a
 * thin AgentRun (and, for actionable results, an AgentProposal) through the
 * audited Command path, and returns the typed AgentResult union.
 *
 * Propose-only is structural: the agent is declared read-only, so the AI runtime
 * strips every mutation tool — an agent may only READ (via its allowlisted tools,
 * when it declares any) and PROPOSE. The runtime's only writes are AgentRun /
 * AgentProposal via Commands; domain writes happen later through the
 * proposal → disposition → effector path, never the agent itself.
 */
export class AgentRuntimeService {
  readonly container: AwilixContainer
  private readonly commandBus: CommandBus

  constructor(deps: AgentRuntimeDeps) {
    this.container = deps.container
    this.commandBus = deps.commandBus
  }

  private async resolveCallerAcl(ctx: AgentRunCtx): Promise<{ features: string[]; isSuperAdmin: boolean }> {
    try {
      const rbac = this.container.resolve('rbacService') as {
        loadAcl: (
          userId: string,
          scope: { tenantId: string | null; organizationId: string | null },
        ) => Promise<{ isSuperAdmin: boolean; features: string[] }>
      }
      const loaded = await rbac.loadAcl(ctx.userId, {
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
      })
      return { features: loaded.features ?? [], isSuperAdmin: !!loaded.isSuperAdmin }
    } catch {
      return { features: [], isSuperAdmin: false }
    }
  }

  private buildCommandContext(ctx: AgentRunCtx): CommandRuntimeContext {
    return {
      container: this.container,
      auth: {
        sub: ctx.userId,
        tenantId: ctx.tenantId,
        orgId: ctx.organizationId,
      } as CommandRuntimeContext['auth'],
      organizationScope: null,
      selectedOrganizationId: ctx.organizationId,
      organizationIds: [ctx.organizationId],
    }
  }

  async run(agentId: string, input: unknown, ctx: AgentRunCtx): Promise<AgentResult> {
    await ensureAgentsLoaded()
    const entry = getAgentEntry(agentId)
    if (!entry) throw new AgentNotFoundError(agentId)

    const commandCtx = this.buildCommandContext(ctx)

    const { result: created } = await this.commandBus.execute<
      { tenantId: string; organizationId: string; agentId: string; input: unknown },
      { runId: string }
    >('agent_orchestrator.runs.create', {
      input: { tenantId: ctx.tenantId, organizationId: ctx.organizationId, agentId, input },
      ctx: commandCtx,
    })
    const runId = created.runId

    // Load the caller's effective ACL so the agent's read-only tools (e.g.
    // customers.get_deal, gated by customers.deals.view) pass their feature
    // check under the caller's own scope — never escalated. Defensive: if the
    // RBAC service is unavailable, fall back to no features (tool calls then
    // fail closed rather than running unauthorized).
    const acl = await this.resolveCallerAcl(ctx)
    const authContext: AiChatRequestContext = {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      features: acl.features,
      isSuperAdmin: acl.isSuperAdmin,
    }

    let rawObject: unknown
    try {
      const objectResult = await runAiAgentObject({
        agentId,
        input: typeof input === 'string' ? input : JSON.stringify(input),
        authContext,
        container: this.container,
        output: { schemaName: agentId.replace(/\W+/g, '_'), schema: entry.schema },
        // Propose-only agents stay read-only: run a read-only tool loop so the
        // agent can gather data (via its own tools or skill-contributed tools)
        // before proposing. The runtime auto-falls back to a plain structured
        // generate when no tools resolve, so toolless agents are unaffected.
        // Writes never execute directly (read-only policy + proposal → effector).
        enableTools: true,
      })
      // Object mode defaults to `mode: 'generate'`, resolving `.object` directly.
      rawObject = objectResult.mode === 'stream' ? await objectResult.object : objectResult.object
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await this.failRun(runId, message, commandCtx)
      throw err
    }

    const parsed = entry.schema.safeParse(rawObject)
    if (!parsed.success) {
      const detail = parsed.error.message
      await this.failRun(runId, detail, commandCtx)
      throw new AgentOutputInvalidError(agentId, detail)
    }

    const result = this.shapeResult(entry.resultKind, parsed.data)

    await this.commandBus.execute<
      { runId: string; status: 'ok'; output: AgentResult; resultKind: 'informative' | 'actionable' },
      { runId: string }
    >('agent_orchestrator.runs.complete', {
      input: { runId, status: 'ok', output: result, resultKind: entry.resultKind },
      ctx: commandCtx,
    })

    if (result.kind === 'actionable') {
      await this.commandBus.execute(
        'agent_orchestrator.proposals.create',
        {
          input: {
            tenantId: ctx.tenantId,
            organizationId: ctx.organizationId,
            agentId,
            runId,
            payload: result.proposal,
            confidence: result.proposal.confidence ?? null,
            processId: ctx.processId ?? null,
            stepId: ctx.stepId ?? null,
          },
          ctx: commandCtx,
        },
      )
    }

    return result
  }

  /**
   * The agent `result.schema` already produces the AgentResult shape (an object
   * with `kind` plus `data` or `proposal`). We re-key by the declared
   * `resultKind` so the persisted output/proposal is always well-formed even if
   * a schema omits the literal `kind` discriminator.
   */
  private shapeResult(resultKind: 'informative' | 'actionable', data: unknown): AgentResult {
    const record = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
    if (resultKind === 'informative') {
      return { kind: 'informative', data: 'data' in record ? record.data : data }
    }
    const proposal = (record.proposal ?? data) as AgentProposalPayload
    return { kind: 'actionable', proposal }
  }

  private async failRun(runId: string, errorMessage: string, ctx: CommandRuntimeContext): Promise<void> {
    await this.commandBus.execute<{ runId: string; errorMessage: string }, { runId: string }>(
      'agent_orchestrator.runs.fail',
      { input: { runId, errorMessage }, ctx },
    )
  }
}
