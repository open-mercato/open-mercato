import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'
import { webhookCustomDetailWidgetSpotId } from '../integration'

export const injectionTable: ModuleInjectionTable = {
  [webhookCustomDetailWidgetSpotId]: [
    {
      widgetId: 'webhooks.integration-setup',
      kind: 'tab',
      groupId: 'settings',
      groupLabel: 'webhooks.integrationTabs.settings',
      priority: 100,
    },
    {
      widgetId: 'webhooks.integration-deliveries',
      kind: 'tab',
      groupId: 'logs',
      groupLabel: 'integrations.detail.tabs.logs',
      priority: 90,
    },
  ],
}

export default injectionTable
