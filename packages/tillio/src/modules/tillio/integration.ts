import { buildIntegrationDetailWidgetSpotId, type IntegrationBundle, type IntegrationDefinition } from '@open-mercato/shared/modules/integrations/types'

// Two names for one value on purpose: the integration registry keys credentials by the integration id
// while the phone_calls hub keys calls by the provider key, and the two axes need not agree.
export const TILLIO_INTEGRATION_ID = 'tillio'
export const TILLIO_PROVIDER_KEY = 'tillio'

export const tillioDetailWidgetSpotId = buildIntegrationDetailWidgetSpotId(TILLIO_INTEGRATION_ID)

export const integration: IntegrationDefinition = {
  id: TILLIO_INTEGRATION_ID,
  title: 'Tillio',
  description: 'VoIP bridge for the phone_calls hub. Configure the Tillio environment, then attach one Ringostat operator.',
  category: 'communication',
  hub: 'phone_calls',
  providerKey: TILLIO_PROVIDER_KEY,
  icon: 'phone-call',
  package: '@open-mercato/tillio',
  version: '1.0.0',
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
      {
        key: 'timeZone',
        label: 'Tillio time zone',
        type: 'text',
        required: false,
        placeholder: 'Europe/Warsaw',
        helpText: 'IANA zone the instance reports call timestamps in. Leave empty for Europe/Warsaw.',
      },
    ],
  },
  healthCheck: { service: 'tillioEnvironmentHealthCheck' },
}

export const integrations: IntegrationDefinition[] = [integration]
export const bundles: IntegrationBundle[] = []
export const bundle: IntegrationBundle | undefined = undefined
