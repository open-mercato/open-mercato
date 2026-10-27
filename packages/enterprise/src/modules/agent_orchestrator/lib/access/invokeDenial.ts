import { z } from 'zod'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import type { AgentInvoker } from '../runtime/persistence'
import { AGENT_INVOKE_DENIED_CODE } from '../runtime/errors'

/**
 * The invoker of an HTTP-originated run is the authenticated caller: an API key
 * keeps its own id (its ACL is the key's roles) plus the owning user when the
 * key has one; a session is the user.
 */
export function invokerFromAuth(auth: Exclude<AuthContext, null>): AgentInvoker {
  if (auth.isApiKey === true && typeof auth.keyId === 'string' && auth.keyId.length > 0) {
    return {
      kind: 'api_key',
      apiKeyId: auth.keyId,
      ownerUserId: typeof auth.userId === 'string' && auth.userId.length > 0 ? auth.userId : null,
    }
  }
  return { kind: 'user', userId: auth.sub }
}

export const invokeDeniedErrorSchema = z.object({
  error: z.string(),
  code: z.literal(AGENT_INVOKE_DENIED_CODE),
  agentId: z.string(),
})

export type InvokeDeniedErrorBody = z.infer<typeof invokeDeniedErrorSchema>

/**
 * The 403 body for an invoke denial. The English `error` is an API contract
 * string (clients render the locale entry keyed by `code`) and never names the
 * agent's required features.
 */
export function invokeDeniedBody(err: { agentId?: string }, fallbackAgentId = ''): InvokeDeniedErrorBody {
  return {
    error: 'You are not allowed to run this agent',
    code: AGENT_INVOKE_DENIED_CODE,
    agentId: err.agentId ?? fallbackAgentId,
  }
}
