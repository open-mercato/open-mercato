import { NextResponse } from 'next/server'
import { loadCustomFieldValues } from '@open-mercato/shared/lib/crud/custom-fields'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CheckoutLinkTemplate } from '../../../data/entities'
import { CHECKOUT_ENTITY_IDS } from '../../../lib/constants'
import { serializeTemplateRecord } from '../../../commands/templates'
import { resolveLoadedCheckoutCustomFields } from '../../../lib/utils'
import {
  attachOperationMetadataHeader,
  buildCommandRuntimeContext,
  handleCheckoutRouteError,
  requireAdminContext,
} from '../../helpers'
import { checkoutTag } from '../../openapi'

export const metadata = {
  path: '/checkout/templates/[id]',
  GET: { requireAuth: true, requireFeatures: ['checkout.view'] },
  PUT: { requireAuth: true, requireFeatures: ['checkout.edit'] },
  DELETE: { requireAuth: true, requireFeatures: ['checkout.delete'] },
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const { auth, em } = await requireAdminContext(req)
    const resolvedParams = await params
    const template = await findOneWithDecryption(em, CheckoutLinkTemplate, {
      id: resolvedParams.id,
      organizationId: auth.orgId,
      tenantId: auth.tenantId,
      deletedAt: null,
    }, undefined, { organizationId: auth.orgId, tenantId: auth.tenantId })
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
      customFields: resolveLoadedCheckoutCustomFields(customValues[template.id]),
    })
  } catch (error) {
    return handleCheckoutRouteError(error)
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const { auth, container, commandBus } = await requireAdminContext(req)
    const resolvedParams = await params
    const body = await req.json().catch(() => ({}))
    const { result, logEntry } = await commandBus.execute<Record<string, unknown>, { ok: true }>('checkout.template.update', {
      input: { ...body, id: resolvedParams.id },
      ctx: buildCommandRuntimeContext(req, container, auth),
    })
    return attachOperationMetadataHeader(
      NextResponse.json(result),
      logEntry,
      { resourceKind: 'checkout.template', resourceId: resolvedParams.id },
    )
  } catch (error) {
    return handleCheckoutRouteError(error)
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const { auth, container, commandBus } = await requireAdminContext(req)
    const resolvedParams = await params
    const { result, logEntry } = await commandBus.execute<Record<string, unknown>, { ok: true }>('checkout.template.delete', {
      input: { id: resolvedParams.id },
      ctx: buildCommandRuntimeContext(req, container, auth),
    })
    return attachOperationMetadataHeader(
      NextResponse.json(result),
      logEntry,
      { resourceKind: 'checkout.template', resourceId: resolvedParams.id },
    )
  } catch (error) {
    return handleCheckoutRouteError(error)
  }
}

export const openApi = {
  tags: [checkoutTag],
}

export default { GET, PUT, DELETE }
