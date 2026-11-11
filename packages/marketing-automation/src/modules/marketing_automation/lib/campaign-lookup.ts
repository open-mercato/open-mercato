import type { EntityManager } from '@mikro-orm/postgresql'
import { MarketingCampaign, MarketingCampaignTrigger } from '../data/entities.js'
import type { RunScope } from './runs.js'

export type CampaignWithTrigger = {
  campaign: MarketingCampaign
  trigger: MarketingCampaignTrigger
}

/**
 * Enabled campaigns listening on one platform event.
 *
 * Two queries rather than a join so the trigger index carries the selective part: the trigger
 * lookup runs on EVERY platform event in the system, and it has to stay an index probe that
 * usually returns nothing.
 */
export async function findCampaignsForEvent(
  em: EntityManager,
  eventId: string,
  scope: RunScope,
): Promise<CampaignWithTrigger[]> {
  const triggers = await em.find(MarketingCampaignTrigger, {
    kind: 'event',
    eventId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  if (!triggers.length) return []

  const campaigns = await em.find(MarketingCampaign, {
    id: { $in: triggers.map((trigger) => trigger.campaignId) },
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    isEnabled: true,
    deletedAt: null,
  })
  const byId = new Map(campaigns.map((campaign) => [campaign.id, campaign]))

  return triggers
    .map((trigger) => {
      const campaign = byId.get(trigger.campaignId)
      return campaign ? { campaign, trigger } : null
    })
    .filter((entry): entry is CampaignWithTrigger => entry !== null)
}

/** Enabled campaigns driven by a periodic audience sweep rather than an event. */
export async function findScheduledCampaigns(
  em: EntityManager,
  scope: RunScope,
): Promise<CampaignWithTrigger[]> {
  const triggers = await em.find(MarketingCampaignTrigger, {
    kind: 'schedule',
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  if (!triggers.length) return []

  const campaigns = await em.find(MarketingCampaign, {
    id: { $in: triggers.map((trigger) => trigger.campaignId) },
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    isEnabled: true,
    deletedAt: null,
  })
  const byId = new Map(campaigns.map((campaign) => [campaign.id, campaign]))

  return triggers
    .map((trigger) => {
      const campaign = byId.get(trigger.campaignId)
      return campaign ? { campaign, trigger } : null
    })
    .filter((entry): entry is CampaignWithTrigger => entry !== null)
}
