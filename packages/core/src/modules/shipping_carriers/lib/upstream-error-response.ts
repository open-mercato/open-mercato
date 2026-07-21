import { NextResponse } from 'next/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('shipping_carriers')

const upstreamFailedKey = 'shipping_carriers.errors.upstreamFailed'
const upstreamFailedFallback = 'Carrier provider request failed. Try again later.'

export async function shippingCarrierUpstreamErrorResponse(routeId: string, error: unknown) {
  logger.error('Provider upstream error', { routeId, err: error })
  const { translate } = await resolveTranslations()
  return NextResponse.json({ error: translate(upstreamFailedKey, upstreamFailedFallback) }, { status: 502 })
}
