import { buildIntegrationDetailWidgetSpotId, type IntegrationBundle, type IntegrationDefinition } from '@open-mercato/shared/modules/integrations/types'
import { inpostWebhookSetupGuide } from './webhook-guide'

export const carrierInpostDetailWidgetSpotId = buildIntegrationDetailWidgetSpotId('carrier_inpost')

export const integration: IntegrationDefinition = {
  id: 'carrier_inpost',
  title: 'InPost',
  description: 'Ship parcels via InPost lockers (Paczkomat) and courier delivery with real-time tracking.',
  category: 'shipping',
  hub: 'shipping_carriers',
  providerKey: 'inpost',
  icon: 'inpost',
  docsUrl: 'https://developers.inpost.pl',
  package: '@open-mercato/carrier-inpost',
  version: '1.0.0',
  author: 'Open Mercato Team',
  company: 'Open Mercato',
  license: 'MIT',
  tags: ['paczkomat', 'locker', 'courier', 'poland', 'pl', 'cee'],
  detailPage: {
    widgetSpotId: carrierInpostDetailWidgetSpotId,
  },
  credentials: {
    fields: [
      {
        key: 'apiToken',
        label: 'API Token (Bearer)',
        type: 'secret',
        required: true,
        helpText: 'Organization API token from InPost Manager (Manager -> API -> Tokens).',
      },
      {
        key: 'organizationId',
        label: 'Organization ID',
        type: 'text',
        required: true,
        helpText: 'Your InPost organization UUID (visible in the InPost Manager URL after /organizations/).',
      },
      {
        key: 'apiBaseUrl',
        label: 'API Base URL',
        type: 'url',
        required: false,
        placeholder: 'https://api-shipx-pl.easypack24.net',
        helpText: 'Leave empty for production. Use the sandbox URL for testing.',
      },
      {
        key: 'apiPointsBaseUrl',
        label: 'Points API Base URL',
        type: 'url',
        required: false,
        placeholder: 'https://api.inpost.pl',
        helpText: 'Leave empty for production. Use the sandbox Points API URL for testing.',
      },
      {
        key: 'webhookSecret',
        label: 'Webhook Secret',
        type: 'secret',
        required: false,
        helpText: 'HMAC-SHA256 signing secret for webhook signature verification.',
        helpDetails: inpostWebhookSetupGuide,
      },
    ],
  },
  healthCheck: { service: 'inpostHealthCheck' },
}

export const integrations: IntegrationDefinition[] = [integration]
export const bundles: IntegrationBundle[] = []
export const bundle: IntegrationBundle | undefined = undefined
