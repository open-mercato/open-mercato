import { buildIntegrationDetailWidgetSpotId, type IntegrationBundle, type IntegrationDefinition } from '@open-mercato/shared/modules/integrations/types'

export const channelDiscordDetailWidgetSpotId = buildIntegrationDetailWidgetSpotId('channel_discord')

export const integration: IntegrationDefinition = {
  id: 'channel_discord',
  title: 'Discord',
  // Kept within the 68–132 character range the six sibling providers occupy: the
  // card grid gives every description the same fixed box, so a long one inflates
  // its whole row. The operational caveats it used to carry (gateway worker,
  // queue strategy, no AI auto-reply) belong on the detail page and in the
  // credential help texts, which is where they now live.
  description: 'Two-way Discord bot channel: REST outbound, real-time Gateway inbound, signed slash-command endpoint.',
  category: 'communication',
  hub: 'communication_channels',
  providerKey: 'discord',
  icon: 'discord',
  docsUrl: 'https://discord.com/developers/docs/intro',
  package: '@open-mercato/channel-discord',
  // The provider descriptor's own version, deliberately independent of the
  // monorepo release the package happens to ship in — a copied monorepo version
  // rots on every release bump and reads as a claim it is not making.
  version: '1.0.0',
  author: 'Open Mercato Team',
  company: 'Open Mercato',
  license: 'MIT',
  tags: ['discord', 'chat', 'bot', 'gateway', 'communication'],
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
          'Developer Portal → Applications → your app → Bot → Reset Token. Grants full control of the bot user. Stored encrypted at rest; never logged.',
      },
      {
        key: 'applicationId',
        label: 'Application ID',
        type: 'text',
        required: true,
        placeholder: '123456789012345678',
        helpText: 'Developer Portal → General Information → Application ID. Used to register slash commands.',
      },
      {
        key: 'publicKey',
        label: 'Public key',
        type: 'text',
        required: true,
        placeholder: '64-character hex Ed25519 public key',
        helpText:
          'Developer Portal → General Information → Public Key. Verifies signed interaction requests (slash commands, buttons).',
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
        helpText:
          'Default text channel the adapter posts to when an outbound message names no Discord channel. The hub'
          + ' test-send endpoint accepts a channel snowflake as its recipient, so you can use it to verify this end to end.',
      },
    ],
  },
  healthCheck: { service: 'channelDiscordHealthCheck' },
}

export const integrations: IntegrationDefinition[] = [integration]
export const bundles: IntegrationBundle[] = []
export const bundle: IntegrationBundle | undefined = undefined
