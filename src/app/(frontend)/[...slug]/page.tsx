import { notFound } from 'next/navigation'
import { findFrontendRoute } from '@/modules/registry'

export default function SiteCatchAll({ params }: { params: { slug: string[] } }) {
  const pathname = '/' + (params.slug?.join('/') ?? '')
  const route = findFrontendRoute(pathname)
  if (!route) return notFound()
  const Component = route.Component as any
  return <Component params={params} />
}
