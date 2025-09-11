import { notFound } from 'next/navigation'
import { findFrontendMatch } from '@/modules/registry'

export default function SiteCatchAll({ params }: { params: { slug: string[] } }) {
  const pathname = '/' + (params.slug?.join('/') ?? '')
  const match = findFrontendMatch(pathname)
  if (!match) return notFound()
  const Component = match.route.Component as any
  return <Component params={match.params} />
}
