import { cookies } from 'next/headers'
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveFeatureCheckContext } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'

export async function resolveCanViewMessagesForCurrentUser(): Promise<boolean> {
  const auth = await getAuthFromCookies()
  if (!auth) return false

  try {
    const cookieStore = await cookies()
    const rawSelectedOrg = cookieStore.get('om_selected_org')?.value
    const rawSelectedTenant = cookieStore.get('om_selected_tenant')?.value
    const selectedOrgForScope = rawSelectedOrg === undefined
      ? undefined
      : rawSelectedOrg && rawSelectedOrg.trim().length > 0
        ? rawSelectedOrg
        : null
    const selectedTenantForScope = rawSelectedTenant === undefined
      ? undefined
      : rawSelectedTenant && rawSelectedTenant.trim().length > 0
        ? rawSelectedTenant
        : null

    const container = await createRequestContainer()
    const rbac = container.resolve<RbacService>('rbacService')
    const { organizationId, scope, allowedOrganizationIds } = await resolveFeatureCheckContext({
      container,
      auth,
      selectedId: selectedOrgForScope,
      tenantId: selectedTenantForScope,
    })

    if (Array.isArray(allowedOrganizationIds) && allowedOrganizationIds.length === 0) {
      return false
    }

    return await rbac.userHasAllFeatures(auth.sub, ['messages.view'], {
      tenantId: scope.tenantId ?? auth.tenantId ?? null,
      organizationId: organizationId ?? null,
    })
  } catch {
    return false
  }
}
