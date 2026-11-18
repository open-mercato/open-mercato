import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'

export type TrustedSalesScope = { tenantId: string; organizationId: string }

export function buildTrustedSalesContext(
  container: AwilixContainer,
  scope: TrustedSalesScope,
  options: { transactionalEm?: EntityManager } = {},
): CommandRuntimeContext {
  const ctx: CommandRuntimeContext = {
    container,
    auth: null,
    systemActor: true,
    organizationScope: {
      tenantId: scope.tenantId,
      selectedId: scope.organizationId,
      filterIds: [scope.organizationId],
      allowedIds: [scope.organizationId],
    },
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
  }
  if (options.transactionalEm) ctx.transactionalEm = options.transactionalEm
  return ctx
}
