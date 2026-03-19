import { NextResponse } from 'next/server'
import { loadCustomFieldValues } from '@open-mercato/shared/lib/crud/custom-fields'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'
import { checkRateLimit, getClientIp } from '@open-mercato/shared/lib/ratelimit/helpers'
import { CheckoutLink } from '../../../data/entities'
import { CHECKOUT_ENTITY_IDS } from '../../../lib/constants'
import { checkoutPublicViewRateLimitConfig } from '../../../lib/rateLimiter'
import { handleCheckoutRouteError, readCheckoutPasswordCookie, requirePreviewContext } from '../../helpers'
import {
  isCheckoutLinkPublic,
  serializeTemplateOrLink,
  verifyCheckoutPasswordAccess,
} from '../../../lib/utils'
import { checkoutTag } from '../../openapi'

export const metadata = {
  path: '/checkout/pay/[slug]',
  GET: { requireAuth: false },
}

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> | { slug: string } }) {
  try {
    const resolvedParams = await params
    const url = new URL(req.url)
    const previewRequested = url.searchParams.get('preview') === 'true'
    const container = await createRequestContainer()
    const previewContext = previewRequested ? await requirePreviewContext(req) : null
    if (!previewRequested) {
      try {
        const rateLimiter = container.resolve('rateLimiterService') as RateLimiterService
        const ip = getClientIp(req, 1) ?? 'unknown'
        const rateLimitResponse = await checkRateLimit(rateLimiter, checkoutPublicViewRateLimitConfig, `checkout-public-view:${ip}`, 'Too many checkout page requests. Please try again later.')
        if (rateLimitResponse) return rateLimitResponse
      } catch {
        // Rate limiting is fail-open
      }
    }
    const em = container.resolve('em')
    const link = await em.findOne(CheckoutLink, {
      slug: resolvedParams.slug,
      deletedAt: null,
    })
    if (!link || (!previewRequested && !isCheckoutLinkPublic(link.status))) {
      return NextResponse.json({ error: 'Payment link not found' }, { status: 404 })
    }
    const available = link.maxCompletions == null
      ? true
      : (link.completionCount + link.activeReservationCount) < link.maxCompletions
    const token = readCheckoutPasswordCookie(req)
    const passwordVerified = previewRequested || !link.passwordHash || verifyCheckoutPasswordAccess(token, link.slug)
    if (!passwordVerified) {
      return NextResponse.json({
        requiresPassword: true,
        title: link.title ?? link.name,
      })
    }
    const customValues = await loadCustomFieldValues({
      em,
      entityId: CHECKOUT_ENTITY_IDS.link,
      recordIds: [link.id],
      tenantIdByRecord: { [link.id]: link.tenantId },
      organizationIdByRecord: { [link.id]: link.organizationId },
    })
    return NextResponse.json({
      ...serializeTemplateOrLink(link),
      customFields: customValues[link.id] ?? {},
      available: previewRequested ? false : available,
      remainingUses: link.maxCompletions == null
        ? null
        : Math.max(0, link.maxCompletions - link.completionCount - link.activeReservationCount),
      requiresPassword: false,
      preview: previewRequested,
      previewUserId: previewContext?.auth.sub ?? null,
      gatewaySettings: undefined,
    })
  } catch (error) {
    return handleCheckoutRouteError(error)
  }
}

export const openApi = {
  tags: [checkoutTag],
}

export default GET
