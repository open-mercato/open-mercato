import type { AwilixContainer } from 'awilix'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { resolveFeatureCheckContext } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { ProgressJob } from '../data/entities'
import { hasWritableProgressScope, resolveProgressRequestScope } from './requestScope'

export const progressCancelFeatures = ['progress.cancel']

export function createProgressJobMutationPolicy(container: AwilixContainer, auth: NonNullable<AuthContext>) {
  const manageAccessByOrganization = new Map<string | null, Promise<boolean>>()

  return async (job: Pick<ProgressJob, 'startedByUserId' | 'organizationId'>): Promise<boolean> => {
    if (job.startedByUserId === auth.sub) return true
    const organizationId = job.organizationId ?? null
    const knownAccess = manageAccessByOrganization.get(organizationId)
    if (knownAccess) return knownAccess

    const rbac = container.resolve<RbacService>('rbacService')
    const access = rbac.userHasAllFeatures(auth.sub, ['progress.manage'], {
      tenantId: auth.tenantId ?? null,
      organizationId,
    })
    manageAccessByOrganization.set(organizationId, access)
    return access
  }
}

export async function resolveProgressCancellationScope(
  container: AwilixContainer,
  auth: NonNullable<AuthContext>,
  request: Request,
) {
  const cancelRequest = request.clone()
  const { organizationId, scope: featureScope } = await resolveFeatureCheckContext({
    container,
    auth,
    request: cancelRequest,
    requiredFeatures: progressCancelFeatures,
  })
  const rbac = container.resolve<RbacService>('rbacService')
  const hasCancelFeature = await rbac.userHasAllFeatures(auth.sub, progressCancelFeatures, {
    tenantId: featureScope.tenantId ?? auth.tenantId ?? null,
    organizationId,
  })
  if (!hasCancelFeature) return null

  const scope = await resolveProgressRequestScope(container, auth, cancelRequest)
  return hasWritableProgressScope(scope) ? scope : null
}
