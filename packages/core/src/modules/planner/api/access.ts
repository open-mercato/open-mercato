import type { AwilixContainer } from 'awilix'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { StaffTeamMember } from '@open-mercato/core/modules/staff/data/entities'

type TranslateFn = (key: string, fallback?: string) => string

export type AvailabilityAccessContext = {
  container: AwilixContainer
  auth: AuthContext | null
  selectedOrganizationId?: string | null
}

export type AvailabilityWriteAccess = {
  canManageAll: boolean
  canManageSelf: boolean
  canManageUnavailability: boolean
  memberId: string | null
  tenantId: string | null
  organizationId: string | null
}

const MANAGE_AVAILABILITY_FEATURE = 'planner.manage_availability'
const SELF_MANAGE_FEATURE = 'staff.my_availability.manage'
const SELF_UNAVAILABILITY_FEATURE = 'staff.my_availability.unavailability'

function buildForbiddenError(translate: TranslateFn) {
  return new CrudHttpError(403, { error: translate('planner.availability.errors.unauthorized', 'Unauthorized') })
}

export async function resolveAvailabilityWriteAccess(ctx: AvailabilityAccessContext): Promise<AvailabilityWriteAccess> {
  const auth = ctx.auth
  const tenantId = auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? auth?.orgId ?? null
  if (!auth || !auth.sub || auth.isApiKey) {
    return {
      canManageAll: false,
      canManageSelf: false,
      canManageUnavailability: false,
      memberId: null,
      tenantId,
      organizationId,
    }
  }
  const rbac = ctx.container.resolve('rbacService') as RbacService
  const canManageAll = await rbac.userHasAllFeatures(auth.sub, [MANAGE_AVAILABILITY_FEATURE], { tenantId, organizationId })
  if (canManageAll) {
    return {
      canManageAll: true,
      canManageSelf: true,
      canManageUnavailability: true,
      memberId: null,
      tenantId,
      organizationId,
    }
  }
  const [canManageSelf, canManageUnavailability] = await Promise.all([
    rbac.userHasAllFeatures(auth.sub, [SELF_MANAGE_FEATURE], { tenantId, organizationId }),
    rbac.userHasAllFeatures(auth.sub, [SELF_UNAVAILABILITY_FEATURE], { tenantId, organizationId }),
  ])
  if (!canManageSelf) {
    return {
      canManageAll: false,
      canManageSelf: false,
      canManageUnavailability: false,
      memberId: null,
      tenantId,
      organizationId,
    }
  }
  const em = ctx.container.resolve('em') as EntityManager
  const member = await findOneWithDecryption(
    em,
    StaffTeamMember,
    { userId: auth.sub, deletedAt: null },
    undefined,
    { tenantId, organizationId },
  )
  return {
    canManageAll: false,
    canManageSelf,
    canManageUnavailability,
    memberId: member?.id ?? null,
    tenantId,
    organizationId,
  }
}

export async function assertAvailabilityWriteAccess(
  ctx: AvailabilityAccessContext,
  params: { subjectType: string; subjectId: string; requiresUnavailability?: boolean },
  translate: TranslateFn,
): Promise<AvailabilityWriteAccess> {
  const access = await resolveAvailabilityWriteAccess(ctx)
  if (access.canManageAll) return access
  if (!access.canManageSelf) throw buildForbiddenError(translate)
  if (!access.memberId || params.subjectType !== 'member' || params.subjectId !== access.memberId) {
    throw buildForbiddenError(translate)
  }
  if (params.requiresUnavailability && !access.canManageUnavailability) {
    throw buildForbiddenError(translate)
  }
  return access
}
