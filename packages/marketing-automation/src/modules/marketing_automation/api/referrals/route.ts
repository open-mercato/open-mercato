import { NextResponse } from 'next/server'
import { organizationScopeRequiredResponse, resolveActiveOrganizationId } from '@open-mercato/shared/lib/auth/organizationScope'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
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

type RankedCodeRow = {
  code: string
  referrer_entity_id: string
  created_at: string
  claimed: string
  converted: string
}

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
   * Ranked by conversions in the SAME query that picks the window, not after it.
   *
   * Selecting "the newest `limit` codes" and only THEN sorting by performance ranks within a window chosen
   * by recency — past the window, an older code that converts well never gets a chance to outrank a newer
   * one that does not convert at all. The redemption counts are joined and the `order by`/`limit` applied
   * together, so the page is the best-performing `limit` codes among every live one, not the best-performing
   * `limit` among the newest. Only codes whose owner is still a customer are eligible, decided in the same
   * query rather than after it, so a deleted customer's code cannot crowd a live one off the page.
   */
  const ranked = await em.getConnection().execute<RankedCodeRow[]>(
    `select c.code, c.referrer_entity_id, c.created_at,
            coalesce(r.claimed, 0)::text as claimed,
            coalesce(r.converted, 0)::text as converted
       from marketing_referral_codes c
       join ${CUSTOMER_ENTITIES} e
         on e.id = c.referrer_entity_id and e.tenant_id = c.tenant_id
        and e.organization_id = c.organization_id and e.deleted_at is null
       left join (
         select referrer_entity_id,
                count(*) as claimed,
                count(*) filter (where status = 'converted') as converted
           from marketing_referral_redemptions
          where tenant_id = ? and organization_id = ?
          group by referrer_entity_id
       ) r on r.referrer_entity_id = c.referrer_entity_id
      where c.tenant_id = ? and c.organization_id = ? and c.deleted_at is null
      order by converted desc, claimed desc, c.created_at desc, c.id asc
      limit ${limit}`,
    [scope.tenantId, scope.organizationId, scope.tenantId, scope.organizationId],
  )
  if (ranked.length === 0) return NextResponse.json({ items: [] })

  /**
   * The referrer's NAME, which is what makes this a list rather than fifty identical links.
   *
   * Gated on `customers.people.view` and decrypted only with the grant, exactly as the runs list is: a name is
   * personal data, and a marketing-only principal has no business reading it. Without the grant the field is
   * null and the screen falls back to a plain link, which is what it showed everybody before.
   */
  const referrerIds = [...new Set(ranked.map((row) => row.referrer_entity_id).filter((id): id is string => !!id))]
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
  // Already in the right order — `ranked` was sorted by conversions, then claims, then recency, before
  // `limit` was applied, so nothing here needs to re-sort what the query already decided.
  const items = ranked.flatMap((row) => {
    if (!row.referrer_entity_id) return []
    return [{
      customerId: row.referrer_entity_id,
      customerName: nameById.get(row.referrer_entity_id) ?? null,
      code: row.code,
      url: referralUrlFor(template, row.code),
      claimed: Number.parseInt(row.claimed, 10) || 0,
      converted: Number.parseInt(row.converted, 10) || 0,
      createdAt: new Date(row.created_at).toISOString(),
    }]
  })

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
