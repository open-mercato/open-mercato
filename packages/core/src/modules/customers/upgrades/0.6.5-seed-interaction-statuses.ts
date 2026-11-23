import { defineUpgradeAction } from '@open-mercato/shared/modules/upgrade-actions'

export default defineUpgradeAction({
  id: 'customers.seed-interaction-statuses',
  version: '0.6.5',
  messageKey: 'customers.config.upgradeActions.interactionStatuses.message',
  ctaKey: 'customers.config.upgradeActions.interactionStatuses.cta',
  successKey: 'customers.config.upgradeActions.interactionStatuses.success',
  loadingKey: 'customers.config.upgradeActions.interactionStatuses.loading',
  async run({ em, tenantId, organizationId }) {
    const [{ INTERACTION_STATUS_DEFAULTS }, { ensureDictionaryEntry }] = await Promise.all([
      import('../lib/dictionaryDefaults'),
      import('../commands/shared'),
    ])
    for (const entry of INTERACTION_STATUS_DEFAULTS) {
      await ensureDictionaryEntry(em, {
        tenantId,
        organizationId,
        kind: 'interaction_status',
        value: entry.value,
        label: entry.label,
        color: entry.color,
        icon: entry.icon,
      })
    }
  },
})
