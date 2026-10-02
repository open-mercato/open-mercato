import { NextResponse } from 'next/server'
import { organizationScopeRequiredResponse, resolveActiveOrganizationId } from '@open-mercato/shared/lib/auth/organizationScope'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { buildRepDigests, loadRoutingPool } from '../../lib/lead-routing.js'
import { DIGEST_INTERVAL_DAYS } from '../../lib/lead-digest.js'

/**
 * Who is carrying what, and who got what this week.
 *
 * The same numbers the weekly digest notifies about, on a screen — so the pool can be checked before anybody
 * is notified, and so a rep who dismissed the notification can still find their week.
 */
const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['marketing_automation.runs.view', 'customers.people.view'] },
}

export const metadata = routeMetadata

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

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId }

  const pool = await loadRoutingPool(container, scope)
  if (pool.length === 0) return NextResponse.json({ items: [], windowDays: DIGEST_INTERVAL_DAYS })

  const since = new Date(Date.now() - DIGEST_INTERVAL_DAYS * 86_400_000)
  const digests = await buildRepDigests(em, scope, pool, since)

  return NextResponse.json({
    items: digests.map((digest) => ({
      userId: digest.userId,
      totalOwned: digest.totalOwned,
      newLeads: digest.newLeads,
    })),
    windowDays: DIGEST_INTERVAL_DAYS,
  })
}

export const openApi = {
  GET: {
    summary: 'Lead routing: the rep pool, their load and their week',
    description: 'The same figures the weekly digest notification carries. Requires `customers.people.view`, because it names leads.',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'Reps with their load and recent leads' } },
  },
}
