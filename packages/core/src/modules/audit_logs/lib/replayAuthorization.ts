import type { EntityManager } from '@mikro-orm/postgresql'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import type { CommandUndoLogEntry } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { isOrganizationAccessAllowed } from '@open-mercato/shared/lib/auth/organizationAccess'
import { isExplicitlyEmptyOrganizationScope } from '@open-mercato/shared/lib/auth/organizationScope'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { resolveOrganizationScope, type OrganizationScope } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { ALL_ORGANIZATIONS_COOKIE_VALUE } from '@open-mercato/core/modules/directory/constants'
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

export function isAuditReplayOrganizationAllowed(input: {
  scope: Pick<OrganizationScope, 'filterIds' | 'allowedIds'>
  organizationId: string | null
  targetOrganizationId: string | null | undefined
  canReplayTenant: boolean
}): boolean {
  if (isExplicitlyEmptyOrganizationScope(input.scope)) return false
  if (!input.targetOrganizationId) return true
  const organizationIds = input.scope.filterIds ?? input.scope.allowedIds
  if (Array.isArray(organizationIds)) {
    return isOrganizationAccessAllowed({
      isSuperAdmin: false,
      allowedOrganizationIds: organizationIds,
      targetOrganizationId: input.targetOrganizationId,
    }) && isOrganizationAccessAllowed({
      isSuperAdmin: false,
      allowedOrganizationIds: input.scope.allowedIds ?? null,
      targetOrganizationId: input.targetOrganizationId,
    })
  }
  return input.targetOrganizationId === input.organizationId
    || (input.canReplayTenant && input.organizationId === null)
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
  if (log.actorUserId && !actionLogBelongsToAuth(log, input.auth) && !canReplayTenant) {
    throw unavailable()
  }
  if (log.tenantId && log.tenantId !== (input.auth.tenantId ?? null)) {
    throw unavailable()
  }

  const scopedOrganizationId = canReplayTenant
    ? input.organizationId
    : input.organizationId ?? input.auth.orgId ?? null
  if (!log.organizationId) return
  const organizationScope = await resolveOrganizationScope({
    em,
    rbac: {
      loadAcl: (userId, aclScope) => rbac.loadAclWithEntityManager(em, userId, aclScope),
    },
    auth: input.auth,
    selectedId: scopedOrganizationId ?? (canReplayTenant ? ALL_ORGANIZATIONS_COOKIE_VALUE : null),
  })
  if (!isAuditReplayOrganizationAllowed({
    scope: organizationScope,
    organizationId: scopedOrganizationId,
    targetOrganizationId: log.organizationId,
    canReplayTenant,
  })) throw unavailable()
}
