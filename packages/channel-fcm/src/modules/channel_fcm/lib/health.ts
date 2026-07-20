import { makeClientConfigHealthCheck } from '@open-mercato/core/modules/communication_channels/lib/provider-health'
import { fcmCredentialsSchema } from './credentials'

/**
 * Liveness probe for the FCM integration. The hub passes the tenant-scoped
 * credentials (the service-account JSON), so the probe just confirms they are
 * present and parse into a valid service account — no network call. Per-device
 * token validity surfaces on delivery (`device_unregistered` soft-deletes).
 */
export const channelFcmHealthCheck = makeClientConfigHealthCheck({
  schema: fcmCredentialsSchema,
  providerLabel: 'FCM',
})
