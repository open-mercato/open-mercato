import { buildIntegrationDetailWidgetSpotId, type IntegrationBundle, type IntegrationDefinition } from '@open-mercato/shared/modules/integrations/types'

export const channelWhatsAppDetailWidgetSpotId = buildIntegrationDetailWidgetSpotId('channel_whatsapp')

export const integration: IntegrationDefinition = {
  id: 'channel_whatsapp',
  title: 'WhatsApp',
  description: 'Two-way WhatsApp Business Cloud API channel: text, media and template messages with a signed webhook.',
  category: 'communication',
  hub: 'communication_channels',
  providerKey: 'whatsapp',
  icon: 'whatsapp',
  docsUrl: 'https://developers.facebook.com/docs/whatsapp/cloud-api',
  package: '@open-mercato/channel-whatsapp',
  version: '1.0.0',
  author: 'Open Mercato Team',
  company: 'Open Mercato',
  license: 'MIT',
  tags: ['whatsapp', 'chat', 'meta', 'cloud-api', 'communication'],
  detailPage: {
    widgetSpotId: channelWhatsAppDetailWidgetSpotId,
  },
  apiVersions: [
    {
      id: 'v20.0',
      label: 'WhatsApp Cloud API v20.0',
      status: 'stable',
      default: true,
      changelog: 'Cloud API messaging, template messages, media links and webhook status updates.',
    },
  ],
  credentials: {
    fields: [
      {
        key: 'accessToken',
        label: 'Access token',
        type: 'secret',
        required: true,
        helpText:
          'Meta app → WhatsApp → API Setup → permanent or temporary access token. Stored encrypted at rest; never logged.',
      },
      {
        key: 'phoneNumberId',
        label: 'Phone number ID',
        type: 'text',
        required: true,
        placeholder: '123456789012345',
        helpText: 'Meta app → WhatsApp → API Setup → Phone number ID (not the phone number itself).',
      },
      {
        key: 'verifyToken',
        label: 'Webhook verify token',
        type: 'secret',
        required: false,
        helpText:
          'A token you choose and paste into Meta → WhatsApp → Configuration → Webhook. Required for the one-time GET subscription handshake.',
      },
      {
        key: 'appSecret',
        label: 'App secret',
        type: 'secret',
        required: false,
        helpText:
          'Meta app → App settings → Basic → App secret. Verifies the X-Hub-Signature-256 header on every inbound webhook. Required for inbound messages.',
      },
      {
        key: 'defaultRecipient',
        label: 'Default recipient',
        type: 'text',
        required: false,
        placeholder: '9665XXXXXXXX',
        helpText: 'Optional E.164 phone number used when an outbound message names no recipient.',
      },
      {
        key: 'apiVersion',
        label: 'API version',
        type: 'text',
        required: false,
        placeholder: 'v20.0',
        helpText: 'Graph API version. Leave blank to use v20.0.',
      },
    ],
  },
  healthCheck: { service: 'channelWhatsAppHealthCheck' },
}

export const integrations: IntegrationDefinition[] = [integration]
export const bundles: IntegrationBundle[] = []
export const bundle: IntegrationBundle | undefined = undefined
