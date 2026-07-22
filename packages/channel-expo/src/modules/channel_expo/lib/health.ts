import { makePushClientConfigHealthCheck } from '@open-mercato/core/modules/push_notifications/lib/push-health'
import { expoCredentialsSchema } from './credentials'

/**
 * Liveness probe for the Expo integration. Expo credentials are minimal (an
 * optional access token), so the probe just confirms the stored config is
 * well-formed — no network call. Per-device token validity surfaces on delivery
 * (`device_unregistered` soft-deletes).
 */
export const channelExpoHealthCheck = makePushClientConfigHealthCheck({
  schema: expoCredentialsSchema,
  providerLabel: 'Expo',
})
