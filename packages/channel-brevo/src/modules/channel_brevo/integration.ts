import { buildIntegrationDetailWidgetSpotId, type IntegrationBundle, type IntegrationDefinition } from '@open-mercato/shared/modules/integrations/types'

export const channelBrevoDetailWidgetSpotId = buildIntegrationDetailWidgetSpotId('channel_brevo')

export const integration: IntegrationDefinition = {
  id: 'channel_brevo',
  title: 'Brevo Email',
  description: 'Send transactional email through Brevo using the Communications Hub.',
  category: 'communication',
  hub: 'communication_channels',
  providerKey: 'brevo',
  icon: 'mail',
  docsUrl: 'https://developers.brevo.com/docs/send-a-transactional-email',
  package: '@open-mercato/channel-brevo',
  version: '0.1.0',
  author: 'Open Mercato Team',
  company: 'Open Mercato',
  license: 'MIT',
  tags: ['email', 'brevo', 'transactional', 'communication', 'eu-hosted'],
  detailPage: {
    widgetSpotId: channelBrevoDetailWidgetSpotId,
  },
  apiVersions: [
    {
      id: 'brevo-v3',
      label: 'Brevo API v3',
      status: 'stable',
      default: true,
      changelog: 'Initial outbound transactional email adapter.',
    },
  ],
  healthCheck: { service: 'channelBrevoHealthCheck' },
  credentials: {
    fields: [
      {
        key: 'apiKey',
        label: 'API key',
        type: 'secret',
        required: true,
        helpText: 'Brevo API key used for outbound transactional email.',
      },
      {
        key: 'fromAddress',
        label: 'From address',
        type: 'text',
        required: true,
        placeholder: 'no-reply@example.com',
        helpText: 'Verified sender address or domain identity in Brevo.',
      },
    ],
  },
}

export const integrations: IntegrationDefinition[] = [integration]
export const bundles: IntegrationBundle[] = []
export const bundle: IntegrationBundle | undefined = undefined
