import { headers } from 'next/headers'
import { PayPage, type PayLinkPayload } from '../../../../../components/PayPage'
import { resolveTrustedAppBaseUrl } from '../../../../../lib/trustedAppBaseUrl'

async function loadInitialTemplatePreview(id: string): Promise<{ payload: PayLinkPayload | null; error: string | null }> {
  const baseUrl = resolveTrustedAppBaseUrl()
  if (!baseUrl) {
    return { payload: null, error: null }
  }
  const requestHeaders = await headers()
  const cookie = requestHeaders.get('cookie') ?? ''
  try {
    const response = await fetch(`${baseUrl}/api/checkout/templates/${encodeURIComponent(id)}/preview`, {
      headers: cookie ? { cookie } : undefined,
      cache: 'no-store',
      redirect: 'error',
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

export default async function CheckoutTemplatePreviewPage({ params }: { params: Promise<{ id: string }> | { id: string } }) {
  const resolvedParams = await params
  const initial = await loadInitialTemplatePreview(resolvedParams.id)
  return <PayPage mode="template" sourceId={resolvedParams.id} initialPayload={initial.payload} initialLoadError={initial.error} />
}
