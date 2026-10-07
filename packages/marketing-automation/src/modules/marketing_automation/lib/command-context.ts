import type { AwilixContainer } from 'awilix'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'

/**
 * The command context a campaign step writes under.
 *
 * `auth: null` with `systemActor: true` rather than an impersonated user: a campaign acts on
 * its own behalf, and attributing its writes to whoever happened to author the campaign would
 * put the wrong actor in the audit log. Copied from the shape the warranty-claims SLA sweep
 * uses for exactly the same reason.
 */
export function buildCampaignCommandContext(
  container: AwilixContainer,
  scope: { tenantId: string; organizationId: string },
): CommandRuntimeContext {
  return {
    container,
    auth: null,
    organizationScope: null,
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
    systemActor: true,
  }
}
