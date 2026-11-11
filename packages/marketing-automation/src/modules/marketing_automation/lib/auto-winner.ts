import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import { MarketingCampaign } from '../data/entities.js'
import { campaignDefinitionSchema } from '../data/validators.js'
import { describeLanes } from './engine/split.js'
import { decideAutoWinner, DEFAULT_WINNER_MARGIN } from './engine/auto-winner.js'
import { loadSplitResults } from './analytics/split-results.js'
import type { WinnerMetric } from './analytics/split-results.js'
import { loadWinnerMetric } from './winner-metric.js'
import { buildCampaignCommandContext } from './command-context.js'
import type { CampaignStep } from './engine/types.js'

/**
 * Concluding A/B tests that nobody remembered to conclude.
 *
 * The problem this solves is real and unglamorous: a split runs, a winner emerges, and the campaign keeps
 * sending the losing variant to half the audience for months because promoting it was somebody's third
 * priority. The results screen has suggested a winner since Phase 3; this acts on the suggestion.
 *
 * **Off by default, and that is a product decision rather than caution.** Promoting a winner REWRITES an
 * author's campaign, which is the one thing this module otherwise reserves for a person — the AI agent may
 * draft but not publish, for the same reason. An operator who wants it turns it on per tenant.
 *
 * When it does act, it acts through the ordinary `apply_split_winner` command: validated, version-checked,
 * recorded as a revision, and therefore restorable. Nothing here writes to a campaign directly.
 */

export type AutoWinnerScope = { tenantId: string; organizationId: string }

/** The module config keys, per tenant. */
export const AUTO_APPLY_CONFIG_NAME = 'autoApplySplitWinner'
export const AUTO_APPLY_MARGIN_CONFIG_NAME = 'autoApplySplitWinnerMargin'

type ModuleConfigLike = {
  getValue<T = unknown>(
    moduleId: string,
    name: string,
    options?: { defaultValue?: T | null; scope?: { tenantId?: string | null; organizationId?: string | null } },
  ): Promise<T | null>
}

type NotificationServiceLike = {
  createForFeature(
    input: Record<string, unknown> & { requiredFeature: string },
    ctx: { tenantId: string; organizationId?: string | null },
  ): Promise<unknown>
}

export type AutoWinnerSettings = { enabled: boolean; margin: number; metric: WinnerMetric }

/**
 * Reads the tenant's settings, defaulting to OFF.
 *
 * Resolved defensively like every other config read here: a missing service is a default, never a failure. The
 * default being `false` means a trimmed installation and a misconfigured one behave identically, which is the
 * safe direction for a feature that rewrites campaigns.
 */
export async function loadAutoWinnerSettings(
  container: AwilixContainer,
  scope: AutoWinnerScope,
): Promise<AutoWinnerSettings> {
  /**
   * The metric is read through its own loader rather than a third key here.
   *
   * It is not an auto-apply setting: the results screen suggests on the same metric, and one question answered
   * two ways is how a tenant ends up shown a click winner while a revenue winner is applied behind their back.
   */
  const metric = await loadWinnerMetric(container, scope)
  const fallback: AutoWinnerSettings = { enabled: false, margin: DEFAULT_WINNER_MARGIN, metric }
  let service: ModuleConfigLike
  try {
    service = container.resolve<ModuleConfigLike>('moduleConfigService')
  } catch {
    return fallback
  }
  try {
    // The scope goes INSIDE the options object; passed positionally it is silently dropped and every tenant
    // reads the instance-wide value. This module has that bug on record twice.
    const [enabled, margin] = await Promise.all([
      service.getValue<unknown>('marketing_automation', AUTO_APPLY_CONFIG_NAME, { scope }),
      service.getValue<unknown>('marketing_automation', AUTO_APPLY_MARGIN_CONFIG_NAME, { scope }),
    ])
    const parsedMargin = typeof margin === 'number' ? margin : Number(margin)
    return {
      enabled: enabled === true || enabled === 'true',
      margin: Number.isFinite(parsedMargin) && parsedMargin > 0 ? parsedMargin : DEFAULT_WINNER_MARGIN,
      metric,
    }
  } catch {
    return fallback
  }
}

export type AppliedWinner = {
  campaignId: string
  campaignName: string
  stepId: string
  variant: string
  /** Which question decided it, and the winner's figure on that question. */
  metric: WinnerMetric
  value: number
  /** The currency the figure is in, on a revenue verdict. Null on a click one, which has no currency. */
  currencyCode: string | null
  clickRate: number
  reached: number
}

/**
 * Promotes every winner that has earned it, across every enabled campaign with a split.
 *
 * Enabled campaigns only: a paused campaign's split has stopped gathering data, and rewriting something nobody
 * is running is a change an author would find waiting for them with no explanation.
 */
