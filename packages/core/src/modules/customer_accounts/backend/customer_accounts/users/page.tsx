import { headers } from 'next/headers'
import { resolveRequestOrigin } from '../../../lib/portalUrl'
import { PortalUsersPageClient } from './PortalUsersPageClient'

export default async function CustomerAccountsPage() {
  const portalOrigin = resolveRequestOrigin(await headers())
  return <PortalUsersPageClient portalOrigin={portalOrigin} />
}
