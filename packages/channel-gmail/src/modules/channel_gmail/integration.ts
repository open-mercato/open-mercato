import { buildIntegrationDetailWidgetSpotId, type IntegrationBundle, type IntegrationDefinition } from '@open-mercato/shared/modules/integrations/types'

export const channelGmailDetailWidgetSpotId = buildIntegrationDetailWidgetSpotId('channel_gmail')

export const integration: IntegrationDefinition = {
  id: 'channel_gmail',
  title: 'Gmail',
  description:
    'Connect per-user Gmail accounts via OAuth2. Outbound via gmail.users.messages.send; inbound via History API polling (5-min default).',
  category: 'communication',
  hub: 'communication_channels',
  providerKey: 'gmail',
  icon: 'gmail',
  docsUrl: 'https://developers.google.com/gmail/api',
  package: '@open-mercato/channel-gmail',
  version: '0.1.0',
  author: 'Open Mercato Team',
  company: 'Open Mercato',
  license: 'MIT',
  tags: ['email', 'gmail', 'oauth2', 'polling', 'communication'],
  detailPage: {
    widgetSpotId: channelGmailDetailWidgetSpotId,
  },
  apiVersions: [
    {
      id: 'v1',
      label: 'Gmail API v1',
      status: 'stable',
      default: true,
      changelog: 'Gmail API v1 with History API incremental sync and OAuth2.',
    },
  ],
  credentials: {
    fields: [
      {
        key: 'clientId',
        label: 'OAuth Client ID',
        type: 'text',
        required: true,
        placeholder: '1234567890-abcdef.apps.googleusercontent.com',
        helpText:
          'Google Cloud Console -> APIs & Services -> Credentials -> OAuth 2.0 Client ID. Configure Authorized Redirect URI to <yourdomain>/api/communication_channels/oauth/gmail/callback.',
      },
      {
        key: 'clientSecret',
        label: 'OAuth Client Secret',
        type: 'secret',
        required: true,
        helpText: 'Paired with the Client ID above. Stored encrypted at rest.',
      },
      {
        key: 'scopes',
        label: 'OAuth Scopes (comma-separated)',
        type: 'text',
        required: false,
        placeholder: 'https://www.googleapis.com/auth/gmail.modify,https://www.googleapis.com/auth/userinfo.email',
        helpText:
          'Defaults to gmail.modify + userinfo.email which is enough for send + receive + label management. Leave blank to use defaults.',
      },
    ],
  },
  healthCheck: { service: 'channelGmailHealthCheck' },
}

export const integrations: IntegrationDefinition[] = [integration]
export const bundles: IntegrationBundle[] = []
export const bundle: IntegrationBundle | undefined = undefined
