import {
  AiAgentDispatchDeniedError,
  type AiAgentRunDispatchCaller,
  type AiAgentRunDispatchInput,
  type AiAgentRunDispatchResult,
  type AiAgentRunDispatchVia,
  type AiAgentRunDispatcher,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-run-dispatcher'
import { ensureAgentsLoaded, getAgentEntry, type AgentRegistryEntry } from '../sdk/defineAgent'
import { isAgentInvokeDeniedError } from './errors'
import { agentResultPayload } from './agentResultPayload'
import type { AgentEntryPoint, AgentInvoker, AgentRunCtx } from './persistence'
import type { AgentRuntimeService } from './agentRuntime'

type DispatcherContainer = {
  resolve<T = unknown>(name: string): T
}

type DispatchPrincipal = {
  executionUserId: string
  invoker: AgentInvoker
}

/**
 * AO implementation of the ai-assistant `AiAgentRunDispatcher` port (identity
 * spec "ai-assistant dispatcher seam"). Every AO-owned agent reached through an
 * ai-assistant door (run-object, chat object branch, `defineAgentTool`) runs
 * through `agentRuntime.run()`, so the invoke check, principal binding,
 * guardrails and trace capture apply exactly as on the AO run route.
 *
 * Registry loading: the AO registry fills by import side effect and file agents
 * only through `ensureAgentsLoaded()`, which nothing runs at bootstrap. Building
 * the dispatcher starts that memoized load; `owns()` reads the registry
 * synchronously (the port contract), and `isAvailable()` / `runObject()` await
 * the load first. A cold process whose load has not finished yet can therefore
 * answer `owns() === false` for a file agent on its very first request — the
 * native agents are already registered by then, because the ai-assistant agent
 * registry imports every module's `ai-agents.ts` before any door resolves one.
 *
 * Abort: the AO runtime takes no abort signal (its own deadline is
 * `runTimeoutMs`), so `signal` is raced: an aborted dispatch rejects at once
 * while the underlying run winds down under its wall-clock deadline.
 */
export function createAiAgentRunDispatcher(container: DispatcherContainer): AiAgentRunDispatcher {
  void ensureAgentsLoaded().catch(() => undefined)

  return {
    owns(agentId: string): boolean {
      return getAgentEntry(agentId) !== undefined
    },

    async isAvailable(agentId: string): Promise<boolean> {
      await ensureAgentsLoaded()
      const entry = getAgentEntry(agentId)
      if (!entry) return false
      return !(await isDisabledByOverride(entry))
    },

    async runObject(dispatch: AiAgentRunDispatchInput): Promise<AiAgentRunDispatchResult> {
      const principal = resolveDispatchPrincipal(dispatch.agentId, dispatch.caller)
      throwIfAborted(dispatch.signal)
      let agentRunId: string | null = null
      const ctx: AgentRunCtx = {
        tenantId: dispatch.caller.tenantId,
        organizationId: dispatch.caller.organizationId,
        userId: principal.executionUserId,
        invoker: principal.invoker,
        entryPoint: entryPointForVia(dispatch.via),
        channel: dispatch.channel,
        correlationId: dispatch.correlationId,
        runTimeoutMs: dispatch.timeoutMs,
        ...(dispatch.callSettings ? { callSettings: dispatch.callSettings } : {}),
        onRunPersisted: (persistedRunId) => {
          if (!agentRunId) agentRunId = persistedRunId
        },
      }
      const agentRuntime = container.resolve<AgentRuntimeService>('agentRuntime')
      try {
        const result = await raceWithAbort(
          agentRuntime.run(dispatch.agentId, dispatch.input, ctx),
          dispatch.signal,
        )
        return { result: agentResultPayload(result), agentRunId, finishReason: null }
      } catch (error) {
        if (isAgentInvokeDeniedError(error)) {
          throw new AiAgentDispatchDeniedError('agent_invoke_denied', dispatch.agentId)
        }
        throw error
      }
    },
  }
}

function entryPointForVia(via: AiAgentRunDispatchVia): AgentEntryPoint {
  return via === 'tool' ? 'tool' : 'ai_assistant'
}

function resolveDispatchPrincipal(agentId: string, caller: AiAgentRunDispatchCaller): DispatchPrincipal {
  if (caller.apiKeyId) {
    return {
      executionUserId: `api_key:${caller.apiKeyId}`,
      invoker: { kind: 'api_key', apiKeyId: caller.apiKeyId, ownerUserId: caller.userId ?? null },
    }
  }
  if (caller.userId) {
    return { executionUserId: caller.userId, invoker: { kind: 'user', userId: caller.userId } }
  }
  throw new AiAgentDispatchDeniedError('agent_principal_missing', agentId)
}

async function isDisabledByOverride(entry: AgentRegistryEntry): Promise<boolean> {
  if (entry.runtime === 'opencode') return false
  try {
    const { getAgent, listAgents } = await import(
      '@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-registry'
    )
    if (listAgents().length === 0) return false
    return getAgent(entry.id) === undefined
  } catch {
    return false
  }
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error('[internal] Agent dispatch aborted')
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortReason(signal)
}

function raceWithAbort<T>(run: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return run
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      run.catch(() => undefined)
      reject(abortReason(signal))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    run.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}
