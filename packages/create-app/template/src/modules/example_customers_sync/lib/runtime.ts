import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'

export type ExampleCustomersSyncScope = {
  tenantId: string
  organizationId: string
}

export const EXAMPLE_CUSTOMERS_SYNC_OUTBOUND_ORIGIN = 'example_customers_sync:outbound'
export const EXAMPLE_CUSTOMERS_SYNC_INBOUND_ORIGIN = 'example_customers_sync:inbound'

export function buildExampleCustomersSyncCommandContext(
  container: { resolve: <T = unknown>(name: string) => T },
  scope: ExampleCustomersSyncScope,
  syncOrigin: string,
): CommandRuntimeContext {
  return {
    container: container as CommandRuntimeContext['container'],
    auth: {
      sub: `system:${syncOrigin}`,
      tenantId: scope.tenantId,
      orgId: scope.organizationId,
      userId: `system:${syncOrigin}`,
    },
    organizationScope: null,
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
    syncOrigin,
  }
}
