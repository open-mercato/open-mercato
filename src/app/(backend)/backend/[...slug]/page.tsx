import { notFound, redirect } from 'next/navigation'
import { findBackendMatch } from '@/modules/registry'
import { getAuthFromCookies } from '@/lib/auth/server'

export default async function BackendCatchAll({ params }: { params: { slug: string[] } }) {
  const pathname = '/backend/' + (params.slug?.join('/') ?? '')
  const match = findBackendMatch(pathname)
  if (!match) return notFound()
  if (match.route.requireAuth) {
    const auth = await getAuthFromCookies()
    if (!auth) redirect('/login')
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
