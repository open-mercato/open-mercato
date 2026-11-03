import { makePushClientConfigHealthCheck } from '@open-mercato/core/modules/push_notifications/lib/push-health'
import { apnsCredentialsSchema } from './credentials'

/**
 * Liveness probe for the APNs integration. The hub passes the tenant-scoped
 * credentials (.p8 key + key/team/bundle ids), so the probe confirms they are
 * present and well-formed — no network call. Per-device token validity surfaces
 * on delivery (`device_unregistered` soft-deletes).
 */
export const channelApnsHealthCheck = makePushClientConfigHealthCheck({
  schema: apnsCredentialsSchema,
  providerLabel: 'APNs',
})
