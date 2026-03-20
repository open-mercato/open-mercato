import { NextResponse } from 'next/server'
import type { FilterQuery } from '@mikro-orm/postgresql'
import { findAndCountWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CheckoutLink } from '../../data/entities'
import { serializeLinkRecord } from '../../commands/links'
import {
  attachOperationMetadataHeader,
  buildCommandRuntimeContext,
  handleCheckoutRouteError,
  requireAdminContext,
} from '../helpers'
import { checkoutTag } from '../openapi'

export const metadata = {
  path: '/checkout/links',
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
    const where: FilterQuery<CheckoutLink> = {
      organizationId: auth.orgId,
      tenantId: auth.tenantId,
      deletedAt: null,
    }
    const templateId = url.searchParams.get('templateId')
    const isLocked = url.searchParams.get('isLocked')
    const status = url.searchParams.get('status')
    const pricingMode = url.searchParams.get('pricingMode')
    if (search) {
      where.$or = [
        { name: { $ilike: `%${search}%` } },
        { title: { $ilike: `%${search}%` } },
        { slug: { $ilike: `%${search}%` } },
      ]
    }
    if (templateId) where.templateId = templateId
    if (status === 'draft' || status === 'active' || status === 'inactive') where.status = status
    if (isLocked === 'true' || isLocked === 'false') where.isLocked = isLocked === 'true'
    if (pricingMode === 'fixed' || pricingMode === 'custom_amount' || pricingMode === 'price_list') where.pricingMode = pricingMode
    const [items, total] = await findAndCountWithDecryption(
      em,
      CheckoutLink,
      where,
      {
        orderBy: { createdAt: 'desc' },
        offset: (page - 1) * pageSize,
        limit: pageSize,
      },
      { organizationId: auth.orgId, tenantId: auth.tenantId },
    )
    return NextResponse.json({
      items: items.map((item) => serializeLinkRecord(item)),
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
    const { result, logEntry } = await commandBus.execute<Record<string, unknown>, { id: string; slug: string }>('checkout.link.create', {
      input: body,
      ctx: buildCommandRuntimeContext(req, container, auth),
    })
    return attachOperationMetadataHeader(
      NextResponse.json(result, { status: 201 }),
      logEntry,
      { resourceKind: 'checkout.link', resourceId: result.id },
    )
  } catch (error) {
    return handleCheckoutRouteError(error)
  }
}

export const openApi = {
  tags: [checkoutTag],
}

export default { GET, POST }
