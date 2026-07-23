import { buildIntegrationDetailWidgetSpotId, type IntegrationBundle, type IntegrationDefinition } from '@open-mercato/shared/modules/integrations/types'

export const channelDiscordDetailWidgetSpotId = buildIntegrationDetailWidgetSpotId('channel_discord')

export const integration: IntegrationDefinition = {
  id: 'channel_discord',
  title: 'Discord',
  description:
    'Connect a Discord bot as a two-way channel. Outbound via the Discord REST API; inbound in real time via a Gateway worker; slash commands / buttons via a signed (Ed25519) Interactions endpoint. Optionally answers inbound messages with an AI agent.',
  category: 'communication',
  hub: 'communication_channels',
  providerKey: 'discord',
  icon: 'discord',
  docsUrl: 'https://discord.com/developers/docs/intro',
  package: '@open-mercato/channel-discord',
  version: '0.1.0',
  author: 'Open Mercato Team',
  company: 'Open Mercato',
  license: 'MIT',
  tags: ['discord', 'chat', 'bot', 'gateway', 'communication', 'ai'],
  detailPage: {
    widgetSpotId: channelDiscordDetailWidgetSpotId,
  },
  apiVersions: [
    {
      id: 'v10',
      label: 'Discord API v10',
      status: 'stable',
      default: true,
      changelog: 'Discord API v10 (REST) + Gateway v10 real-time inbound + Ed25519-signed Interactions.',
    },
  ],
  credentials: {
    fields: [
      {
        key: 'botToken',
        label: 'Bot token',
        type: 'secret',
        required: true,
        helpText:
          'Developer Portal -> Applications -> your app -> Bot -> Reset Token. Grants full control of the bot user. Stored encrypted at rest; never logged.',
      },
      {
        key: 'applicationId',
        label: 'Application ID',
        type: 'text',
        required: true,
        placeholder: '123456789012345678',
        helpText: 'Developer Portal -> General Information -> Application ID. Used to register slash commands.',
      },
      {
        key: 'publicKey',
        label: 'Public key',
        type: 'text',
        required: true,
        placeholder: '64-character hex Ed25519 public key',
        helpText:
          'Developer Portal -> General Information -> Public Key. Verifies signed interaction requests (slash commands, buttons).',
      },
      {
        key: 'guildId',
        label: 'Guild (server) ID',
        type: 'text',
        required: false,
        placeholder: '123456789012345678',
        helpText: 'Recommended: scope the bot to a single server. Enable Developer Mode in Discord, right-click the server, Copy Server ID.',
      },
      {
        key: 'defaultChannelId',
        label: 'Default channel ID',
        type: 'text',
        required: false,
        placeholder: '123456789012345678',
        helpText: 'Default text channel for outbound sends and the test-send smoke test.',
      },
    ],
  },
  healthCheck: { service: 'channelDiscordHealthCheck' },
}

export const integrations: IntegrationDefinition[] = [integration]
export const bundles: IntegrationBundle[] = []
export const bundle: IntegrationBundle | undefined = undefined
