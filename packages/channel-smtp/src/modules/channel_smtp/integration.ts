import { buildIntegrationDetailWidgetSpotId, type IntegrationBundle, type IntegrationDefinition } from '@open-mercato/shared/modules/integrations/types'

export const channelSmtpDetailWidgetSpotId = buildIntegrationDetailWidgetSpotId('channel_smtp')

export const integration: IntegrationDefinition = {
  id: 'channel_smtp',
  title: 'SMTP Email',
  description: 'Send transactional email through any SMTP relay using the Communications Hub.',
  category: 'communication',
  hub: 'communication_channels',
  providerKey: 'smtp',
  icon: 'mail',
  docsUrl: 'https://nodemailer.com/smtp/',
  package: '@open-mercato/channel-smtp',
  version: '0.1.0',
  author: 'Open Mercato Team',
  company: 'Open Mercato',
  license: 'MIT',
  tags: ['email', 'smtp', 'relay', 'transactional', 'communication'],
  detailPage: {
    widgetSpotId: channelSmtpDetailWidgetSpotId,
  },
  apiVersions: [
    {
      id: 'smtp',
      label: 'SMTP (RFC 5321)',
      status: 'stable',
      default: true,
      changelog: 'Initial outbound transactional email adapter.',
    },
  ],
  healthCheck: { service: 'channelSmtpHealthCheck' },
  credentials: {
    fields: [
      {
        key: 'host',
        label: 'SMTP host',
        type: 'text',
        required: true,
        placeholder: 'smtp.example.com',
        helpText: 'Hostname of the SMTP relay. Private and loopback addresses are rejected.',
      },
      {
        key: 'port',
        label: 'SMTP port',
        type: 'text',
        required: true,
        placeholder: '587',
        helpText: 'Usually 587 for STARTTLS or 465 for implicit TLS.',
      },
      {
        key: 'tls',
        label: 'Transport security',
        type: 'select',
        required: true,
        options: [
          { value: 'starttls', label: 'STARTTLS (usually port 587)' },
          { value: 'tls', label: 'Implicit TLS (usually port 465)' },
          { value: 'none', label: 'Cleartext (requires an operator opt-in)' },
        ],
        helpText: 'Cleartext is refused unless OM_CHANNEL_SMTP_ALLOW_INSECURE_TRANSPORT is set.',
      },
      {
        key: 'user',
        label: 'Username',
        type: 'text',
        required: true,
        helpText: 'SMTP AUTH username issued by the relay.',
      },
      {
        key: 'password',
        label: 'Password',
        type: 'secret',
        required: true,
        helpText: 'SMTP AUTH password or app-specific password.',
      },
      {
        key: 'fromAddress',
        label: 'From address',
        type: 'text',
        required: true,
        placeholder: 'no-reply@example.com',
        helpText: 'Sender address the relay is authorized to send for.',
      },
    ],
  },
}

export const integrations: IntegrationDefinition[] = [integration]
export const bundles: IntegrationBundle[] = []
export const bundle: IntegrationBundle | undefined = undefined
