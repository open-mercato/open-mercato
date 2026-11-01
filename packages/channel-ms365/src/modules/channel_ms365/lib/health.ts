import { makeClientConfigHealthCheck } from '@open-mercato/core/modules/communication_channels/lib/provider-health'
import { ms365ClientCredentialsSchema } from './credentials'

/**
 * Liveness probe for the Microsoft 365 integration. The hub resolves it by the
 * service name declared in `integration.ts` (`channelMs365HealthCheck`) and
 * passes the tenant-scoped OAuth client config (`clientId` / `clientSecret` /
 * `tenantId`), NOT per-user channel tokens — so the probe just confirms the
 * client config is well-formed. Per-user token validity surfaces on the channel
 * itself (`requires_reauth`).
 */
export const channelMs365HealthCheck = makeClientConfigHealthCheck({
  schema: ms365ClientCredentialsSchema,
  providerLabel: 'Microsoft 365',
  healthyDetails: (parsed) => ({ tenantId: parsed.tenantId }),
})
