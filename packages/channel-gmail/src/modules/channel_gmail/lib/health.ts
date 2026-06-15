import { makeClientConfigHealthCheck } from '@open-mercato/core/modules/communication_channels/lib/provider-health'
import { gmailClientCredentialsSchema } from './credentials'

/**
 * Liveness probe for the Gmail integration. The hub resolves it by the service
 * name declared in `integration.ts` (`channelGmailHealthCheck`) and passes the
 * tenant-scoped OAuth client config (`clientId` / `clientSecret`), NOT per-user
 * channel tokens — so the probe just confirms the client config is well-formed.
 * Per-user token validity surfaces on the channel itself (`requires_reauth`).
 */
export const channelGmailHealthCheck = makeClientConfigHealthCheck({
  schema: gmailClientCredentialsSchema,
  providerLabel: 'Gmail',
})
