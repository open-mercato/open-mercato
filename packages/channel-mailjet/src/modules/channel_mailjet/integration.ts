import { buildIntegrationDetailWidgetSpotId, type IntegrationBundle, type IntegrationDefinition } from '@open-mercato/shared/modules/integrations/types'

export const channelMailjetDetailWidgetSpotId = buildIntegrationDetailWidgetSpotId('channel_mailjet')

export const integration: IntegrationDefinition = {
  id: 'channel_mailjet',
  title: 'Mailjet Email',
  description: 'Send transactional email through Mailjet using the Communications Hub.',
  category: 'communication',
  hub: 'communication_channels',
  providerKey: 'mailjet',
  icon: 'mail',
  docsUrl: 'https://dev.mailjet.com/docs/email-api/send-api-v31/send-basic-email',
  package: '@open-mercato/channel-mailjet',
  version: '0.1.0',
  author: 'Open Mercato Team',
  company: 'Open Mercato',
  license: 'MIT',
  tags: ['email', 'mailjet', 'transactional', 'communication', 'eu-hosted'],
  detailPage: {
    widgetSpotId: channelMailjetDetailWidgetSpotId,
  },
  apiVersions: [
    {
      id: 'mailjet-v3.1',
      label: 'Mailjet Send API v3.1',
      status: 'stable',
      default: true,
      changelog: 'Initial outbound transactional email adapter.',
    },
  ],
  healthCheck: { service: 'channelMailjetHealthCheck' },
  credentials: {
    fields: [
      {
        key: 'apiKey',
        label: 'Public API key',
        type: 'secret',
        required: true,
        helpText: 'Mailjet public API key used for outbound transactional email.',
      },
      {
        key: 'secretKey',
        label: 'Private API key',
        type: 'secret',
        required: true,
        helpText: 'Mailjet private API key used for HTTPS Basic authentication.',
      },
      {
        key: 'fromAddress',
        label: 'From address',
        type: 'text',
        required: true,
        placeholder: 'no-reply@example.com',
        helpText: 'Verified sender address or domain identity in Mailjet.',
      },
    ],
  },
}

export const integrations: IntegrationDefinition[] = [integration]
export const bundles: IntegrationBundle[] = []
export const bundle: IntegrationBundle | undefined = undefined
