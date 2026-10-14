import type { EntityManager } from '@mikro-orm/postgresql'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import type { CommandUndoLogEntry } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { getOwningModuleId } from '@open-mercato/shared/security/enabledModulesRegistry'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import {
  actionLogBelongsToAuth,
  resolveCanonicalAuthSubject,
} from '@open-mercato/core/modules/audit_logs/lib/actorSubject'

type ReplayAuthorizationInput = {
  auth: NonNullable<AuthContext>
  organizationId: string | null
  selfFeature: string
  tenantFeature: string
  unavailableMessage: string
}

type ReplayModuleAvailabilityReader = Pick<RbacService, 'getUnavailableModuleIds'>

/**
 * A replayed command belongs to the module named by its id. When that module
 * is unavailable to the caller's tenant (per-tenant module availability), the
 * undo or redo is refused like any other feature of the module.
 */
export async function isReplayCommandModuleAvailable(
  rbac: Partial<ReplayModuleAvailabilityReader>,
  commandId: string | null | undefined,
  auth: NonNullable<AuthContext>,
): Promise<boolean> {
  if (!commandId || typeof rbac.getUnavailableModuleIds !== 'function') return true
  const unavailableModuleIds = await rbac.getUnavailableModuleIds(auth.tenantId ?? null, auth.sub)
  if (!unavailableModuleIds.length) return true
  return !unavailableModuleIds.includes(getOwningModuleId(commandId))
}

export async function authorizeAuditReplayWithEntityManager(
  em: EntityManager,
  rbac: RbacService,
  log: CommandUndoLogEntry,
  input: ReplayAuthorizationInput,
): Promise<void> {
  if (!resolveCanonicalAuthSubject(input.auth)) {
    throw new CrudHttpError(400, { error: input.unavailableMessage })
  }
  const scope = {
    tenantId: input.auth.tenantId ?? null,
    organizationId: input.organizationId,
  }
  const canReplaySelf = await rbac.userHasAllFeaturesWithEntityManager(
    em,
    input.auth.sub,
    [input.selfFeature],
    scope,
  )
  const canReplayTenant = await rbac.userHasAllFeaturesWithEntityManager(
    em,
    input.auth.sub,
    [input.tenantFeature],
    scope,
  )
  const unavailable = () => new CrudHttpError(400, { error: input.unavailableMessage })

  if (!canReplaySelf) throw unavailable()
  if (!(await isReplayCommandModuleAvailable(rbac, log.commandId, input.auth))) throw unavailable()
  if (log.actorUserId && !actionLogBelongsToAuth(log, input.auth) && !canReplayTenant) {
    throw unavailable()
  }
  if (log.tenantId && log.tenantId !== (input.auth.tenantId ?? null)) {
    throw unavailable()
  }

  const scopedOrganizationId = canReplayTenant
    ? input.organizationId
    : input.organizationId ?? input.auth.orgId ?? null
  const organizationMismatch = canReplayTenant
    ? Boolean(log.organizationId && scopedOrganizationId && log.organizationId !== scopedOrganizationId)
    : Boolean(log.organizationId && log.organizationId !== scopedOrganizationId)
  if (organizationMismatch) throw unavailable()
}
