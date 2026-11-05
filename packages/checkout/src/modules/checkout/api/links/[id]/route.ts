import { NextResponse } from 'next/server'
import { loadCustomFieldValues } from '@open-mercato/shared/lib/crud/custom-fields'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CheckoutLink } from '../../../data/entities'
import { serializeLinkRecord } from '../../../commands/links'
import { CHECKOUT_ENTITY_IDS } from '../../../lib/constants'
import { resolveLoadedCheckoutCustomFields } from '../../../lib/utils'
import {
  attachOperationMetadataHeader,
  buildCommandRuntimeContext,
  handleCheckoutRouteError,
  requireAdminContext,
} from '../../helpers'
import { checkoutTag } from '../../openapi'

export const metadata = {
  path: '/checkout/links/[id]',
  GET: { requireAuth: true, requireFeatures: ['checkout.view'] },
  PUT: { requireAuth: true, requireFeatures: ['checkout.edit'] },
  DELETE: { requireAuth: true, requireFeatures: ['checkout.delete'] },
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const { auth, em } = await requireAdminContext(req)
    const resolvedParams = await params
    const link = await findOneWithDecryption(em, CheckoutLink, {
      id: resolvedParams.id,
      organizationId: auth.orgId,
      tenantId: auth.tenantId,
      deletedAt: null,
    }, undefined, { organizationId: auth.orgId, tenantId: auth.tenantId })
    if (!link) {
      return NextResponse.json({ error: 'Link not found' }, { status: 404 })
    }
    const customValues = await loadCustomFieldValues({
      em,
      entityId: CHECKOUT_ENTITY_IDS.link,
      recordIds: [link.id],
      tenantIdByRecord: { [link.id]: auth.tenantId },
      organizationIdByRecord: { [link.id]: auth.orgId },
    })
    return NextResponse.json({
      ...serializeLinkRecord(link),
      customFields: resolveLoadedCheckoutCustomFields(customValues[link.id]),
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
    const { result, logEntry } = await commandBus.execute<Record<string, unknown>, { ok: true; slug: string }>('checkout.link.update', {
      input: { ...body, id: resolvedParams.id },
      ctx: buildCommandRuntimeContext(req, container, auth),
    })
    return attachOperationMetadataHeader(
      NextResponse.json(result),
      logEntry,
      { resourceKind: 'checkout.link', resourceId: resolvedParams.id },
    )
  } catch (error) {
    return handleCheckoutRouteError(error)
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const { auth, container, commandBus } = await requireAdminContext(req)
    const resolvedParams = await params
    const { result, logEntry } = await commandBus.execute<Record<string, unknown>, { ok: true }>('checkout.link.delete', {
      input: { id: resolvedParams.id },
      ctx: buildCommandRuntimeContext(req, container, auth),
    })
    return attachOperationMetadataHeader(
      NextResponse.json(result),
      logEntry,
      { resourceKind: 'checkout.link', resourceId: resolvedParams.id },
    )
  } catch (error) {
    return handleCheckoutRouteError(error)
  }
}

export const openApi = {
  tags: [checkoutTag],
}

export default { GET, PUT, DELETE }
