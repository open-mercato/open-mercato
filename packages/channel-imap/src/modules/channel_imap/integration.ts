import { buildIntegrationDetailWidgetSpotId, type IntegrationBundle, type IntegrationDefinition } from '@open-mercato/shared/modules/integrations/types'

export const channelImapDetailWidgetSpotId = buildIntegrationDetailWidgetSpotId('channel_imap')

export const integration: IntegrationDefinition = {
  id: 'channel_imap',
  title: 'IMAP + SMTP',
  description:
    'Connect any IMAP-capable mailbox (Fastmail, Proton Bridge, generic IMAP host) for inbound polling and outbound SMTP send.',
  category: 'communication',
  hub: 'communication_channels',
  providerKey: 'imap',
  icon: 'mail',
  docsUrl: 'https://datatracker.ietf.org/doc/html/rfc3501',
  package: '@open-mercato/channel-imap',
  version: '0.1.0',
  author: 'Open Mercato Team',
  company: 'Open Mercato',
  license: 'MIT',
  tags: ['email', 'imap', 'smtp', 'polling', 'communication'],
  detailPage: {
    widgetSpotId: channelImapDetailWidgetSpotId,
  },
  apiVersions: [
    {
      id: 'rfc3501+rfc5321',
      label: 'IMAP4 (RFC3501) + SMTP (RFC5321)',
      status: 'stable',
      default: true,
      changelog: 'Initial IMAP4/SMTP baseline. UIDVALIDITY+UIDNEXT polling, SMTP STARTTLS+SSL.',
    },
  ],
  credentials: {
    fields: [
      {
        key: 'imapHost',
        label: 'IMAP host',
        type: 'text',
        required: true,
        placeholder: 'imap.fastmail.com',
        helpText: 'Hostname of the IMAP server. Typically the same hostname your mail client uses.',
      },
      {
        key: 'imapPort',
        label: 'IMAP port',
        type: 'text',
        required: true,
        placeholder: '993',
        helpText: '993 for IMAPS (TLS) or 143 for STARTTLS.',
      },
      {
        key: 'imapTls',
        label: 'IMAP TLS mode',
        type: 'select',
        required: true,
        options: [
          { value: 'tls', label: 'Implicit TLS (port 993)' },
          { value: 'starttls', label: 'STARTTLS (port 143)' },
          { value: 'none', label: 'None (insecure — testing only)' },
        ],
        helpText: 'Prefer implicit TLS. STARTTLS is acceptable. None disables encryption and should only be used inside a private network for testing.',
      },
      {
        key: 'imapUser',
        label: 'IMAP username',
        type: 'text',
        required: true,
        helpText: 'Usually your email address.',
      },
      {
        key: 'imapPassword',
        label: 'IMAP password (or app password)',
        type: 'secret',
        required: true,
        helpText: 'Use a per-app password if your provider offers one. Stored encrypted at rest.',
      },
      {
        key: 'smtpHost',
        label: 'SMTP host',
        type: 'text',
        required: true,
        placeholder: 'smtp.fastmail.com',
      },
      {
        key: 'smtpPort',
        label: 'SMTP port',
        type: 'text',
        required: true,
        placeholder: '465',
        helpText: '465 for implicit TLS, 587 for STARTTLS.',
      },
      {
        key: 'smtpTls',
        label: 'SMTP TLS mode',
        type: 'select',
        required: true,
        options: [
          { value: 'tls', label: 'Implicit TLS (port 465)' },
          { value: 'starttls', label: 'STARTTLS (port 587)' },
          { value: 'none', label: 'None (insecure — testing only)' },
        ],
      },
      {
        key: 'smtpUser',
        label: 'SMTP username',
        type: 'text',
        required: true,
      },
      {
        key: 'smtpPassword',
        label: 'SMTP password (or app password)',
        type: 'secret',
        required: true,
        helpText: 'Often the same as the IMAP password; provider-dependent.',
      },
      {
        key: 'fromAddress',
        label: 'From address',
        type: 'text',
        required: true,
        placeholder: 'name@example.com',
        helpText: 'Address used as the From header when sending. Must be deliverable by the SMTP server.',
      },
    ],
  },
  healthCheck: { service: 'channelImapHealthCheck' },
}

export const integrations: IntegrationDefinition[] = [integration]
export const bundles: IntegrationBundle[] = []
export const bundle: IntegrationBundle | undefined = undefined