export async function applyEarnedWinners(
  em: EntityManager,
  container: AwilixContainer,
  scope: AutoWinnerScope,
  minimumReached: number,
): Promise<AppliedWinner[]> {
  const settings = await loadAutoWinnerSettings(container, scope)
  if (!settings.enabled) return []

  const campaigns = await em.find(MarketingCampaign, { ...scope, deletedAt: null, isEnabled: true })
  const applied: AppliedWinner[] = []

  for (const campaign of campaigns) {
    const parsed = campaignDefinitionSchema.safeParse(campaign.definition)
    if (!parsed.success) continue
    const lanes = describeLanes(parsed.data.steps as CampaignStep[])
    if (lanes.length === 0) continue

    const results = await loadSplitResults(em, campaign.id, scope, lanes)
    const splitStepIds = [...new Set(lanes.map((lane) => lane.splitStepId))]

    for (const stepId of splitStepIds) {
      const decision = decideAutoWinner(results, stepId, minimumReached, settings.margin, settings.metric)
      if (!decision.apply) continue

      /**
       * Through the command, with the version we just read.
       *
       * So a concurrent edit collides exactly as it would for a person: the author wins, the sweep's attempt is
       * refused, and the next pass sees whatever they saved. Swallowed rather than re-thrown, because one
       * campaign losing a race must not abort the rest of the pass.
       */
      try {
        const commandBus = container.resolve<CommandBus>('commandBus')
        await commandBus.execute('marketing_automation.campaigns.apply_split_winner', {
          input: {
            id: campaign.id,
            updatedAt: campaign.updatedAt.toISOString(),
            stepId,
            variantKey: decision.winner.variant,
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
          },
          ctx: buildCampaignCommandContext(container, scope),
        })
      } catch {
        continue
      }

      /**
       * The currency comes from the lane, not from the winner.
       *
       * A winner carries a figure; only the lane knows what that figure is denominated in, and announcing a
       * revenue verdict without it would print a bare number in whatever currency the reader assumed.
       */
      const lane = results.find((result) => result.stepId === stepId && result.variant === decision.winner.variant)
      applied.push({
        campaignId: campaign.id,
        campaignName: campaign.name,
        stepId,
        variant: decision.winner.variant,
        metric: decision.winner.metric,
        value: decision.winner.value,
        currencyCode: decision.winner.metric === 'revenue' ? lane?.currencyCode ?? null : null,
        clickRate: decision.winner.clickRate,
        reached: decision.winner.reached,
      })

      /**
       * One promotion per campaign per pass.
       *
       * A campaign with two splits has had its definition rewritten by the first promotion, so the version this
       * loop holds is stale and the second attempt would be refused anyway. Stopping deliberately is clearer
       * than relying on the lock to say no.
       */
      break
    }
  }

  return applied
}

/**
 * Tells whoever could have done it by hand.
 *
 * Addressed by FEATURE, like the deliverability breaker and for the same reason: the campaign may have been
 * published by somebody who has left, and the people who need to know are those who can change it back.
 */
export async function announceAppliedWinner(
  container: AwilixContainer,
  scope: AutoWinnerScope,
  applied: AppliedWinner,
): Promise<void> {
  let notifications: NotificationServiceLike
  try {
    notifications = container.resolve<NotificationServiceLike>('notificationService')
  } catch {
    return
  }
  /**
   * Two bodies, because the evidence is a different KIND of number.
   *
   * A click verdict is a percentage; a revenue one is money per recipient and needs its currency beside it.
   * Formatting money into a "rate" sentence would read as "3.4% click rate" for an amount that is nothing of
   * the sort, so the sentence changes with the metric rather than the number being squeezed into it.
   */
  const revenueVerdict = applied.metric === 'revenue'
  await notifications.createForFeature(
    {
      type: 'marketing_automation.split_winner_applied',
      titleKey: 'marketing_automation.notifications.winnerApplied.title',
      bodyKey: revenueVerdict
        ? 'marketing_automation.notifications.winnerApplied.bodyRevenue'
        : 'marketing_automation.notifications.winnerApplied.body',
      titleVariables: { campaign: applied.campaignName },
      bodyVariables: {
        campaign: applied.campaignName,
        variant: applied.variant,
        rate: (applied.clickRate * 100).toFixed(1),
        amount: applied.value.toFixed(2),
        currency: applied.currencyCode ?? '',
        reached: String(applied.reached),
      },
      severity: 'info',
      sourceModule: 'marketing_automation',
      // The results screen, because the first question is "on what evidence" and that is where it is.
      linkHref: `/backend/marketing/campaigns/${applied.campaignId}/results`,
      groupKey: `marketing_automation.winner.${applied.campaignId}.${applied.stepId}`,
      requiredFeature: 'marketing_automation.campaigns.manage',
    },
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
}
