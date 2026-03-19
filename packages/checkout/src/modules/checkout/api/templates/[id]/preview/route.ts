import { NextResponse } from 'next/server'
import { loadCustomFieldValues } from '@open-mercato/shared/lib/crud/custom-fields'
import { CheckoutLinkTemplate } from '../../../../data/entities'
import { CHECKOUT_ENTITY_IDS } from '../../../../lib/constants'
import { serializeTemplateRecord } from '../../../../commands/templates'
import { handleCheckoutRouteError, requireAdminContext } from '../../../helpers'
import { checkoutTag } from '../../../openapi'

export const metadata = {
  path: '/checkout/templates/[id]/preview',
  GET: { requireAuth: true, requireFeatures: ['checkout.view'] },
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const { auth, em } = await requireAdminContext(req)
    const resolvedParams = await params
    const template = await em.findOne(CheckoutLinkTemplate, {
      id: resolvedParams.id,
      organizationId: auth.orgId,
      tenantId: auth.tenantId,
      deletedAt: null,
    })
    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }
    const customValues = await loadCustomFieldValues({
      em,
      entityId: CHECKOUT_ENTITY_IDS.template,
      recordIds: [template.id],
      tenantIdByRecord: { [template.id]: auth.tenantId },
      organizationIdByRecord: { [template.id]: auth.orgId },
    })
    return NextResponse.json({
      ...serializeTemplateRecord(template),
      slug: `preview-${template.id.slice(0, 8)}`,
      customFields: customValues[template.id] ?? {},
      available: false,
      remainingUses: null,
      requiresPassword: false,
      preview: true,
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
