import { notFound, redirect } from 'next/navigation'
import { findFrontendMatch } from '@/modules/registry'
import { getAuthFromCookies } from '@/lib/auth/server'

export default function SiteCatchAll({ params }: { params: { slug: string[] } }) {
  const pathname = '/' + (params.slug?.join('/') ?? '')
  const match = findFrontendMatch(pathname)
  if (!match) return notFound()
  if (match.route.requireAuth) {
    const auth = getAuthFromCookies()
    if (!auth) redirect('/login')
  }
  const Component = match.route.Component as any
  return <Component params={match.params} />
}
