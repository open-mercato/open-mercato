import { notFound } from 'next/navigation'
import { findFrontendRoute } from '@/modules/registry'

export default async function SiteCatchAll({ params }: { params: { slug: string[] } }) {
  const pathname = '/' + (params.slug?.join('/') ?? '')
  const route = findFrontendRoute(pathname)
  if (!route) return notFound()
  return <>{await route.Component({ params })}</>
}

