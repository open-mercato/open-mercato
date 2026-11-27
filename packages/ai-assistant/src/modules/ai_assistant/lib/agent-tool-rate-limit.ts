import { readEndpointRateLimitConfig } from '@open-mercato/shared/lib/ratelimit/config'
import type { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'

interface RateLimiterContainer {
  resolve<T>(name: string): T
  hasRegistration?: (name: string) => boolean
}

/**
 * Per-caller ceiling for agent tools (`defineAgentTool` / `mcpTool`) called over
 * the MCP servers and `POST /api/ai_assistant/tools/execute`. Each call runs a full
 * agent loop, so it costs about as much as a chat turn; the default mirrors the
 * `RATE_LIMIT_AI_CHAT_*` ceiling and is tunable via `RATE_LIMIT_AI_AGENT_TOOL_*`.
 */
export const AI_AGENT_TOOL_RATE_LIMIT_DEFAULTS = {
  points: 30,
  duration: 60,
  keyPrefix: 'ai_agent_tool',
} as const

export type AgentToolRateLimitCaller = {
  tenantId: string | null | undefined
  userId: string | null | undefined
  apiKeyId: string | null | undefined
}

export type AgentToolRateLimitDecision =
  | { allowed: true }
  | { allowed: false; reason: 'rate_limited'; retryAfterSeconds: number }
  | { allowed: false; reason: 'unavailable' }

export function buildAgentToolRateLimitKey(caller: AgentToolRateLimitCaller): string {
  const tenant = caller.tenantId ?? 'no-tenant'
  if (caller.apiKeyId) return `${tenant}:key:${caller.apiKeyId}`
  return `${tenant}:user:${caller.userId ?? 'anonymous'}`
}

/**
 * Consumes one point for an agent-tool call. One bucket per tenant and API key
 * (per user for session-token callers), shared by every agent tool.
 *
 * - No `rateLimiterService` registered: allowed (a supported deployment shape;
 *   `RATE_LIMIT_ENABLED=false` registers a service that always allows). A container
 *   without `hasRegistration` that throws on resolve counts as "not registered".
 * - Registered but unresolvable, throwing, or unable to reach its store: refused
 *   with `unavailable` (fail closed, so a configured ceiling is never silently lost).
 */
export async function checkAgentToolRateLimit(
  container: RateLimiterContainer,
  caller: AgentToolRateLimitCaller,
): Promise<AgentToolRateLimitDecision> {
  const canCheckRegistration = typeof container.hasRegistration === 'function'
  if (canCheckRegistration && !container.hasRegistration!('rateLimiterService')) {
    return { allowed: true }
  }
  let rateLimiterService: RateLimiterService | null
  try {
    rateLimiterService = container.resolve<RateLimiterService | null>('rateLimiterService')
  } catch {
    return canCheckRegistration ? { allowed: false, reason: 'unavailable' } : { allowed: true }
  }
  if (!rateLimiterService) return { allowed: true }
  try {
    const config = readEndpointRateLimitConfig('AI_AGENT_TOOL', AI_AGENT_TOOL_RATE_LIMIT_DEFAULTS)
    const result = await rateLimiterService.consume(buildAgentToolRateLimitKey(caller), config)
    if (result.degraded) return { allowed: false, reason: 'unavailable' }
    if (!result.allowed) {
      return {
        allowed: false,
        reason: 'rate_limited',
        retryAfterSeconds: Math.max(1, Math.ceil(result.msBeforeNext / 1000)),
      }
    }
    return { allowed: true }
  } catch {
    return { allowed: false, reason: 'unavailable' }
  }
}
