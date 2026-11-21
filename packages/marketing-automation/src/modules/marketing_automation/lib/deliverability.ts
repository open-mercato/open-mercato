import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import { MarketingCampaign } from '../data/entities.js'
import { buildCampaignCommandContext } from './command-context.js'
import { evaluateBreaker } from './engine/deliverability.js'
import type { BreakerDecision } from './engine/deliverability.js'

/**
 * The deliverability guardrail: reading each live campaign's recent attempts and pausing the ones being refused.
 *
 * Pausing is a real unpublish through the ordinary command, not a flag of our own — a campaign that looks
 * enabled but sends nothing is the worst of both, and an operator who reopens the campaign list must see the
 * truth there rather than on a separate screen.
 */

export type DeliverabilityScope = { tenantId: string; organizationId: string }

/** How far back the breaker looks. Long enough for a rate, short enough to be about now. */
export const WINDOW_HOURS = 24

type RateRow = { campaign_id: string; sent: string; failed: string }

export type BreakerOutcome = {
  campaignId: string
  campaignName: string
  decision: Extract<BreakerDecision, { trip: true }>
}

/**
 * Pauses every enabled campaign whose recent sends are mostly failing.
 *
 * Counted in ONE grouped query over the window rather than per campaign: this runs on the periodic pass, and a
 * query per campaign would make the guardrail the most expensive thing in the sweep.
 */
export async function applyDeliverabilityGuardrails(
  em: EntityManager,
  container: AwilixContainer,
  scope: DeliverabilityScope,
  now: Date,
): Promise<BreakerOutcome[]> {
  const since = new Date(now.getTime() - WINDOW_HOURS * 3_600_000)

  /**
   * The window starts at whichever is LATER: the window's own edge, or the last time this campaign was enabled.
   *
   * It used to be the window's edge alone, so an operator who fixed the cause and re-enabled had the campaign
   * paused again on this very pass — by the same failures they had just dealt with. The only way out was
   * waiting the whole window out, and nothing on the screen said that was what they were waiting for.
   *
   * Joined rather than filtered per campaign because this query is deliberately ONE grouped pass: the breaker
   * runs on the periodic sweep and a query per campaign is what it exists to avoid.
   */
  const rows = await em.getConnection().execute<RateRow[]>(
    `select s.campaign_id,
            count(*) filter (where s.status = 'sent')::text as sent,
            count(*) filter (where s.status = 'failed')::text as failed
       from marketing_message_sends s
       join marketing_campaigns c
         on c.id = s.campaign_id
        and c.tenant_id = s.tenant_id
        and c.organization_id = s.organization_id
      where s.tenant_id = ? and s.organization_id = ?
        and s.sent_at >= greatest(?::timestamptz, coalesce(c.breaker_reset_at, '-infinity'::timestamptz))
      group by s.campaign_id`,
    [scope.tenantId, scope.organizationId, since],
  )
  if (rows.length === 0) return []

  const tripped: BreakerOutcome[] = []

  for (const row of rows) {
    const decision = evaluateBreaker({
      sent: Number.parseInt(row.sent ?? '0', 10) || 0,
      failed: Number.parseInt(row.failed ?? '0', 10) || 0,
    })
    if (!decision.trip) continue

    // Only a LIVE campaign can be paused, and re-reading it here is also what stops a second pass from
    // pausing the same campaign twice and notifying twice.
    const campaign = await em.findOne(MarketingCampaign, {
      id: row.campaign_id,
      ...scope,
      deletedAt: null,
      isEnabled: true,
    })
    if (!campaign) continue

    /**
     * Through the shared context helper, and carrying the scope in the input.
     *
     * Written inline, this passed `auth: null` and no `systemActor`, so `requireScope` had nothing to read
     * from either side and threw 400 on every trip. The throw escaped before `tripped.push`, so no campaign
     * was ever paused and no notification was ever sent — and the sweep logged the failure at `warn` without
     * reporting it, which is why a guardrail that never once fired looked like a guardrail that never needed
     * to. `lib/auto-winner.ts` calls the same command correctly, fifty lines away.
     */
    const commandBus = container.resolve<CommandBus>('commandBus')
    await commandBus.execute('marketing_automation.campaigns.set_enabled', {
      input: {
        id: campaign.id,
        isEnabled: false,
        updatedAt: campaign.updatedAt.toISOString(),
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      },
      ctx: buildCampaignCommandContext(container, scope),
    })

    /**
     * Stamped AFTER the command, and outside it on purpose.
     *
     * `set_enabled` is the shared write and must not grow a breaker-specific argument — `auto-winner` calls the
     * same command. The stamp is this function's own bookkeeping: the pause already happened, and a failure here
     * costs a badge rather than a guardrail.
     */
    await em.nativeUpdate(
      MarketingCampaign,
      { id: campaign.id, tenantId: scope.tenantId, organizationId: scope.organizationId },
      { breakerTrippedAt: new Date() },
    )

    tripped.push({ campaignId: campaign.id, campaignName: campaign.name, decision })
  }

  return tripped
}

type NotificationServiceLike = {
  createForFeature(
    input: {
      type: string
      titleKey?: string
      bodyKey?: string
      titleVariables?: Record<string, string>
      bodyVariables?: Record<string, string>
      severity?: 'info' | 'success' | 'warning' | 'error'
      sourceModule?: string
      linkHref?: string
      groupKey?: string
      requiredFeature: string
    },
    ctx: { tenantId: string; organizationId?: string | null; userId?: string | null },
  ): Promise<unknown>
}

/**
 * Tells whoever can fix it.
 *
 * Addressed by FEATURE rather than to a named person: the campaign may have been published by somebody who has
 * left, and the people who can republish it are exactly those holding the manage grant.
 */
export async function announceBreaker(
  container: AwilixContainer,
  scope: DeliverabilityScope,
  outcome: BreakerOutcome,
): Promise<void> {
  let notifications: NotificationServiceLike
  try {
    notifications = container.resolve<NotificationServiceLike>('notificationService')
  } catch {
    return
  }
  await notifications.createForFeature(
    {
      type: 'marketing_automation.deliverability_paused',
      titleKey: 'marketing_automation.notifications.deliverability.title',
      bodyKey: 'marketing_automation.notifications.deliverability.body',
      titleVariables: { campaign: outcome.campaignName },
      bodyVariables: {
        campaign: outcome.campaignName,
        rate: String(Math.round(outcome.decision.failureRate * 100)),
        attempts: String(outcome.decision.attempts),
      },
      /**
       * `warning`, matching what `notifications.ts` DECLARES for this type.
       *
       * The emitter passed `error` while the declaration says `warning`, so the same notification had two
       * severities depending on which file you read — and the declaration's own comment explains the choice
       * ("warning rather than info, and it does not expire while it is still true"). A campaign the module paused
       * on purpose is a thing somebody must act on, not a thing that broke.
       */
      severity: 'warning',
      sourceModule: 'marketing_automation',
      linkHref: `/backend/marketing/campaigns/${outcome.campaignId}`,
      // One notice per campaign: a repeat pass must not stack alerts about the same pause.
      groupKey: `marketing_automation.deliverability.${outcome.campaignId}`,
      requiredFeature: 'marketing_automation.campaigns.manage',
    },
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
}
