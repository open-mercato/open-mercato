import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'
import { checkRateLimit, getClientIp } from '@open-mercato/shared/lib/ratelimit/helpers'
import { CheckoutLink } from '../../../../data/entities'
import { CHECKOUT_PASSWORD_COOKIE } from '../../../../lib/constants'
import { publicPasswordVerifySchema } from '../../../../data/validators'
import { handleCheckoutRouteError } from '../../../helpers'
import {
  isCheckoutLinkPublic,
  signCheckoutAccessToken,
  verifyCheckoutPassword,
} from '../../../../lib/utils'
import { checkoutPasswordRateLimitConfig } from '../../../../lib/rateLimiter'
import { checkoutTag } from '../../../openapi'

export const metadata = {
  path: '/checkout/pay/[slug]/verify-password',
  POST: { requireAuth: false },
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> | { slug: string } }) {
  try {
    const container = await createRequestContainer()
    try {
      const rateLimiter = container.resolve('rateLimiterService') as RateLimiterService
      const ip = getClientIp(req, 1) ?? 'unknown'
      const rateLimitResponse = await checkRateLimit(rateLimiter, checkoutPasswordRateLimitConfig, `checkout-password:${ip}`, 'Too many password attempts. Please try again later.')
      if (rateLimitResponse) return rateLimitResponse
    } catch {
      // Rate limiting is fail-open
    }
    const resolvedParams = await params
    const body = publicPasswordVerifySchema.parse(await req.json().catch(() => ({})))
    const em = container.resolve('em')
    const link = await findOneWithDecryption(em, CheckoutLink, {
      slug: resolvedParams.slug,
      deletedAt: null,
    })
    if (!link || !isCheckoutLinkPublic(link.status) || !link.passwordHash) {
      return NextResponse.json({ error: 'checkout.payPage.errors.password' }, { status: 401 })
    }
    const ok = await verifyCheckoutPassword(body.password, link.passwordHash)
    if (!ok) {
      return NextResponse.json({ error: 'checkout.payPage.errors.password' }, { status: 401 })
    }
    const response = NextResponse.json({ ok: true })
    response.cookies.set(CHECKOUT_PASSWORD_COOKIE, signCheckoutAccessToken(link.slug, {
      linkId: link.id,
      sessionVersion: link.passwordHash,
    }), {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
      maxAge: 60 * 60,
    })
    return response
  } catch (error) {
    return handleCheckoutRouteError(error)
  }
}

export const openApi = {
  tags: [checkoutTag],
}

export default POST
