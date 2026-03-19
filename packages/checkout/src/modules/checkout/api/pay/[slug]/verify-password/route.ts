import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { CheckoutLink } from '../../../../data/entities'
import { CHECKOUT_PASSWORD_COOKIE } from '../../../../lib/constants'
import { publicPasswordVerifySchema } from '../../../../data/validators'
import { handleCheckoutRouteError } from '../../../helpers'
import {
  signCheckoutPasswordAccess,
  verifyCheckoutPassword,
} from '../../../../lib/utils'
import { checkoutTag } from '../../../openapi'

export const metadata = {
  path: '/checkout/pay/[slug]/verify-password',
  POST: { requireAuth: false },
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> | { slug: string } }) {
  try {
    const resolvedParams = await params
    const body = publicPasswordVerifySchema.parse(await req.json().catch(() => ({})))
    const container = await createRequestContainer()
    const em = container.resolve('em')
    const link = await em.findOne(CheckoutLink, {
      slug: resolvedParams.slug,
      deletedAt: null,
      isActive: true,
    })
    if (!link || !link.passwordHash) {
      return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
    }
    const ok = await verifyCheckoutPassword(body.password, link.passwordHash)
    if (!ok) {
      return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
    }
    const response = NextResponse.json({ ok: true })
    response.cookies.set(CHECKOUT_PASSWORD_COOKIE, signCheckoutPasswordAccess(link.slug), {
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
