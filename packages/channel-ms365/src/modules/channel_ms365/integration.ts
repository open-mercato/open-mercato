import { buildIntegrationDetailWidgetSpotId, type IntegrationBundle, type IntegrationDefinition } from '@open-mercato/shared/modules/integrations/types'

export const channelMs365DetailWidgetSpotId = buildIntegrationDetailWidgetSpotId('channel_ms365')

export const integration: IntegrationDefinition = {
  id: 'channel_ms365',
  title: 'Microsoft 365',
  description:
    'Connect per-user Microsoft 365 / Exchange Online mailboxes via Entra ID OAuth2. Outbound and inbound go through Microsoft Graph; inbound uses Inbox delta polling (5-min default).',
  category: 'communication',
  hub: 'communication_channels',
  providerKey: 'ms365',
  icon: 'mail',
  docsUrl: 'https://learn.microsoft.com/graph/api/resources/mail-api-overview',
  package: '@open-mercato/channel-ms365',
  version: '0.7.0',
  author: 'Open Mercato Team',
  company: 'Open Mercato',
  license: 'MIT',
  tags: ['email', 'microsoft', 'ms365', 'outlook', 'graph', 'oauth2', 'polling', 'communication'],
  detailPage: {
    widgetSpotId: channelMs365DetailWidgetSpotId,
  },
  apiVersions: [
    {
      id: 'v1.0',
      label: 'Microsoft Graph v1.0',
      status: 'stable',
      default: true,
      changelog: 'Microsoft Graph v1.0 mail API with Inbox delta sync and Entra ID OAuth2 (v2.0 endpoints, PKCE).',
    },
  ],
  credentials: {
    fields: [
      {
        key: 'clientId',
        label: 'Application (client) ID',
        type: 'text',
        required: true,
        placeholder: '00000000-0000-0000-0000-000000000000',
        helpText:
          'Entra admin center -> App registrations -> your app -> Overview. Add a Web redirect URI of <yourdomain>/api/communication_channels/oauth/ms365/callback and delegated Graph permissions Mail.ReadWrite, Mail.Send, User.Read, offline_access.',
      },
      {
        key: 'clientSecret',
        label: 'Client secret',
        type: 'secret',
        required: true,
        helpText: 'Certificates & secrets -> New client secret -> copy the secret VALUE (not the ID). Stored encrypted at rest.',
      },
      {
        key: 'tenantId',
        label: 'Directory (tenant) ID',
        type: 'text',
        required: false,
        placeholder: 'organizations',
        helpText:
          'Leave blank for "organizations" (work/school accounts from any directory; personal Microsoft accounts are rejected). Enter your directory GUID or verified domain to allow only your own directory, or "common" to also accept personal accounts.',
      },
      {
        key: 'scopes',
        label: 'OAuth scopes (space or comma-separated)',
        type: 'text',
        required: false,
        placeholder: 'offline_access openid profile email https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/User.Read',
        helpText:
          'Defaults cover send + receive + profile lookup. Leave blank to use defaults; offline_access is always added because refresh tokens require it.',
      },
    ],
  },
  healthCheck: { service: 'channelMs365HealthCheck' },
}

export const integrations: IntegrationDefinition[] = [integration]
export const bundles: IntegrationBundle[] = []
export const bundle: IntegrationBundle | undefined = undefined
