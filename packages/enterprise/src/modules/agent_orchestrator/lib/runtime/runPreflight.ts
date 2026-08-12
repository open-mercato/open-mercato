import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { CitableSource, UntrustedSpan } from '../../data/validators'
import { GuardrailService, persistVerdict, GUARDRAIL_SET_VERSION } from '../guardrails/guardrailService'
import { ContextResolverImpl, ContextModuleNotFoundError } from '../context/contextResolver'
import { resolveContextModule } from '../context/registry'
import { AgentGuardrailBlockedError } from './errors'
import { failRun, type AgentRunCtx } from './persistence'

const logger = createLogger('agent_orchestrator').child({ component: 'run-preflight' })

/**
 * The part of a run that happens BEFORE the agent is actually executed, shared by
 * every runtime that executes one: assemble the TDCR context bundle, then screen
 * the untrusted spans it produced through the pre-call input guardrail.
 *
 * Extracted from `NativeAgentRunner` so the external runner reuses the SAME front
 * half rather than a copy of it (external-agent-invocation design §5.2). The
 * duplication would have been the dangerous kind: the external path is the one
 * that ships the assembled brief OUT to a third party, so a future tightening of
 * the input guardrail that only landed in the native copy would leave the
 * outward-facing path screening less than the in-process one.
 */

/**
 * Default token budget for a TDCR context assembly when the caller does not pass
 * one (Phase 1 — the INVOKE_AGENT node config wires a per-capability budget in a
 * later phase). Conservative; the packer prunes optional fill that exceeds it.
 */
export const DEFAULT_CONTEXT_TOKEN_BUDGET = 4000

export type RunContextSpans = {
  untrustedSpans: UntrustedSpan[]
  citableSources: CitableSource[]
}

/**
 * Context overlay (Phase 1): assemble + persist one append-only
 * AgentContextBundle for this run BEFORE the agent executes (TDCR is on the
 * synchronous INVOKE_AGENT path). Called directly from the run path — there is no
 * pluggable workflow activity registry. Capability = the agent id. Only
 * capabilities that declare a ContextModule get a bundle; the rest are a safe
 * no-op so existing toolless agents are unaffected. Best-effort: an assembly
 * failure must not abort the run (the bundle is evidence, not a gate in P1).
 */
export async function assembleRunContextSpans(args: {
  container: AwilixContainer
  agentId: string
  runId: string
  ctx: AgentRunCtx
}): Promise<RunContextSpans> {
  const { container, agentId, runId, ctx } = args
  if (!resolveContextModule(agentId)) return { untrustedSpans: [], citableSources: [] }
  try {
    const contextEm = (container.resolve('em') as EntityManager).fork()
    const resolver = new ContextResolverImpl(container)
    const assembled = await resolver.assemble(contextEm, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      agentRunId: runId,
      processId: ctx.processId ?? null,
      stepId: ctx.stepId ?? null,
      capability: agentId,
      budget: DEFAULT_CONTEXT_TOKEN_BUDGET,
    })
    return { untrustedSpans: assembled.untrustedSpans, citableSources: assembled.citableSources }
  } catch (contextErr) {
    if (!(contextErr instanceof ContextModuleNotFoundError)) {
      logger.warn('context assembly failed', {
        error: contextErr instanceof Error ? contextErr.message : String(contextErr),
      })
    }
    return { untrustedSpans: [], citableSources: [] }
  }
}

/**
 * PRE-CALL input guardrail (Wave 3, Phase 3): screen the UNTRUSTED
 * document/retrieval spans assembled above for injected-instruction patterns
 * BEFORE the agent executes. A `block` persists the prompt_injection check + emits
 * `guardrail.tripped`, then fails the run with a typed reason (never reaches
 * disposition); a `warn`/`pass` records the audit rows and proceeds. The
 * always-on output tool-scope backstop holds even if this layer is evaded.
 */
export async function screenRunInput(args: {
  container: AwilixContainer
  commandBus: CommandBus
  commandCtx: CommandRuntimeContext
  agentId: string
  runId: string
  ctx: AgentRunCtx
  untrustedSpans: UntrustedSpan[]
}): Promise<void> {
  const { container, commandBus, commandCtx, agentId, runId, ctx, untrustedSpans } = args
  const inputGuardrail = new GuardrailService(container)
  const inputVerdict = await inputGuardrail.checkInput({ capability: agentId, untrustedSpans })
  if (inputVerdict.checks.length === 0) return

  const inputGuardEm = (container.resolve('em') as EntityManager).fork()
  const inputScope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId, agentRunId: runId }
  await persistVerdict({ em: inputGuardEm }, inputScope, {
    verdict: inputVerdict,
    capability: agentId,
    phase: 'input',
    proposalId: null,
  })
  if (inputVerdict.result === 'block' && inputVerdict.blockedReason) {
    const detail = '[internal] pre-call guardrail block (prompt_injection)'
    await failRun(commandBus, commandCtx, { runId, errorMessage: detail })
    throw new AgentGuardrailBlockedError(agentId, detail, {
      phase: inputVerdict.blockedReason.phase,
      kind: inputVerdict.blockedReason.kind,
      guardrailSetVersion: GUARDRAIL_SET_VERSION,
    })
  }
}
