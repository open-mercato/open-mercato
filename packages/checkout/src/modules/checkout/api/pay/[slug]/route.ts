import { NextResponse } from 'next/server'
import { loadCustomFieldValues } from '@open-mercato/shared/lib/crud/custom-fields'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { CheckoutLink } from '../../../data/entities'
import { CHECKOUT_ENTITY_IDS } from '../../../lib/constants'
import { handleCheckoutRouteError, readCheckoutPasswordCookie } from '../../helpers'
import {
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
    const container = await createRequestContainer()
    const em = container.resolve('em')
    const link = await em.findOne(CheckoutLink, {
      slug: resolvedParams.slug,
      deletedAt: null,
      isActive: true,
    })
    if (!link) {
      return NextResponse.json({ error: 'Payment link not found' }, { status: 404 })
    }
    const available = link.maxCompletions == null
      ? true
      : (link.completionCount + link.activeReservationCount) < link.maxCompletions
    const token = readCheckoutPasswordCookie(req)
    const passwordVerified = !link.passwordHash || verifyCheckoutPasswordAccess(token, link.slug)
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
      available,
      remainingUses: link.maxCompletions == null
        ? null
        : Math.max(0, link.maxCompletions - link.completionCount - link.activeReservationCount),
      requiresPassword: false,
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
