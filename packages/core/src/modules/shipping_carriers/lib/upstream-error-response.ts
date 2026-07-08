import { NextResponse } from 'next/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

const upstreamFailedKey = 'shipping_carriers.errors.upstreamFailed'
const upstreamFailedFallback = 'Carrier provider request failed. Try again later.'

export async function shippingCarrierUpstreamErrorResponse(routeId: string, error: unknown) {
  console.error(`[shipping_carriers.${routeId}] provider upstream error`, error)
  const { translate } = await resolveTranslations()
  return NextResponse.json({ error: translate(upstreamFailedKey, upstreamFailedFallback) }, { status: 502 })
}
