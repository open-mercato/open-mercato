import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

/**
 * The three things this module tells a colleague about.
 *
 * Declared here rather than only passed to `notificationService`, which matters for two reasons the code was
 * previously getting away with: an undeclared type is missing from the per-user notification preferences, so
 * nobody can turn it off except by turning off everything; and the delivery gate logs an unknown type and falls
 * through to preferences, so a type's own channel list is never honoured.
 *
 * All three ship as `in_app` only. Email is deliberately not a default: these go to colleagues, and a module
 * that starts emailing staff the moment it is installed is a module people disable. An operator re-enables
 * email per type from the Notification Delivery settings.
 */
export const notificationTypes: NotificationTypeDefinition[] = [
  {
    type: 'marketing_automation.lead_digest',
    channels: ['in_app'],
    module: 'marketing_automation',
    titleKey: 'marketing_automation.notifications.leadDigest.title',
    bodyKey: 'marketing_automation.notifications.leadDigest.body',
    icon: 'user-plus',
    severity: 'info',
    actions: [],
    labelKey: 'marketing_automation.notifications.leadDigest.label',
    descriptionKey: 'marketing_automation.notifications.leadDigest.description',
    category: 'marketing',
    /** A week's digest is stale after a fortnight, and a bell full of old digests is a bell nobody reads. */
    expiresAfterHours: 336,
  },
  {
    type: 'marketing_automation.deliverability_paused',
    channels: ['in_app'],
    module: 'marketing_automation',
    titleKey: 'marketing_automation.notifications.deliverability.title',
    bodyKey: 'marketing_automation.notifications.deliverability.body',
    icon: 'alert-triangle',
    /**
     * A campaign has been switched off automatically, which is the one thing here somebody must not miss —
     * warning rather than info, and it does not expire while it is still true.
     */
    severity: 'warning',
    actions: [],
    labelKey: 'marketing_automation.notifications.deliverability.label',
    descriptionKey: 'marketing_automation.notifications.deliverability.description',
    category: 'marketing',
  },
  {
    type: 'marketing_automation.split_winner_applied',
    channels: ['in_app'],
    module: 'marketing_automation',
    titleKey: 'marketing_automation.notifications.winnerApplied.title',
    bodyKey: 'marketing_automation.notifications.winnerApplied.body',
    icon: 'trophy',
    /**
     * Information rather than a warning: the campaign is now sending the better of two messages, which is good
     * news — but it is news, because somebody's campaign changed shape without them doing it.
     */
    severity: 'info',
    actions: [],
    labelKey: 'marketing_automation.notifications.winnerApplied.label',
    descriptionKey: 'marketing_automation.notifications.winnerApplied.description',
    category: 'marketing',
  },
  {
    type: 'marketing_automation.campaign_notice',
    channels: ['in_app'],
    module: 'marketing_automation',
    titleKey: 'marketing_automation.notifications.campaignNotice.title',
    bodyKey: 'marketing_automation.notifications.campaignNotice.body',
    icon: 'megaphone',
    severity: 'info',
    actions: [],
    labelKey: 'marketing_automation.notifications.campaignNotice.label',
    descriptionKey: 'marketing_automation.notifications.campaignNotice.description',
    category: 'marketing',
    /**
     * A journey milestone is worth acting on now or not at all — a fortnight-old "this VIP is unhappy" is a
     * reproach rather than a task.
     */
    expiresAfterHours: 336,
  },
]

export default notificationTypes
