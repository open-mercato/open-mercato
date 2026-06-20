import type { AwilixContainer } from 'awilix'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

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
  unregistered?: boolean
}

type AvailabilityAccessResolver = {
  resolveAvailabilityWriteAccess(
    ctx: AvailabilityAccessContext,
  ): Promise<AvailabilityWriteAccess>
}

function buildForbiddenError(translate: TranslateFn) {
  return new CrudHttpError(403, {
    error: translate('planner.availability.errors.unauthorized', 'Unauthorized'),
  })
}

function buildStaffModuleNotLoadedError() {
  return new CrudHttpError(403, { error: 'staff_module_not_loaded' })
}

export async function resolveAvailabilityWriteAccess(
  ctx: AvailabilityAccessContext,
): Promise<AvailabilityWriteAccess> {
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  const resolver = ctx.container.resolve<AvailabilityAccessResolver | undefined>(
    'availabilityAccessResolver',
    { allowUnregistered: true },
  )
  if (!resolver) {
    console.warn(
      '[planner] staff_module_not_loaded — availabilityAccessResolver unregistered; denying availability write access',
    )
    return {
      canManageAll: false,
      canManageSelf: false,
      canManageUnavailability: false,
      memberId: null,
      tenantId,
      organizationId,
      unregistered: true,
    }
  }
  return resolver.resolveAvailabilityWriteAccess(ctx)
}

export async function assertAvailabilityWriteAccess(
  ctx: AvailabilityAccessContext,
  params: { subjectType: string; subjectId: string; requiresUnavailability?: boolean },
  translate: TranslateFn,
): Promise<AvailabilityWriteAccess> {
  const access = await resolveAvailabilityWriteAccess(ctx)
  if (access.unregistered) throw buildStaffModuleNotLoadedError()
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
