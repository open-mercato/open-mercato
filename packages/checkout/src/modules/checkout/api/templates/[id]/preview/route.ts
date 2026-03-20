import { NextResponse } from 'next/server'
import { loadCustomFieldValues } from '@open-mercato/shared/lib/crud/custom-fields'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CheckoutLinkTemplate } from '../../../../data/entities'
import { CHECKOUT_ENTITY_IDS } from '../../../../lib/constants'
import { resolveCheckoutPublicCustomFields } from '../../../../lib/customFields'
import { requireCheckoutScope, resolveLoadedCheckoutCustomFields } from '../../../../lib/utils'
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
    const scope = requireCheckoutScope({ auth })
    const resolvedParams = await params
    const template = await findOneWithDecryption(em, CheckoutLinkTemplate, {
      id: resolvedParams.id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    }, undefined, { organizationId: scope.organizationId, tenantId: scope.tenantId })
    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }
    const customValues = await loadCustomFieldValues({
      em,
      entityId: CHECKOUT_ENTITY_IDS.template,
      recordIds: [template.id],
      tenantIdByRecord: { [template.id]: scope.tenantId },
      organizationIdByRecord: { [template.id]: scope.organizationId },
    })
    const normalizedCustomValues = resolveLoadedCheckoutCustomFields(customValues[template.id])
    const publicCustomFields = await resolveCheckoutPublicCustomFields({
      em,
      entityId: CHECKOUT_ENTITY_IDS.template,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      customFieldsetCode: template.customFieldsetCode ?? null,
      customValues: normalizedCustomValues,
      displayCustomFieldsOnPage: template.displayCustomFieldsOnPage,
    })
    return NextResponse.json({
      ...serializeTemplateRecord(template),
      slug: `preview-${template.id.slice(0, 8)}`,
      customFields: normalizedCustomValues,
      publicCustomFields,
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
