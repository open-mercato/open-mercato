import { headers } from 'next/headers'
import { PayPage, type PayLinkPayload } from '../../../components/PayPage'

async function loadInitialPayload(
  slug: string,
  options?: { preview?: boolean },
): Promise<{ payload: PayLinkPayload | null; error: string | null }> {
  const requestHeaders = await headers()
  const host = requestHeaders.get('host')
  if (!host) {
    return { payload: null, error: 'Missing host header' }
  }
  const protocol = requestHeaders.get('x-forwarded-proto') ?? 'http'
  const cookie = requestHeaders.get('cookie') ?? ''
  const searchParams = new URLSearchParams()
  if (options?.preview) {
    searchParams.set('preview', 'true')
  }
  const requestUrl = `${protocol}://${host}/api/checkout/pay/${encodeURIComponent(slug)}${searchParams.size > 0 ? `?${searchParams.toString()}` : ''}`
  try {
    const response = await fetch(requestUrl, {
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

export default async function CheckoutPublicPayPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }> | { slug: string }
  searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>
}) {
  const resolvedParams = await params
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const previewValue = resolvedSearchParams?.preview
  const preview = Array.isArray(previewValue)
    ? previewValue.includes('true')
    : previewValue === 'true'
  const initial = await loadInitialPayload(resolvedParams.slug, { preview })
  return <PayPage sourceId={resolvedParams.slug} initialPayload={initial.payload} initialLoadError={initial.error} />
}
