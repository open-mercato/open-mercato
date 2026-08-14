import { buildIntegrationDetailWidgetSpotId, type IntegrationBundle, type IntegrationDefinition } from '@open-mercato/shared/modules/integrations/types'

export const tillioDetailWidgetSpotId = buildIntegrationDetailWidgetSpotId('tillio')

export const integration: IntegrationDefinition = {
  id: 'tillio',
  title: 'Tillio',
  description: 'VoIP bridge for the phone_calls hub. Configure the Tillio environment, then attach one Ringostat operator.',
  category: 'communication',
  hub: 'phone_calls',
  providerKey: 'tillio',
  icon: 'phone-call',
  package: '@open-mercato/tillio',
  version: '0.1.0',
  author: 'Open Mercato Team',
  license: 'MIT',
  tags: ['tillio', 'voip', 'phone-calls', 'telephony', 'ringostat'],
  detailPage: {
    widgetSpotId: tillioDetailWidgetSpotId,
  },
  credentials: {
    fields: [
      {
        key: 'apiUrl',
        label: 'Tillio API URL',
        type: 'url',
        required: true,
        placeholder: 'https://your-tillio-instance.example.com',
        helpText: 'Base URL of your Tillio environment.',
      },
      {
        key: 'apiKey',
        label: 'Tillio API Key',
        type: 'secret',
        required: true,
        helpText: 'Global application key (X-Api-Key) for your Tillio environment.',
      },
    ],
  },
  healthCheck: { service: 'tillioEnvironmentHealthCheck' },
}

export const integrations: IntegrationDefinition[] = [integration]
export const bundles: IntegrationBundle[] = []
export const bundle: IntegrationBundle | undefined = undefined
