import { makeClientConfigHealthCheck } from '@open-mercato/core/modules/communication_channels/lib/provider-health'
import { microsoftClientCredentialsSchema } from './credentials'

/**
 * Liveness probe for the Microsoft 365 / Outlook integration. The hub resolves
 * it by the service name declared in `integration.ts`
 * (`channelMicrosoftHealthCheck`) and passes the tenant-scoped Azure AD app
 * config (`clientId`, optional `tenantId` / `clientSecret`), NOT per-user channel
 * tokens — so the probe just confirms the app config is well-formed. Public PKCE
 * clients legitimately omit `clientSecret`. Per-user token validity surfaces on
 * the channel itself (`requires_reauth`).
 */
export const channelMicrosoftHealthCheck = makeClientConfigHealthCheck({
  schema: microsoftClientCredentialsSchema,
  providerLabel: 'Microsoft',
  healthyDetails: (parsed) => ({ confidentialClient: Boolean(parsed.clientSecret) }),
})
