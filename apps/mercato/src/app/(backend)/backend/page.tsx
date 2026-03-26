import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { redirect } from 'next/navigation'
import { DashboardScreen } from '@open-mercato/ui/backend/dashboard'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolvePageMiddlewareRedirect } from '@open-mercato/shared/lib/middleware/page-executor'
import { backendMiddlewareEntries } from '@/.mercato/generated/backend-middleware.generated'

export default async function BackendIndex() {
  const auth = await getAuthFromCookies()
  if (!auth) redirect('/api/auth/session/refresh?redirect=/backend')
  let container: Awaited<ReturnType<typeof createRequestContainer>> | null = null
  const ensureContainer = async () => {
    if (!container) {
      container = await createRequestContainer()
    }
    return container
  }
  const middlewareRedirect = await resolvePageMiddlewareRedirect({
    entries: backendMiddlewareEntries,
    context: {
      pathname: '/backend',
      mode: 'backend',
      routeMeta: { requireAuth: true },
      auth,
      ensureContainer,
    },
  })
  if (middlewareRedirect) redirect(middlewareRedirect)
  return (
    <div className="p-6 space-y-6">
      <DashboardScreen />
    </div>
  )
}
