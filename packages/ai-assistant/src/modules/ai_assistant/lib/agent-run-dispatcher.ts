import type { AiAgentCallSettings, AiAgentRunChannel } from './agent-call-contract'

export const AI_AGENT_RUN_DISPATCHER_DI_KEY = 'aiAgentRunDispatcher'

export type AiAgentRunDispatchVia = 'route' | 'tool'

export type AiAgentRunDispatchCaller = {
  tenantId: string
  organizationId: string
  userId: string | null
  apiKeyId: string | null
  features: string[]
  isSuperAdmin: boolean
}

export type AiAgentRunDispatchInput = {
  agentId: string
  input: unknown
  caller: AiAgentRunDispatchCaller
  channel: AiAgentRunChannel
  via: AiAgentRunDispatchVia
  correlationId: string
  callSettings?: AiAgentCallSettings
  timeoutMs: number
  signal?: AbortSignal
}

export type AiAgentRunDispatchUsage = {
  inputTokens?: number
  outputTokens?: number
}

export type AiAgentRunDispatchResult = {
  result: unknown
  agentRunId: string | null
  usage?: AiAgentRunDispatchUsage
  finishReason?: string | null
}

export interface AiAgentRunDispatcher {
  owns(agentId: string): boolean
  isAvailable(agentId: string): Promise<boolean>
  runObject(input: AiAgentRunDispatchInput): Promise<AiAgentRunDispatchResult>
}

export type AiAgentDispatchDeniedCode = 'agent_invoke_denied' | 'agent_principal_missing'

export class AiAgentDispatchDeniedError extends Error {
  readonly code: AiAgentDispatchDeniedCode
  readonly agentId: string

  constructor(code: AiAgentDispatchDeniedCode, agentId: string, message?: string) {
    super(message ?? `[internal] Agent dispatch denied (${code}) for agent ${agentId}`)
    this.name = 'AiAgentDispatchDeniedError'
    this.code = code
    this.agentId = agentId
  }
}

export function isAiAgentDispatchDeniedError(error: unknown): error is AiAgentDispatchDeniedError {
  return error instanceof AiAgentDispatchDeniedError
}

type DispatcherResolver = {
  resolve<T>(name: string): T
}

function isAiAgentRunDispatcher(value: unknown): value is AiAgentRunDispatcher {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<Record<keyof AiAgentRunDispatcher, unknown>>
  return (
    typeof candidate.owns === 'function' &&
    typeof candidate.isAvailable === 'function' &&
    typeof candidate.runObject === 'function'
  )
}

export function resolveAiAgentRunDispatcher(
  container: DispatcherResolver | null | undefined,
): AiAgentRunDispatcher | null {
  if (!container) return null
  try {
    const dispatcher = container.resolve<unknown>(AI_AGENT_RUN_DISPATCHER_DI_KEY)
    return isAiAgentRunDispatcher(dispatcher) ? dispatcher : null
  } catch {
    return null
  }
}
