import { buildIntegrationDetailWidgetSpotId, type IntegrationBundle, type IntegrationDefinition } from '@open-mercato/shared/modules/integrations/types'

export const webhookCustomIntegrationId = 'webhook_custom'
export const webhookCustomDetailWidgetSpotId = buildIntegrationDetailWidgetSpotId(webhookCustomIntegrationId)

export const integration: IntegrationDefinition = {
  id: webhookCustomIntegrationId,
  title: 'Custom Webhooks',
  description: 'Send and receive webhooks using the Standard Webhooks specification.',
  category: 'webhook',
  hub: 'webhook_endpoints',
  providerKey: webhookCustomIntegrationId,
  icon: 'webhook',
  package: '@open-mercato/webhooks',
  version: '1.0.0',
  author: 'Open Mercato Team',
  company: 'Open Mercato',
  license: 'Proprietary',
  tags: ['webhooks', 'automation', 'events', 'standard-webhooks'],
  detailPage: {
    widgetSpotId: webhookCustomDetailWidgetSpotId,
    hiddenTabs: ['credentials', 'health', 'logs'],
  },
  defaultState: {
    isEnabled: true,
  },
  credentials: {
    fields: [
      {
        key: 'notifyOnFailedDelivery',
        label: 'Notify Admins On Failed Delivery',
        type: 'boolean',
        helpText: 'Send an in-app notification to admin users when a webhook delivery finally fails after retries are exhausted.',
      },
    ],
  },
}

export const integrations: IntegrationDefinition[] = [integration]
export const bundles: IntegrationBundle[] = []
export const bundle: IntegrationBundle | undefined = undefined
