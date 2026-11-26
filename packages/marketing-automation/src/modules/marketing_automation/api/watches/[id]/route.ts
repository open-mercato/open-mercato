import { NextResponse } from 'next/server'
import { organizationScopeRequiredResponse, resolveActiveOrganizationId } from '@open-mercato/shared/lib/auth/organizationScope'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { MarketingProductWatch } from '../../../data/entities.js'
import { readPathUuid } from '../../shared.js'

/**
 * Stops a watch.
 *
 * Soft-deleted rather than removed, so the SKU keeps counting towards the demand a shop saw — and so the
 * unique index frees the pair, letting the same customer watch the same product again later from a fresh
 * reference price.
 */
const routeMetadata = {
  DELETE: { requireAuth: true, requireFeatures: ['marketing_automation.campaigns.manage'] },
}

export const metadata = routeMetadata

export async function DELETE(req: Request) {
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

  const id = readPathUuid(req, 1)
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId }

  const watch = await em.findOne(MarketingProductWatch, { id, ...scope, deletedAt: null })
  if (!watch) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    await enforceCommandOptimisticLockWithGuards(container, {
      resourceKind: 'marketing_automation.product_watch',
      resourceId: watch.id,
      current: watch.updatedAt,
      expected: undefined,
      request: req,
    })
  } catch (error) {
    if (error instanceof CrudHttpError) return NextResponse.json(error.body, { status: error.status })
    throw error
  }

  watch.deletedAt = new Date()
  await em.flush()
  return NextResponse.json({ ok: true })
}

export const openApi = {
  DELETE: {
    summary: 'Stop watching a product',
    description: 'Soft delete, so the demand figures keep the history and the customer may watch the same product again from a new reference price.',
    tags: ['Marketing Automation'],
    responses: { 200: { description: 'Stopped' }, 404: { description: 'No such watch' } },
  },
}
