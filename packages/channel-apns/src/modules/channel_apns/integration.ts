import {
  type IntegrationBundle,
  type IntegrationDefinition,
} from '@open-mercato/shared/modules/integrations/types'

export const integration: IntegrationDefinition = {
  id: 'channel_apns',
  title: 'Apple Push Notification service',
  description:
    'Deliver mobile push to iOS devices via APNs (HTTP/2, token-based .p8 auth). Provider for the push_notifications channel.',
  category: 'communication',
  hub: 'communication_channels',
  providerKey: 'apns',
  icon: 'apple',
  docsUrl: 'https://developer.apple.com/documentation/usernotifications',
  package: '@open-mercato/channel-apns',
  version: '0.1.0',
  author: 'Open Mercato Team',
  company: 'Open Mercato',
  license: 'MIT',
  tags: ['push', 'apns', 'apple', 'ios', 'communication'],
  apiVersions: [
    {
      id: 'v1',
      label: 'APNs HTTP/2 (token auth)',
      status: 'stable',
      default: true,
      changelog: 'Apple Push Notification service over HTTP/2 with token-based .p8 auth (@parse/node-apn).',
    },
  ],
  credentials: {
    fields: [
      {
        key: 'p8Key',
        label: 'APNs Auth Key (.p8)',
        type: 'secret',
        required: true,
        helpText:
          'Apple Developer -> Keys -> create an APNs key, download the .p8, and paste its contents here. Stored encrypted at rest.',
      },
      {
        key: 'keyId',
        label: 'Key ID',
        type: 'text',
        required: true,
        helpText: 'The 10-character identifier of the APNs key (from the key filename / Apple Developer portal).',
      },
      {
        key: 'teamId',
        label: 'Apple Team ID',
        type: 'text',
        required: true,
        helpText: 'Your 10-character Apple Developer Team ID.',
      },
      {
        key: 'bundleId',
        label: 'App Bundle ID',
        type: 'text',
        required: true,
        placeholder: 'com.example.app',
        helpText: 'The app bundle id, used as the APNs topic.',
      },
      {
        key: 'production',
        label: 'Production (use production APNs host)',
        type: 'boolean',
        required: false,
        helpText: 'Leave off for the sandbox host during development.',
      },
    ],
  },
  healthCheck: { service: 'channelApnsHealthCheck' },
}

export const integrations: IntegrationDefinition[] = [integration]
export const bundles: IntegrationBundle[] = []
export const bundle: IntegrationBundle | undefined = undefined
