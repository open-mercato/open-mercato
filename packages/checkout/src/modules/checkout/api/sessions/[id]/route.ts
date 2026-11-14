import { NextResponse } from 'next/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CheckoutSession } from '../../../data/entities'
import { handleCheckoutRouteError, requireAdminContext, userHasCheckoutFeature } from '../../helpers'
import { checkoutTag } from '../../openapi'
import { serializeCheckoutSession } from '../../../lib/sessionView'

export const metadata = {
  path: '/checkout/sessions/[id]',
  GET: { requireAuth: true, requireFeatures: ['checkout.sessions.view'] },
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const { auth, container, em } = await requireAdminContext(req)
    const canViewPii = await userHasCheckoutFeature(container, auth, 'checkout.viewPii')
    const resolvedParams = await params
    const session = await findOneWithDecryption(
      em,
      CheckoutSession,
      {
        id: resolvedParams.id,
        organizationId: auth.orgId,
        tenantId: auth.tenantId,
      },
      undefined,
      { organizationId: auth.orgId, tenantId: auth.tenantId },
    )
    if (!session) {
      return NextResponse.json({ error: 'Checkout session not found' }, { status: 404 })
    }
    return NextResponse.json({
      session: serializeCheckoutSession(session, { includePii: canViewPii }),
    })
  } catch (error) {
    return handleCheckoutRouteError(error)
  }
}

export const openApi = {
  tags: [checkoutTag],
}

export default GET
