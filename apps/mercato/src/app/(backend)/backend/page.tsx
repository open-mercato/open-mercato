import { getAuthFromCookies } from '@/lib/auth/server'
import { redirect } from 'next/navigation'
import { DashboardScreen } from '@open-mercato/ui/backend/dashboard'

export default async function BackendIndex() {
  const auth = await getAuthFromCookies()
  if (!auth) redirect('/api/auth/session/refresh?redirect=/backend')
  return (
    <div className="p-6 space-y-6">
      <DashboardScreen />
    </div>
  )
}
