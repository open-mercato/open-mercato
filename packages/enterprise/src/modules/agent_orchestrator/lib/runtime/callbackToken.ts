import { createHash } from 'node:crypto'

/**
 * The two pure facts about an external run's callback credential: where the
 * provider posts its answer, and what we store in place of the token.
 *
 * Deliberately a LEAF module — nothing but `node:crypto` — because the
 * unauthenticated callback route (T2.6) needs `hashCallbackToken` and nothing
 * else from the start half. Importing it from `./externalAgentRunner` would pull
 * the entire outbound path (context assembly, the TDCR bundle resolver, the
 * input guardrail, the connector registry) into the module graph of the one
 * publicly reachable route in this module, and the less code that loads on a
 * route anyone on the internet can reach, the smaller the surface. Both symbols
 * are re-exported from `./externalAgentRunner`, so T2.3's import paths still
 * resolve — the same split, and the same re-export-for-compatibility move, that
 * `EXTERNAL_RUN_RESUME_SIGNAL` made when it moved out of the runner.
 */

/**
 * Path of the unauthenticated callback route. Declared next to the hash rather
 * than in the route file because the RUNNER is what hands this URL to the
 * provider: the path we published and the path we serve must be the same string,
 * and a drift between them is only discovered when a real call comes back to a
 * 404 half an hour later.
 */
export function buildExternalRunCallbackPath(callbackToken: string): string {
  return `/api/agent_orchestrator/external-runs/${encodeURIComponent(callbackToken)}/callback`
}

/**
 * Lowercase SHA-256 hex — the only shape `agentExternalRunSchema` accepts, and
 * the only form of the token that is ever persisted, cached or logged. The
 * plaintext exists in exactly two places: the outbound `start()` call, and the
 * inbound request path the provider posts to.
 */
export function hashCallbackToken(callbackToken: string): string {
  return createHash('sha256').update(callbackToken).digest('hex')
}
