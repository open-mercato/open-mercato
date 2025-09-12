import { notFound, redirect } from 'next/navigation'
import { findBackendMatch } from '@/modules/registry'
import { getAuthFromCookies } from '@/lib/auth/server'

export default async function BackendCatchAll({ params }: { params: Promise<{ slug: string[] }> }) {
  const p = await params
  const pathname = '/backend/' + (p.slug?.join('/') ?? '')
  const match = findBackendMatch(pathname)
  if (!match) return notFound()
  if (match.route.requireAuth) {
    const auth = await getAuthFromCookies()
    if (!auth) redirect('/api/auth/session/refresh?redirect=' + encodeURIComponent(pathname))
    const required = match.route.requireRoles || []
    if (required.length) {
      const roles = auth.roles || []
      const ok = required.some(r => roles.includes(r))
      if (!ok) redirect('/login?requireRole=' + encodeURIComponent(required.join(',')))
    }
  }
  const Component = match.route.Component as any
  return <Component params={match.params} />
}
