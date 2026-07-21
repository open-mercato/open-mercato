import {
  type IntegrationBundle,
  type IntegrationDefinition,
} from '@open-mercato/shared/modules/integrations/types'

export const integration: IntegrationDefinition = {
  id: 'channel_expo',
  title: 'Expo Push',
  description:
    'Deliver mobile push to Expo apps via the Expo push service (ExponentPushToken). Provider for the push_notifications channel.',
  category: 'communication',
  hub: 'communication_channels',
  providerKey: 'expo',
  icon: 'expo',
  docsUrl: 'https://docs.expo.dev/push-notifications/sending-notifications/',
  package: '@open-mercato/channel-expo',
  version: '0.1.0',
  author: 'Open Mercato Team',
  company: 'Open Mercato',
  license: 'MIT',
  tags: ['push', 'expo', 'react-native', 'communication'],
  apiVersions: [
    {
      id: 'v1',
      label: 'Expo Push API',
      status: 'stable',
      default: true,
      changelog: 'Expo push service via expo-server-sdk (ExponentPushToken delivery).',
    },
  ],
  credentials: {
    fields: [
      {
        key: 'accessToken',
        label: 'Expo Access Token (optional)',
        type: 'secret',
        required: false,
        helpText:
          'Only required when Expo enhanced push security is enabled for the project. Expo dashboard -> Account -> Access Tokens. Stored encrypted at rest.',
      },
    ],
  },
  healthCheck: { service: 'channelExpoHealthCheck' },
}

export const integrations: IntegrationDefinition[] = [integration]
export const bundles: IntegrationBundle[] = []
export const bundle: IntegrationBundle | undefined = undefined
