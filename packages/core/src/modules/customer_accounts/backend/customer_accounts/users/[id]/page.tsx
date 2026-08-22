import { headers } from 'next/headers'
import { resolveRequestOrigin } from '../../../../lib/portalUrl'
import { PortalUserDetailPageClient } from './PortalUserDetailPageClient'

export default async function CustomerUserDetailPage({ params }: { params?: { id?: string } }) {
  const portalOrigin = resolveRequestOrigin(await headers())
  return <PortalUserDetailPageClient params={params} portalOrigin={portalOrigin} />
}
