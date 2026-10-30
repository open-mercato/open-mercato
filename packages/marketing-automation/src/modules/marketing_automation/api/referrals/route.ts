import { NextResponse } from 'next/server'
import { organizationScopeRequiredResponse, resolveActiveOrganizationId } from '@open-mercato/shared/lib/auth/organizationScope'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { MarketingReferralCode } from '../../data/entities.js'
import { ensureReferralCode, loadReferralUrlTemplate } from '../../lib/referrals.js'
import { referralUrlFor } from '../../lib/engine/referral-code.js'
import { CUSTOMER_ENTITIES } from '../../lib/external/tables.js'

/**
 * Who is referring whom, and how well it is working.
 *
 * The list is ordered by CONVERSIONS rather than by when a code was issued: the operational question is which
 * customers actually bring people who buy, and a list sorted by issue date answers a question nobody asked.
 */
const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['marketing_automation.runs.view'] },
  POST: { requireAuth: true, requireFeatures: ['marketing_automation.campaigns.manage'] },
}

export const metadata = routeMetadata

const issueSchema = z.object({ customerId: z.string().uuid() })

type CountRow = { referrer_entity_id: string; claimed: string; converted: string }

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ items: [] }, { status: 401 })
  /**
   * A scope that cannot be resolved is a 400, never a 401.
   *
   * `apiFetch` reads 401 as an expired session: it refreshes, succeeds, returns to the same page and
   * refreshes again — so answering 401 for "All organizations" did not fail, it looped for ever. The
   * resolver also recovers the actor's own organization where that is still the actor's tenant, which is
   * what keeps a super-admin's own configuration visible instead of unreachable.
   */
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()

  const url = new URL(req.url)
  const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 1), 100)

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId }

  /**
   * Newest first, explicitly.
   *
   * A `limit` with no `orderBy` takes whichever rows Postgres hands back, which is stable until it is not —
   * an update, a vacuum or a plan change silently reshuffles the page, so the "top fifty codes" screen shows
   * a different fifty for no reason anybody can see. The list is re-sorted by performance below; this decides
   * WHICH fifty are read.
   */
  /**
   * Only codes whose owner is still a customer, decided in the query rather than after it: the page is the newest
   * `limit` codes, and filtering after the limit let deleted customers' codes crowd live ones off the page.
   */
  const liveIds = await em.getConnection().execute<Array<{ id: string }>>(
    `select c.id
       from marketing_referral_codes c
       join ${CUSTOMER_ENTITIES} e
         on e.id = c.referrer_entity_id and e.tenant_id = c.tenant_id
        and e.organization_id = c.organization_id and e.deleted_at is null
      where c.tenant_id = ? and c.organization_id = ? and c.deleted_at is null
      order by c.created_at desc, c.id asc
      limit ${limit}`,
    [scope.tenantId, scope.organizationId],
  )
  if (liveIds.length === 0) return NextResponse.json({ items: [] })
  const order = new Map(liveIds.map((row, index) => [row.id, index]))
  const codes = (await em.find(MarketingReferralCode, { ...scope, id: { $in: liveIds.map((row) => row.id) } }))
    .sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0))

  /**
   * Counted in ONE grouped query rather than per code.
   *
   * A list of fifty codes would otherwise be a hundred queries, and this endpoint exists precisely to be
   * looked at often.
   */
  const counts = await em.getConnection().execute<CountRow[]>(
    `select referrer_entity_id,
            count(*)::text as claimed,
            count(*) filter (where status = 'converted')::text as converted
       from marketing_referral_redemptions
      where tenant_id = ? and organization_id = ?
      group by referrer_entity_id`,
    [scope.tenantId, scope.organizationId],
  )
  const countsById = new Map(counts.map((row) => [row.referrer_entity_id, row]))

  /**
   * The referrer's NAME, which is what makes this a list rather than fifty identical links.
   *
   * Gated on `customers.people.view` and decrypted only with the grant, exactly as the runs list is: a name is
   * personal data, and a marketing-only principal has no business reading it. Without the grant the field is
   * null and the screen falls back to a plain link, which is what it showed everybody before.
   */
  const referrerIds = [...new Set(codes.map((code) => code.referrerEntityId).filter((id): id is string => !!id))]
  const rbac = container.resolve<RbacService>('rbacService')
  const mayReadNames = referrerIds.length > 0 && await rbac.userHasAllFeatures(
    auth.sub,
    ['customers.people.view'],
    { tenantId: auth.tenantId ?? null, organizationId },
  )
  const referrers = mayReadNames
    ? (await findWithDecryption(
        em,
        CustomerEntity,
        { id: { $in: referrerIds }, ...scope, deletedAt: null },
        undefined,
        scope,
      )) as Array<{ id: string; displayName?: string | null }>
    : []
  const nameById = new Map(referrers.map((row) => [row.id, row.displayName ?? null]))

  const template = await loadReferralUrlTemplate(container, scope)
  const items = codes.flatMap((code) => {
    if (!code.referrerEntityId) return []
    const row = countsById.get(code.referrerEntityId)
    return [{
      customerId: code.referrerEntityId,
      customerName: nameById.get(code.referrerEntityId) ?? null,
      code: code.code,
      url: referralUrlFor(template, code.code),
      claimed: Number.parseInt(row?.claimed ?? '0', 10) || 0,
      converted: Number.parseInt(row?.converted ?? '0', 10) || 0,
      createdAt: code.createdAt.toISOString(),
    }]
  })
  items.sort((left, right) => right.converted - left.converted || right.claimed - left.claimed)

  return NextResponse.json({ items })
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // A scope that cannot be resolved is a 400, never a 401: `apiFetch` reads 401 as an expired session and
  // loops. See the first guard in this file.
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()

  const parsed = issueSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'customerId is required', code: 'marketing_automation.validation.invalidPayload' },
      { status: 400 },
    )
  }

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId }

  const customer = await em.findOne(CustomerEntity, { id: parsed.data.customerId, ...scope, deletedAt: null })
  if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Idempotent: a customer has one code, and asking twice returns it rather than replacing it. A replaced
  // code would break every message that already printed the old one.
  const code = await ensureReferralCode(em, scope, customer.id)
  const template = await loadReferralUrlTemplate(container, scope)

  return NextResponse.json({ customerId: customer.id, code, url: referralUrlFor(template, code) })
}

export const openApi = {
  GET: {
    summary: 'List referral codes with how many people used them',
    description: 'Ordered by conversions, then by claims — the question being asked is which customers bring people who actually buy.',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'Codes with claim and conversion counts' } },
  },
  POST: {
    summary: 'Issue (or read back) a customer referral code',
    description: 'Idempotent: one live code per customer, because a replaced code would break every message that already printed it.',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'The code and its shareable URL' }, 404: { description: 'No such customer' } },
  },
}
