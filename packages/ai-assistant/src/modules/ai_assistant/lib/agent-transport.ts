import { DefaultChatTransport, type ChatTransport, type UIMessage } from 'ai'

/**
 * Default dispatcher URL. Mirrors the module-id-prefixed layout emitted by the
 * app router — the spec shorthand `/api/ai/chat` appears in the source spec
 * but the generator maps it to `/api/ai_assistant/ai/chat`. Downstream
 * consumers should import this helper rather than hardcoding the literal.
 */
const DEFAULT_ENDPOINT = '/api/ai_assistant/ai/chat'

export interface CreateAiAgentTransportInput {
  agentId: string
  endpoint?: string
  body?: Record<string, unknown>
  debug?: boolean
}

function buildEndpointWithAgentQuery(endpoint: string, agentId: string): string {
  if (!agentId) return endpoint
  const separator = endpoint.includes('?') ? '&' : '?'
  return `${endpoint}${separator}agent=${encodeURIComponent(agentId)}`
}

/**
 * Thin wrapper around `DefaultChatTransport` that binds the agent id as a
 * query parameter and merges any agent-specific body fields into every
 * outbound request. Returned value conforms to the AI SDK's `ChatTransport`
 * contract so consumers can plug it directly into `useChat({ transport })`.
 *
 * TODO: when the AI SDK standardizes agent-binding as a first-class input,
 * this helper can collapse into a one-liner. Until then it owns the
 * endpoint-URL convention so UI callers do not hardcode dispatcher paths.
 */
export function createAiAgentTransport<UI_MESSAGE extends UIMessage = UIMessage>(
  input: CreateAiAgentTransportInput,
): ChatTransport<UI_MESSAGE> {
  const endpoint = buildEndpointWithAgentQuery(
    input.endpoint && input.endpoint.length > 0 ? input.endpoint : DEFAULT_ENDPOINT,
    input.agentId,
  )

  const extraBody: Record<string, unknown> = { ...(input.body ?? {}) }
  if (typeof input.debug === 'boolean') {
    extraBody.debug = input.debug
  }

  return new DefaultChatTransport<UI_MESSAGE>({
    api: endpoint,
    body: extraBody,
  })
}
