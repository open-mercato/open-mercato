import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { MarketingCampaignTrigger } from '../data/entities.js'
import { enqueueDispatch } from '../lib/queue.js'
import { reportError } from '@open-mercato/telemetry'

export const logger = createLogger('marketing_automation')

/**
 * Deliberately in `lib/` rather than in `subscribers/`.
 *
 * The generator registers EVERY file under `subscribers/` as a subscriber, reading its `metadata.event` — so a
 * shared helper living there was registered as a subscriber for the empty-string event, with a handler that
 * imports a module having no default export. Harmless only because nothing emits `''`.
 */

export type SubscriberContext = {
  resolve: <T = unknown>(name: string) => T
}

type ScopedPayload = Record<string, unknown> & {
  tenantId?: unknown
  organizationId?: unknown
}

function readScope(payload: ScopedPayload): { tenantId: string; organizationId: string } | null {
  const tenantId = typeof payload.tenantId === 'string' ? payload.tenantId.trim() : ''
  const organizationId = typeof payload.organizationId === 'string' ? payload.organizationId.trim() : ''
  if (!tenantId || !organizationId) return null
  return { tenantId, organizationId }
}

/**
 * Hands a platform event to the dispatch queue, but only if a campaign is listening.
 *
 * The listener check is deliberately here rather than in the worker. This runs on every single
 * event of its type in the system, and on an installation with no campaign for that event it
 * must cost one index probe rather than a queue round trip — otherwise enabling this module
 * would tax every order, every registration and every tag change.
 *
 * Never dispatches inline: a dispatch sends email, and that must not sit on the request or
 * command path that emitted the event.
 */
export async function forwardEventToCampaigns(
  eventId: string,
  payload: ScopedPayload,
  ctx: SubscriberContext,
): Promise<void> {
  const scope = readScope(payload)
  if (!scope) {
    // Not an error: plenty of events are emitted outside an organization scope, and a campaign
    // is always scoped, so there is nothing to run.
    return
  }

  try {
    const em = ctx.resolve<EntityManager>('em')
    const listening = await em.count(MarketingCampaignTrigger, {
      kind: 'event',
      eventId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    if (listening === 0) return

    await enqueueDispatch({
      eventId,
      scope,
      payload: payload as Record<string, unknown>,
    })
  } catch (error) {
    // A failure here must not fail the command that emitted the event — a campaign not firing
    // is far less bad than an order failing to save.
    logger.error('[internal] failed to forward event to marketing campaigns', {
      eventId,
      error: error instanceof Error ? error.message : String(error),
    })
    reportError(error, {
      module: 'marketing_automation',
      code: 'marketing_automation.forward_failed',
      attributes: { eventId },
    })
  }
}
