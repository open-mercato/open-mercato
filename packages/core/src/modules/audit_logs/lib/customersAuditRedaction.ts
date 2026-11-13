import type { EntityManager } from '@mikro-orm/postgresql'
import type { ActionLog } from '@open-mercato/core/modules/audit_logs/data/entities'

/** Per-module local soft-resolve helper — see `packages/core/AGENTS.md` § Cross-Module Coupling. */
function tryResolve<T>(resolver: { resolve: <R = unknown>(name: string) => R }, name: string): T | undefined {
  try {
    return resolver.resolve<T>(name)
  } catch {
    return undefined
  }
}

export type CustomersAuditRedactionContext = {
  viewerUserId: string | null
  sharedConversations: unknown[]
  sharedChannelIds: string[]
}

type CustomersAuditRedactionService = {
  loadContext: (
    em: EntityManager,
    scope: { tenantId: string; organizationId: string | null },
    viewerUserId: string | null,
  ) => Promise<CustomersAuditRedactionContext>
  redactEntry: (entry: ActionLog, ctx: CustomersAuditRedactionContext) => ActionLog
}

/**
 * CRM private-email visibility redaction (#8887) is an optional enhancement the
 * `customers` module registers as `customersAuditRedactionService` — this generic
 * audit infrastructure must not statically import CRM business logic (see
 * `packages/core/AGENTS.md` § Cross-Module Coupling). When the module/service is
 * absent there is no CRM data to protect, so entries pass through unredacted.
 */
export async function redactActionLogEntries(
  container: { resolve: <R = unknown>(name: string) => R },
  em: EntityManager,
  scope: { tenantId: string; organizationId: string | null },
  viewerUserId: string | null,
  entries: ActionLog[],
): Promise<ActionLog[]> {
  const service = tryResolve<CustomersAuditRedactionService>(container, 'customersAuditRedactionService')
  if (!service) return entries
  const ctx = await service.loadContext(em, scope, viewerUserId)
  return entries.map((entry) => service.redactEntry(entry, ctx))
}
