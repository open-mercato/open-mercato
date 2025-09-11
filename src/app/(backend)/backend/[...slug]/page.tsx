import { notFound, redirect } from 'next/navigation'
import { findBackendMatch } from '@/modules/registry'
import { getAuthFromCookies } from '@/lib/auth/server'

export default function BackendCatchAll({ params }: { params: { slug: string[] } }) {
  const pathname = '/backend/' + (params.slug?.join('/') ?? '')
  const match = findBackendMatch(pathname)
  if (!match) return notFound()
  if (match.route.requireAuth) {
    const auth = getAuthFromCookies()
    if (!auth) redirect('/login')
  }
  const Component = match.route.Component as any
  return <Component params={match.params} />
}
