import { NextResponse } from 'next/server'
import { organizationScopeRequiredResponse, resolveActiveOrganizationId } from '@open-mercato/shared/lib/auth/organizationScope'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { MarketingSegment } from '../../../../data/entities.js'
import { resolveSegmentMembers, SCREEN_MAX_CHECKED } from '../../../../lib/segment-members.js'
import type { ConditionExpression } from '@open-mercato/core/modules/business_rules/lib/expression-evaluator'
import { readPathUuid } from '../../../shared.js'

/**
 * Who is in a segment, and whether that answer is the whole of it.
 *
 * Resolved through the shared resolver, which is the same path the dispatcher, the overlap tool, the size
 * history and the bulk actions use — one definition of membership, or the screens start disagreeing with the
 * sender.
 *
 * Requires `customers.people.view` as well, because the answer NAMES people.
 */
const routeMetadata = {
  GET: {
    requireAuth: true,
    requireFeatures: ['marketing_automation.campaigns.view', 'customers.people.view'],
  },
}

export const metadata = routeMetadata

/** How many members come back with names attached. A page, not a mailing list. */
const MAX_RETURNED = 50

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

  // .../segments/<id>/members
  const segmentId = readPathUuid(req, 2)
  if (!segmentId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId }

  const segment = await em.findOne(MarketingSegment, { id: segmentId, ...scope, deletedAt: null })
  if (!segment) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const resolution = await resolveSegmentMembers(
    em,
    container,
    scope,
    (segment.expression ?? null) as ConditionExpression | null,
    { maxChecked: SCREEN_MAX_CHECKED, maxMatches: MAX_RETURNED },
  )

  /**
   * Names are read through the DECRYPTING finder, in one query for the page.
   *
   * `display_name` and `primary_email` are encrypted at rest, so a plain find would hand this screen
   * ciphertext — and a list of ciphertext looks like a list of customers whose names are broken.
   */
  const rows = resolution.ids.length > 0
    ? (await findWithDecryption(
        em,
        CustomerEntity,
        { id: { $in: resolution.ids }, ...scope, deletedAt: null },
        undefined,
        scope,
      )) as Array<{ id: string; displayName?: string | null; primaryEmail?: string | null }>
    : []

  const byId = new Map(rows.map((row) => [row.id, row]))

  return NextResponse.json({
    items: resolution.ids.map((id) => ({
      id,
      displayName: byId.get(id)?.displayName ?? null,
      email: byId.get(id)?.primaryEmail ?? null,
    })),
    /**
     * What the answer IS, stated rather than implied: a truncated count that looks exact is worse than an
     * honest sample.
     */
    qualifier: resolution.complete ? 'exact' : 'sample',
    checked: resolution.checked,
    candidates: resolution.candidates,
    narrowing: resolution.narrowing,
  })
}

export const openApi = {
  GET: {
    summary: 'List members of a segment',
    description:
      'Narrowed in the database where the expression allows, then decided per candidate by the same matcher the dispatcher uses. Answers with a qualifier saying whether the result is exact or a sample.',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'Members and what kind of answer this is' }, 404: { description: 'No such segment' } },
  },
}
