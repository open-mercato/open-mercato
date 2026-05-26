import { buildIntegrationDetailWidgetSpotId, type IntegrationBundle, type IntegrationDefinition } from '@open-mercato/shared/modules/integrations/types'

export const channelMicrosoftDetailWidgetSpotId = buildIntegrationDetailWidgetSpotId('channel_microsoft')

export const integration: IntegrationDefinition = {
  id: 'channel_microsoft',
  title: 'Microsoft 365 / Outlook',
  description:
    'Connect per-user Microsoft 365 / Outlook accounts via Azure AD OAuth2 + PKCE. Outbound via Graph /me/sendMail; inbound via Graph mail-folders delta polling.',
  category: 'communication',
  hub: 'communication_channels',
  providerKey: 'microsoft',
  icon: 'microsoft',
  docsUrl: 'https://learn.microsoft.com/en-us/graph/api/resources/mail-api-overview',
  package: '@open-mercato/channel-microsoft',
  version: '0.1.0',
  author: 'Open Mercato Team',
  company: 'Open Mercato',
  license: 'MIT',
  tags: ['email', 'microsoft', 'outlook', 'oauth2', 'pkce', 'graph', 'polling', 'communication'],
  detailPage: {
    widgetSpotId: channelMicrosoftDetailWidgetSpotId,
  },
  apiVersions: [
    {
      id: 'v1.0',
      label: 'Microsoft Graph v1.0',
      status: 'stable',
      default: true,
      changelog: 'Microsoft Graph v1.0 with mail delta query and OAuth2 v2.0 + PKCE.',
    },
  ],
  credentials: {
    fields: [
      {
        key: 'clientId',
        label: 'Azure AD App (client) ID',
        type: 'text',
        required: true,
        placeholder: '00000000-0000-0000-0000-000000000000',
        helpText:
          'Azure Portal -> App registrations -> Overview. Configure Redirect URI to <yourdomain>/api/communication_channels/oauth/microsoft/callback.',
      },
      {
        key: 'tenantId',
        label: 'Azure AD Tenant ID (or "common" / "consumers" / "organizations")',
        type: 'text',
        required: false,
        placeholder: 'common',
        helpText:
          'Use "common" for multi-tenant + personal Microsoft accounts, "organizations" for any work/school account, "consumers" for MSA only, or a specific tenant GUID. Defaults to "common".',
      },
      {
        key: 'clientSecret',
        label: 'Client Secret (only if your app is configured as a confidential client)',
        type: 'secret',
        required: false,
        helpText:
          'Public clients with PKCE leave this blank. Confidential clients must provide a client secret here. Stored encrypted at rest.',
      },
      {
        key: 'scopes',
        label: 'OAuth Scopes (space-separated)',
        type: 'text',
        required: false,
        placeholder: 'offline_access Mail.Read Mail.Send Mail.ReadWrite User.Read',
        helpText:
          'Defaults to offline_access + Mail.Read + Mail.Send + Mail.ReadWrite + User.Read.',
      },
    ],
  },
  healthCheck: { service: 'channelMicrosoftHealthCheck' },
}

export const integrations: IntegrationDefinition[] = [integration]
export const bundles: IntegrationBundle[] = []
export const bundle: IntegrationBundle | undefined = undefined
