/**
 * Workflows Module - server-side output-contract resolver.
 *
 * NOT pure: this is the concrete implementation server callers (the
 * context-schema API route) inject into `computeContextLedger`'s
 * `resolveOutputContract` seam. It is only meaningful in the server runtime,
 * where the activity registry is bootstrapped (guaranteed by the bootstrap
 * import below) and the command registry holds the loaded command handlers —
 * `commandRegistry.outputSchemaOf` is sync over already-registered handlers,
 * so UPDATE_ENTITY's outputContract resolves a real Zod schema there and
 * degrades honestly to 'unknown' elsewhere. The browser-side ledger never
 * resolves contracts locally; it consumes the resolved entries from the
 * context-schema API response.
 *
 * A registry entry's `outputContract` yields `ZodTypeAny | 'unknown'`
 * (activity-registry.ts); the instanceof guard also keeps third-party entries
 * honest at runtime before flattening.
 */

import { ZodType } from 'zod'
import './activity-registry-bootstrap'
import { getActivityType } from './activity-registry'
import { bindCallApiResponseSchemaResolver } from './activity-types'
import { findEndpointResponseSchema } from './endpoint-catalog'
import { flattenSchemaToContract } from './ledger-schema-flatten'
import type { ResolveOutputContract } from './context-ledger'

/**
 * CALL_API's registry outputContract reaches the server-only endpoint
 * catalog through this binding (mirroring bindActivityExecutor). The sync
 * lookup reads the per-process catalog cache, so callers that want CALL_API
 * contracts resolved must `await ensureWorkflowEndpointCatalog()` first —
 * the context-schema route does; unwarmed processes degrade to 'unknown'.
 */
bindCallApiResponseSchemaResolver((endpoint, method) => findEndpointResponseSchema(endpoint, method) ?? 'unknown')

export const resolveServerOutputContract: ResolveOutputContract = (activityType, config) => {
  const entry = getActivityType(activityType)
  const contract = entry?.outputContract
  if (typeof contract !== 'function') return 'unknown'
  const resolved = contract(config)
  if (!(resolved instanceof ZodType)) return 'unknown'
  return flattenSchemaToContract(resolved)
}
