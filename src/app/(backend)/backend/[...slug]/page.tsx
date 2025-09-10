import { notFound } from 'next/navigation'
import { findBackendRoute } from '@/modules/registry'

export default function BackendCatchAll({ params }: { params: { slug: string[] } }) {
  const pathname = '/backend/' + (params.slug?.join('/') ?? '')
  const route = findBackendRoute(pathname)
  if (!route) return notFound()
  const Component = route.Component as any
  return <Component params={params} />
}
