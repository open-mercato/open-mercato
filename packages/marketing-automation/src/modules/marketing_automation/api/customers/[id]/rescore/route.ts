import { NextResponse } from 'next/server'
import { organizationScopeRequiredResponse, resolveActiveOrganizationId } from '@open-mercato/shared/lib/auth/organizationScope'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { applyRuleScore, isScorableSubject } from '../../../../lib/score-rules.js'
import { loadScorePoints } from '../../../../lib/scores.js'
import { readPathUuid } from '../../../shared.js'

/**
 * Re-evaluates one customer's score rules now.
 *
 * Rules are applied to everybody by a queued pass and once a day; this is the answer to "I just changed a rule,
 * does it do what I meant for THIS customer" without waiting for either. Idempotent: a second call with nothing
 * changed writes nothing.
 */
const routeMetadata = {
  POST: { requireAuth: true, requireFeatures: ['marketing_automation.campaigns.manage'] },
}

export const metadata = routeMetadata

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
  const subjectEntityId = readPathUuid(req, 2)
  if (!subjectEntityId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId }

  const customer = await em.findOne(
    CustomerEntity,
    { id: subjectEntityId, ...scope, kind: 'person', deletedAt: null },
    { fields: ['id'] },
  )
  if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // Said out loud rather than answered with "nothing changed", which would read as "the rules do not match".
  if (!(await isScorableSubject(em, subjectEntityId, scope))) {
    return NextResponse.json(
      { error: 'This customer\'s marketing data was erased, so rules no longer score them', code: 'marketing_automation.errors.subjectErased' },
      { status: 409 },
    )
  }

  const outcome = await applyRuleScore(em, scope, subjectEntityId, new Date())
  const points = await loadScorePoints(em, subjectEntityId, scope)
  return NextResponse.json({
    changed: outcome.applied,
    delta: outcome.delta,
    points,
    matched: outcome.matched,
  })
}

export const openApi = {
  POST: {
    summary: 'Recalculate a customer\'s score rules',
    description: 'Applies the current score rules to one customer immediately. Writes a ledger entry only when what the rules award has changed.',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'The customer\'s total, and the rules that match' }, 404: { description: 'No such customer' }, 409: { description: 'The customer\'s marketing data was erased' } },
  },
}
