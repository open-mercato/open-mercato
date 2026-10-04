import type { EntityManager } from '@mikro-orm/postgresql'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import type { CommandUndoLogEntry } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'

type ReplayAuthorizationInput = {
  auth: NonNullable<AuthContext>
  organizationId: string | null
  selfFeature: string
  tenantFeature: string
  unavailableMessage: string
}

export async function authorizeAuditReplayWithEntityManager(
  em: EntityManager,
  rbac: RbacService,
  log: CommandUndoLogEntry,
  input: ReplayAuthorizationInput,
): Promise<void> {
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
  if (log.actorUserId && log.actorUserId !== input.auth.sub && !canReplayTenant) {
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
