import { headers } from 'next/headers'
import { resolveRequestOrigin } from '../../../lib/portalUrl'
import { CustomerAccountsSettingsPageClient } from './CustomerAccountsSettingsPageClient'

export default async function CustomerAccountsSettingsPage() {
  const portalOrigin = resolveRequestOrigin(await headers())
  return <CustomerAccountsSettingsPageClient portalOrigin={portalOrigin} />
}
