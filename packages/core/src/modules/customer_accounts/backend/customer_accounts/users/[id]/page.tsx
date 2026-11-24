import { headers } from 'next/headers'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { resolvePortalRequestOrigin } from '../../../../lib/portalUrl'
import { PortalUserDetailPageClient } from './PortalUserDetailPageClient'

export default async function CustomerUserDetailPage({ params }: { params?: { id?: string } }) {
  const portalOrigin = resolvePortalRequestOrigin(await headers())
  const auth = await getAuthFromCookies()
  let canManage = false
  if (auth) {
    const container = await createRequestContainer()
    const rbac = container.resolve<RbacService>('rbacService')
    canManage = await rbac.userHasAllFeatures(auth.sub, ['customer_accounts.manage'], {
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
    })
  }
  return (
    <Page>
      <PageBody className="space-y-6">
        <PortalUserDetailPageClient key={String(canManage)} params={params} portalOrigin={portalOrigin} canManage={canManage} />
      </PageBody>
    </Page>
  )
}
