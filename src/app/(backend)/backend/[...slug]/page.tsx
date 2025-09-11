import { notFound } from 'next/navigation'
import { findBackendMatch } from '@/modules/registry'

export default function BackendCatchAll({ params }: { params: { slug: string[] } }) {
  const pathname = '/backend/' + (params.slug?.join('/') ?? '')
  const match = findBackendMatch(pathname)
  if (!match) return notFound()
  const Component = match.route.Component as any
  return <Component params={match.params} />
}
