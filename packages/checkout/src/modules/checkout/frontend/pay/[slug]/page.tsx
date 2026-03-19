import { headers } from 'next/headers'
import { PayPage, type PayLinkPayload } from '../../../components/PayPage'

async function loadInitialPayload(slug: string): Promise<{ payload: PayLinkPayload | null; error: string | null }> {
  const requestHeaders = await headers()
  const host = requestHeaders.get('host')
  if (!host) {
    return { payload: null, error: 'Missing host header' }
  }
  const protocol = requestHeaders.get('x-forwarded-proto') ?? 'http'
  const cookie = requestHeaders.get('cookie') ?? ''
  try {
    const response = await fetch(`${protocol}://${host}/api/checkout/pay/${encodeURIComponent(slug)}`, {
      headers: cookie ? { cookie } : undefined,
      cache: 'no-store',
    })
    const payload = await response.json().catch(() => null) as PayLinkPayload | { error?: string } | null
    if (!response.ok) {
      return {
        payload: null,
        error: payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
          ? payload.error
          : `Request failed (${response.status})`,
      }
    }
    return { payload: payload as PayLinkPayload, error: null }
  } catch (error) {
    return { payload: null, error: error instanceof Error ? error.message : 'Unexpected error' }
  }
}

export default async function CheckoutPublicPayPage({ params }: { params: Promise<{ slug: string }> | { slug: string } }) {
  const resolvedParams = await params
  const initial = await loadInitialPayload(resolvedParams.slug)
  return <PayPage sourceId={resolvedParams.slug} initialPayload={initial.payload} initialLoadError={initial.error} />
}
