import { NextResponse } from 'next/server'
import { findAndCountWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CheckoutLink, CheckoutTransaction } from '../../data/entities'
import { handleCheckoutRouteError, requireAdminContext, userHasCheckoutFeature } from '../helpers'
import { checkoutTag } from '../openapi'
import { serializeTransaction } from '../../lib/utils'

export const metadata = {
  path: '/checkout/transactions',
  GET: { requireAuth: true, requireFeatures: ['checkout.view'] },
}

export async function GET(req: Request) {
  try {
    const { auth, container, em } = await requireAdminContext(req)
    const canViewPii = await userHasCheckoutFeature(container, auth, 'checkout.viewPii')
    const url = new URL(req.url)
    const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'))
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize') ?? '25')))
    const search = (url.searchParams.get('search') ?? '').trim()
    const linkId = url.searchParams.get('linkId')
    const status = url.searchParams.get('status')
    const where: Record<string, unknown> = {
      organizationId: auth.orgId,
      tenantId: auth.tenantId,
    }
    if (linkId) where.linkId = linkId
    if (status) where.status = status
    if (search) where.$or = [
      { email: { $ilike: `%${search}%` } },
      { firstName: { $ilike: `%${search}%` } },
      { lastName: { $ilike: `%${search}%` } },
      { id: { $ilike: `%${search}%` } },
    ]
    const [items, total] = await findAndCountWithDecryption(
      em,
      CheckoutTransaction,
      where,
      {
        orderBy: { createdAt: 'desc' },
        offset: (page - 1) * pageSize,
        limit: pageSize,
      },
      { organizationId: auth.orgId, tenantId: auth.tenantId },
    )
    const linkIds = Array.from(new Set(items.map((item) => item.linkId)))
    const links = linkIds.length
      ? await findWithDecryption(em, CheckoutLink, {
        id: { $in: linkIds },
        organizationId: auth.orgId,
        tenantId: auth.tenantId,
        deletedAt: null,
      }, undefined, { organizationId: auth.orgId, tenantId: auth.tenantId })
      : []
    const linkMap = new Map(links.map((link) => [link.id, link]))
    return NextResponse.json({
      items: items.map((item) => serializeTransaction(item, linkMap.get(item.linkId) ?? null, canViewPii)),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      canViewPii,
    })
  } catch (error) {
    return handleCheckoutRouteError(error)
  }
}

export const openApi = {
  tags: [checkoutTag],
}

export default GET
