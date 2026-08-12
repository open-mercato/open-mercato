import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { getAgentEntry, ensureAgentsLoaded, NATIVE_RUNTIME_VALUES } from '../sdk/defineAgent'
import { type AgentResult } from '../../data/validators'
import { OpenCodeAgentRunner } from './openCodeAgentRunner'
import { NativeAgentRunner } from './nativeAgentRunner'
import { ExternalAgentRunner, type AgentRunOutcome } from './externalAgentRunner'
import { getCurrentRunId } from './runContext'
import { acquireAgentRunSlot, type AgentRunSlotRelease } from './admission'
import { withAgentActor } from '../identity/agentWriteScope'
import { registerAgentKindNoBypassSubscriber } from '../identity/agentNoBypassSubscriber'
import { AgentNotFoundError, AgentRunSuspendedError, UnknownAgentRuntimeError } from './errors'
import type { AgentRunCtx } from './persistence'

export type { AgentRunCtx } from './persistence'
export type { AgentRunOutcome } from './externalAgentRunner'
// Error classes moved to `./errors` (native-runtime Phase 1 extraction);
// re-exported so every existing `from './agentRuntime'` import keeps working.
export {
  AgentNotFoundError,
  AgentRunTimeoutError,
  AgentOutputInvalidError,
  AgentGuardrailBlockedError,
  AgentRunSuspendedError,
  ExternalAgentConfigurationError,
  UnknownAgentRuntimeError,
} from './errors'
export { DEFAULT_CONTEXT_TOKEN_BUDGET } from './nativeAgentRunner'

export type AgentRuntimeDeps = {
  container: AwilixContainer
  commandBus: CommandBus
}

/**
 * Runtime dispatch service: resolves the registered agent entry, applies the
 * cross-runtime protections (admission gate, agent-actor no-bypass scope), and
 * dispatches on `entry.runtime` — `'opencode'` to the OpenCode runner (file
 * agents, deprecation planned), `'external'` to the {@link ExternalAgentRunner},
 * `'native'` and its accepted legacy alias `'in-process'` to the
 * {@link NativeAgentRunner} (lightweight-agent-runtime spec Phase 1), and
 * anything else to a typed refusal.
 *
 * The call surface (`agentRuntime.run(agentId, input, ctx)`) is unchanged —
 * callers stay runtime-agnostic. {@link AgentRuntimeService.runOrSuspend} is the
 * additive surface for callers that can receive a suspension.
 */
export class AgentRuntimeService {
  readonly container: AwilixContainer
  private readonly commandBus: CommandBus

  constructor(deps: AgentRuntimeDeps) {
    this.container = deps.container
    this.commandBus = deps.commandBus
  }

  /**
   * Backwards-compatible surface: every caller written before external agents
   * existed expects one settled `AgentResult`. A suspension has no result to
   * return, so it surfaces as the typed, NON-retryable {@link AgentRunSuspendedError}
   * rather than as a fabricated empty result. The external run itself is genuinely
   * still `running` and will be completed by its callback — the error says only
   * that THIS caller cannot receive the answer.
   */
  async run(agentId: string, input: unknown, ctx: AgentRunCtx): Promise<AgentResult> {
    const outcome = await this.runOrSuspend(agentId, input, ctx)
    if (outcome.kind === 'suspended') {
      throw new AgentRunSuspendedError(agentId, outcome.runId, outcome.externalRunId)
    }
    return outcome.result
  }

  /**
   * Dispatch surface for callers that CAN park — the workflow bridge, whose
   * `INVOKE_AGENT` step leaves the instance paused on the resume signal until the
   * provider answers (T2.5 maps the suspended outcome onto it).
   */
  async runOrSuspend(agentId: string, input: unknown, ctx: AgentRunCtx): Promise<AgentRunOutcome> {
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
    // An explicit runtime switch, NOT a fallthrough. Until external agents
    // existed, everything that was not `'opencode'` reached the native runner;
    // a `runtime: 'external'` entry would therefore have been handed to an LLM
    // with no system prompt, no model and no tools. An unrecognised runtime is a
    // wiring mistake and must say so.
    const runtime = entry.runtime ?? 'native'
    const dispatch = async (): Promise<AgentRunOutcome> => {
      if (runtime === 'opencode') {
        const runner = new OpenCodeAgentRunner({
          container: this.container,
          commandBus: this.commandBus,
          openCodeClient: this.container.resolve('openCodeClient'),
        })
        return { kind: 'settled', result: await runner.run(entry, input, ctx) }
      }
      if (runtime === 'external') {
        const runner = new ExternalAgentRunner({
          container: this.container,
          commandBus: this.commandBus,
        })
        return runner.run(agentId, entry, input, ctx)
      }
      // `NATIVE_RUNTIME_VALUES` rather than a literal pair: persisted entries from
      // before the `'native'` flip carry the legacy `'in-process'` alias, and the
      // two labels are ONE cohort everywhere else in the platform.
      if ((NATIVE_RUNTIME_VALUES as readonly string[]).includes(runtime)) {
        const runner = new NativeAgentRunner({
          container: this.container,
          commandBus: this.commandBus,
        })
        return { kind: 'settled', result: await runner.run(agentId, entry, input, ctx) }
      }
      throw new UnknownAgentRuntimeError(agentId, runtime)
    }

    // Admission gate (performance hardening Phase 2): bounded global +
    // per-tenant semaphore, acquired BEFORE any DB write so a rejected run
    // leaves no `running` row. Top-level runs only — a nested run (a parent run
    // id on the ctx, or an active in-process run context) executes within its
    // parent's admitted budget; gating it too would livelock `delegate_agent`
    // fan-out at saturation. Covers EVERY runtime dispatched below.
    //
    // EXTERNAL RUNS RELEASE THE SLOT WHEN `start()` RETURNS, not when the provider
    // answers — the `finally` below already does this, and it is the intended
    // behaviour, not an oversight:
    //   - What the gate protects (this process's DB pool, the LLM provider, the
    //     single OpenCode container) is consumed by the START, which is one
    //     outbound POST and two audited writes. A suspended run consumes none of
    //     it: no connection, no tokens, no container. The gate keeps bounding the
    //     resource it actually models.
    //   - The slot COULD NOT be released correctly anyway. It is a process-local
    //     in-memory semaphore, while the callback that would release it arrives at
    //     whichever web replica the provider reached — and a deploy mid-call
    //     forgets the count entirely. A "held" slot would be a fiction that
    //     survives no restart.
    //   - Holding it would re-create the exact failure this design exists to
    //     avoid. With a per-tenant cap in the low tens, a handful of parked
    //     half-hour phone calls would block ALL of that tenant's agent runs,
    //     native ones included, for the duration — which is the queue stall the
    //     design rejects when it forbids a connector from polling to completion.
    // The cost is that nothing bounds how many external runs may be in flight at
    // once; that ceiling belongs to the provider's own concurrency limits and to
    // the deadline sweep (T2.7), not to a process-local semaphore.
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
