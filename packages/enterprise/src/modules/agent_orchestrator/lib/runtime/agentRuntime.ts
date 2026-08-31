import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { getAgentEntry, ensureAgentsLoaded, isBusinessHarnessRuntime } from '../sdk/defineAgent'
import { type AgentResult } from '../../data/validators'
import { NativeAgentRunner } from './nativeAgentRunner'
import { BusinessHarnessAgentRunner } from './businessHarnessAgentRunner'
import { getCurrentRunId } from './runContext'
import { acquireAgentRunSlot, type AgentRunSlotRelease } from './admission'
import { withAgentActor } from '../identity/agentWriteScope'
import { registerAgentKindNoBypassSubscriber } from '../identity/agentNoBypassSubscriber'
import { AgentNotFoundError } from './errors'
import type { AgentRunCtx } from './persistence'

export type { AgentRunCtx } from './persistence'
// Error classes moved to `./errors` (native-runtime Phase 1 extraction);
// re-exported so every existing `from './agentRuntime'` import keeps working.
export {
  AgentNotFoundError,
  AgentRunTimeoutError,
  AgentOutputInvalidError,
  AgentGuardrailBlockedError,
} from './errors'
export { DEFAULT_CONTEXT_TOKEN_BUDGET } from './nativeAgentRunner'

export type AgentRuntimeDeps = {
  container: AwilixContainer
  commandBus: CommandBus
}

/**
 * Runtime dispatch service: resolves the registered agent entry, applies the
 * cross-runtime protections (admission gate, agent-actor no-bypass scope), and
 * dispatches `business-harness` agents (and their deprecated `opencode` alias)
 * to the configured stdio or HTTP transport, and native agents to the in-process
 * {@link NativeAgentRunner}.
 *
 * The call surface (`agentRuntime.run(agentId, input, ctx)`) is unchanged —
 * callers stay runtime-agnostic.
 */
export class AgentRuntimeService {
  readonly container: AwilixContainer
  private readonly commandBus: CommandBus

  constructor(deps: AgentRuntimeDeps) {
    this.container = deps.container
    this.commandBus = deps.commandBus
  }

  async run(agentId: string, input: unknown, ctx: AgentRunCtx): Promise<AgentResult> {
    await ensureAgentsLoaded()
    const entry = getAgentEntry(agentId)
    if (!entry) throw new AgentNotFoundError(agentId)

    // Runtime no-bypass enforcement (Wave 4 Phase 3, layer B-b). When the run is
    // bound to a provisioned agent principal (`ctx.runAs`), bind the async-scoped
    // agent-actor context for the WHOLE run and register the fail-closed flush-time
    // subscriber on the EM. From here on any write reaching `em.flush()` that is
    // NOT inside the agent's own audited Command write throws — making a raw
    // `em.flush()` bypass impossible at runtime. Unprincipalled (legacy/playground)
    // runs keep their prior behavior (no actor scope, guard never fires).
    const dispatch = (): Promise<AgentResult> => {
      if (isBusinessHarnessRuntime(entry.runtime)) {
        const runner = new BusinessHarnessAgentRunner({
          container: this.container,
          commandBus: this.commandBus,
        })
        return runner.run(entry, input, ctx)
      }
      if (entry.runtime === 'external') {
        throw new Error('[internal] Agent runtime "external" is not executable by AgentRuntimeService')
      }
      const runner = new NativeAgentRunner({
        container: this.container,
        commandBus: this.commandBus,
      })
      return runner.run(agentId, entry, input, ctx)
    }

    // Admission gate (performance hardening Phase 2): bounded global +
    // per-tenant semaphore, acquired BEFORE any DB write so a rejected run
    // leaves no `running` row. Top-level runs only — a nested run (a parent run
    // id on the ctx, or an active in-process run context) executes within its
    // parent's admitted budget; gating it too would livelock `delegate_agent`
    // fan-out at saturation. Covers BOTH runtimes dispatched below.
    const isNestedRun = Boolean(ctx.parentRunId ?? getCurrentRunId())
    const releaseRunSlot: AgentRunSlotRelease | null = isNestedRun
      ? null
      : await acquireAgentRunSlot(ctx.tenantId)

    try {
      if (ctx.runAs) {
        try {
          registerAgentKindNoBypassSubscriber(this.container.resolve('em') as EntityManager)
        } catch {
          // best-effort registration; the actor scope below still fails closed for
          // any EM that did get the subscriber (the shared request EM).
        }
        return await withAgentActor(
          { agentUserId: ctx.runAs.agentUserId, onBehalfOfUserId: ctx.runAs.onBehalfOfUserId ?? null },
          dispatch,
        )
      }
      return await dispatch()
    } finally {
      releaseRunSlot?.()
    }
  }
}
