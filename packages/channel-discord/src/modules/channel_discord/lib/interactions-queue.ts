import { createModuleQueue, type Queue } from '@open-mercato/queue'
import type { DispatchableInteraction } from './interactions-dispatch'

/**
 * Queue carrying verified Discord interactions from the HTTP route to the
 * dispatch worker.
 *
 * It lives here rather than in the worker so the route never imports a worker
 * module: `workers/` is an auto-discovery path, and a route that pulled one in
 * would drag the worker's dependency graph into the request bundle.
 *
 * Mirrors the hub's `getCommunicationChannelsQueue` — one memoized instance per
 * name, so the route and the worker share it instead of constructing a queue per
 * request.
 */
export const CHANNEL_DISCORD_INTERACTIONS_QUEUE = 'channel_discord_interactions'

const INTERACTIONS_QUEUE_CONCURRENCY = 5

export type InteractionDispatchJobPayload = {
  channelId: string
  channelType: string
  tenantId: string
  organizationId: string | null
  /**
   * Scope the bot token is re-resolved with on the worker side. The token itself
   * is deliberately absent: the local queue strategy persists payloads to disk
   * as plain JSON.
   */
  credentialScope: { tenantId: string; organizationId: string; userId: string | null }
  interaction: DispatchableInteraction
}

let cachedQueue: Queue<Record<string, unknown>> | null = null

export function getInteractionDispatchQueue(): Queue<Record<string, unknown>> {
  if (!cachedQueue) {
    cachedQueue = createModuleQueue<Record<string, unknown>>(CHANNEL_DISCORD_INTERACTIONS_QUEUE, {
      concurrency: INTERACTIONS_QUEUE_CONCURRENCY,
    })
  }
  return cachedQueue
}
