import { buildIntegrationDetailWidgetSpotId, type IntegrationBundle, type IntegrationDefinition } from '@open-mercato/shared/modules/integrations/types'

export const channelResendDetailWidgetSpotId = buildIntegrationDetailWidgetSpotId('channel_resend')

export const integration: IntegrationDefinition = {
  id: 'channel_resend',
  title: 'Resend Email',
  description: 'Send transactional email through Resend using the Communications Hub.',
  category: 'communication',
  hub: 'communication_channels',
  providerKey: 'resend',
  icon: 'mail',
  docsUrl: 'https://resend.com/docs',
  package: '@open-mercato/channel-resend',
  version: '0.1.0',
  author: 'Open Mercato Team',
  company: 'Open Mercato',
  license: 'MIT',
  tags: ['email', 'resend', 'transactional', 'communication'],
  detailPage: {
    widgetSpotId: channelResendDetailWidgetSpotId,
  },
  apiVersions: [
    {
      id: 'resend-v2',
      label: 'Resend Email API',
      status: 'stable',
      default: true,
      changelog: 'Initial outbound transactional email adapter.',
    },
  ],
  credentials: {
    fields: [
      {
        key: 'apiKey',
        label: 'API key',
        type: 'secret',
        required: true,
        helpText: 'Resend API key used for outbound transactional email.',
      },
      {
        key: 'fromAddress',
        label: 'From address',
        type: 'text',
        required: true,
        placeholder: 'no-reply@example.com',
        helpText: 'Verified sender address or domain identity in Resend.',
      },
    ],
  },
}

export const integrations: IntegrationDefinition[] = [integration]
export const bundles: IntegrationBundle[] = []
export const bundle: IntegrationBundle | undefined = undefined
