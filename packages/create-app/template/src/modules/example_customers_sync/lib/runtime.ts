import type { EntityManager } from '@mikro-orm/postgresql'
import { DefaultDataEngine, type DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'

export type ExampleCustomersSyncScope = {
  tenantId: string
  organizationId: string
}

export const EXAMPLE_CUSTOMERS_SYNC_OUTBOUND_ORIGIN = 'example_customers_sync:outbound'
export const EXAMPLE_CUSTOMERS_SYNC_INBOUND_ORIGIN = 'example_customers_sync:inbound'

type AnyContainer = { resolve: <T = unknown>(name: string) => T }

// Each sync invocation gets its own forked EM + fresh DataEngine so that
// concurrent or sequential jobs cannot pollute the shared identity map.
// Without this, two outbound jobs targeting the same interaction.id would
// both add an INSERT for the same Todo into the shared UoW, and the second
// flush (inside setRecordCustomFields) would fail with todos_pkey duplicate.
export function createScopedSyncContainer(container: AnyContainer): AnyContainer {
  const baseEm = container.resolve('em') as EntityManager
  const scopedEm = baseEm.fork({ clear: true })
  let scopedDataEngine: DataEngine | null = null
  return {
    resolve<T = unknown>(name: string): T {
      if (name === 'em') return scopedEm as unknown as T
      if (name === 'dataEngine') {
        if (!scopedDataEngine) {
          scopedDataEngine = new DefaultDataEngine(scopedEm, container as never)
        }
        return scopedDataEngine as unknown as T
      }
      return container.resolve<T>(name)
    },
  }
}

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
