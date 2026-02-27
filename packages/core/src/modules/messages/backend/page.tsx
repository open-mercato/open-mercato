import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveFeatureCheckContext } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { cookies } from 'next/headers'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { MessagesInboxPageClient } from '../components/MessagesInboxPageClient'

export default async function MessagesInboxPage() {
  const auth = await getAuthFromCookies()
  let canViewMessages = false

  if (auth) {
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

      if (!Array.isArray(allowedOrganizationIds) || allowedOrganizationIds.length > 0) {
        canViewMessages = await rbac.userHasAllFeatures(auth.sub, ['messages.view'], {
          tenantId: scope.tenantId ?? auth.tenantId ?? null,
          organizationId: organizationId ?? null,
        })
      }
    } catch {
      canViewMessages = false
    }
  }

  return (
    <Page>
      <PageBody>
        <MessagesInboxPageClient canViewMessages={canViewMessages} />
      </PageBody>
    </Page>
  )
}
