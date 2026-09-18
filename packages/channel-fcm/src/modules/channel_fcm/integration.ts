import {
  type IntegrationBundle,
  type IntegrationDefinition,
} from '@open-mercato/shared/modules/integrations/types'

export const integration: IntegrationDefinition = {
  id: 'channel_fcm',
  title: 'Firebase Cloud Messaging',
  description:
    'Deliver mobile push to Android (and iOS via FCM) devices using Firebase Cloud Messaging. Provider for the push_notifications channel.',
  category: 'communication',
  hub: 'communication_channels',
  providerKey: 'fcm',
  icon: 'firebase',
  docsUrl: 'https://firebase.google.com/docs/cloud-messaging',
  package: '@open-mercato/channel-fcm',
  version: '0.1.0',
  author: 'Open Mercato Team',
  company: 'Open Mercato',
  license: 'MIT',
  tags: ['push', 'fcm', 'firebase', 'android', 'communication'],
  apiVersions: [
    {
      id: 'v1',
      label: 'FCM HTTP v1',
      status: 'stable',
      default: true,
      changelog: 'Firebase Cloud Messaging HTTP v1 via firebase-admin (service-account auth).',
    },
  ],
  credentials: {
    fields: [
      {
        key: 'serviceAccountJson',
        label: 'Service Account JSON',
        type: 'secret',
        required: true,
        helpText:
          'Firebase Console -> Project Settings -> Service Accounts -> Generate New Private Key. Paste the full JSON. Stored encrypted at rest.',
      },
      {
        key: 'appName',
        label: 'App Name (optional)',
        type: 'text',
        required: false,
        helpText: 'Optional label for the Firebase app instance. Leave blank to auto-derive.',
      },
    ],
  },
  healthCheck: { service: 'channelFcmHealthCheck' },
}

export const integrations: IntegrationDefinition[] = [integration]
export const bundles: IntegrationBundle[] = []
export const bundle: IntegrationBundle | undefined = undefined
