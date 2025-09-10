import { notFound } from 'next/navigation'
import { findBackendRoute } from '@/modules/registry'

export default async function BackendCatchAll({ params }: { params: { slug?: string[] } }) {
  const pathname = '/backend/' + (params.slug?.join('/') ?? '')
  const route = findBackendRoute(pathname)
  if (!route) return notFound()
  return <>{await route.Component({ params })}</>
}
