import { headers } from 'next/headers'
import { PayPage, type PayLinkPayload } from '../../../components/PayPage'

function resolveTrustedAppUrl(requestHeaders: Headers): string | null {
  const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL
  if (appUrl && appUrl.trim().length > 0) {
    return appUrl.replace(/\/$/, '')
  }
  const host = requestHeaders.get('host')
  if (!host || host.trim().length === 0) return null
  const protocol = requestHeaders.get('x-forwarded-proto') ?? 'http'
  return `${protocol}://${host}`.replace(/\/$/, '')
}

function buildInternalRequestHeaders(requestHeaders: Headers): HeadersInit | undefined {
  const forwardedHeaders = new Headers()
  const cookie = requestHeaders.get('cookie')
  const forwardedFor = requestHeaders.get('x-forwarded-for')
  const realIp = requestHeaders.get('x-real-ip')

  if (cookie) forwardedHeaders.set('cookie', cookie)
  if (forwardedFor) forwardedHeaders.set('x-forwarded-for', forwardedFor)
  if (realIp) forwardedHeaders.set('x-real-ip', realIp)

  return Array.from(forwardedHeaders.keys()).length > 0 ? forwardedHeaders : undefined
}

async function loadInitialPayload(
  slug: string,
  options?: { preview?: boolean },
): Promise<{ payload: PayLinkPayload | null; error: string | null }> {
  const requestHeaders = await headers()
  const baseUrl = resolveTrustedAppUrl(requestHeaders)
  if (!baseUrl) {
    return { payload: null, error: null }
  }
  const searchParams = new URLSearchParams()
  if (options?.preview) {
    searchParams.set('preview', 'true')
  }
  const requestUrl = `${baseUrl}/api/checkout/pay/${encodeURIComponent(slug)}${searchParams.size > 0 ? `?${searchParams.toString()}` : ''}`
  try {
    const response = await fetch(requestUrl, {
      headers: buildInternalRequestHeaders(requestHeaders),
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
