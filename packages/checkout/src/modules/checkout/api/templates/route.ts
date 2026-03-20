import { NextResponse } from 'next/server'
import type { FilterQuery } from '@mikro-orm/postgresql'
import { findAndCountWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CheckoutLinkTemplate } from '../../data/entities'
import { checkoutTag } from '../openapi'
import {
  attachOperationMetadataHeader,
  buildCommandRuntimeContext,
  handleCheckoutRouteError,
  requireAdminContext,
} from '../helpers'
import { serializeTemplateRecord } from '../../commands/templates'

export const metadata = {
  path: '/checkout/templates',
  GET: { requireAuth: true, requireFeatures: ['checkout.view'] },
  POST: { requireAuth: true, requireFeatures: ['checkout.create'] },
}

export async function GET(req: Request) {
  try {
    const { auth, em } = await requireAdminContext(req)
    const url = new URL(req.url)
    const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'))
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize') ?? '25')))
    const search = (url.searchParams.get('search') ?? '').trim()
    const pricingMode = url.searchParams.get('pricingMode')
    const gatewayProviderKey = url.searchParams.get('gatewayProviderKey')
    const where: FilterQuery<CheckoutLinkTemplate> = {
      organizationId: auth.orgId,
      tenantId: auth.tenantId,
      deletedAt: null,
    }
    if (search) {
      where.$or = [
        { name: { $ilike: `%${search}%` } },
        { title: { $ilike: `%${search}%` } },
      ]
    }
    if (pricingMode === 'fixed' || pricingMode === 'custom_amount' || pricingMode === 'price_list') where.pricingMode = pricingMode
    if (gatewayProviderKey) where.gatewayProviderKey = gatewayProviderKey
    const [items, total] = await findAndCountWithDecryption(
      em,
      CheckoutLinkTemplate,
      where,
      {
        orderBy: { createdAt: 'desc' },
        offset: (page - 1) * pageSize,
        limit: pageSize,
      },
      { organizationId: auth.orgId, tenantId: auth.tenantId },
    )
    return NextResponse.json({
      items: items.map((item) => serializeTemplateRecord(item)),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    })
  } catch (error) {
    return handleCheckoutRouteError(error)
  }
}

export async function POST(req: Request) {
  try {
    const { auth, container, commandBus } = await requireAdminContext(req)
    const body = await req.json().catch(() => ({}))
    const { result, logEntry } = await commandBus.execute<Record<string, unknown>, { id: string }>('checkout.template.create', {
      input: body,
      ctx: buildCommandRuntimeContext(req, container, auth),
    })
    return attachOperationMetadataHeader(
      NextResponse.json(result, { status: 201 }),
      logEntry,
      { resourceKind: 'checkout.template', resourceId: result.id },
    )
  } catch (error) {
    return handleCheckoutRouteError(error)
  }
}

export const openApi = {
  tags: [checkoutTag],
}

export default { GET, POST }
