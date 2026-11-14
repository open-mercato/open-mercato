import type { AgentPolicyDenyCode } from './agent-policy'
import type { AiAgentDispatchDeniedCode } from './agent-run-dispatcher'

export type AgentToolErrorCode = 'AGENT_DISPATCHER_UNAVAILABLE' | 'AGENT_POLICY_DENIED'

export type AgentToolDenyCode = AgentPolicyDenyCode | AiAgentDispatchDeniedCode

export class AgentToolError extends Error {
  readonly code: AgentToolErrorCode
  readonly agentId: string
  readonly denyCode: AgentToolDenyCode | null

  constructor(code: AgentToolErrorCode, agentId: string, denyCode: AgentToolDenyCode | null = null) {
    super(
      code === 'AGENT_POLICY_DENIED'
        ? `[internal] Agent "${agentId}" denied this call (${denyCode ?? 'agent_policy_denied'})`
        : `[internal] Agent "${agentId}" is not available on this deployment`,
    )
    this.name = 'AgentToolError'
    this.code = code
    this.agentId = agentId
    this.denyCode = denyCode
  }
}

export function isAgentToolError(error: unknown): error is AgentToolError {
  return error instanceof AgentToolError
}
