import { NextResponse } from 'next/server'
import { findAndCountWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { findEntityIdsBySearchTokens } from '@open-mercato/shared/lib/search/tokenLookup'
import { CheckoutLink, CheckoutTransaction } from '../../data/entities'
import { CHECKOUT_ENTITY_IDS } from '../../lib/constants'
import { handleCheckoutRouteError, requireAdminContext, userHasCheckoutFeature } from '../helpers'
import { checkoutTag } from '../openapi'
import { serializeTransaction } from '../../lib/utils'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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
    if (search) {
      const pattern = `%${escapeLikePattern(search)}%`
      // email/first_name/last_name are covered by the checkout encryption map,
      // so an ILIKE alone compares the pattern against ciphertext and matches
      // nothing once encryption is on. Union it with the token index, which
      // stores hashes of the plaintext. Issue #2990.
      const searchOr: Record<string, unknown>[] = [
        { email: { $ilike: pattern } },
        { firstName: { $ilike: pattern } },
        { lastName: { $ilike: pattern } },
      ]
      // `id` is a uuid column: ILIKE against it has no Postgres operator and
      // raises 42883, so only an exact id lookup is meaningful here.
      if (UUID_PATTERN.test(search)) searchOr.push({ id: search })
      const tokenMatch = await findEntityIdsBySearchTokens({
        db: em.getKysely<any>(),
        entityType: CHECKOUT_ENTITY_IDS.transaction,
        query: search,
        fields: ['email', 'first_name', 'last_name'],
        scope: { tenantId: auth.tenantId, organizationId: auth.orgId },
      })
      if (tokenMatch.matched && tokenMatch.ids.length) {
        searchOr.push({ id: { $in: tokenMatch.ids } })
      }
      where.$or = searchOr
    }
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
