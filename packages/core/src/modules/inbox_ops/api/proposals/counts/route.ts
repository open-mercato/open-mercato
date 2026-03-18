import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { runWithCacheTenant } from '@open-mercato/cache'
import { InboxProposal } from '../../../data/entities'
import { ALL_CATEGORIES } from '../../../data/validators'
import { resolveRequestContext, UnauthorizedError } from '../../routeHelpers'
import {
  resolveCache,
  createCountsCacheKey,
  createCountsCacheTag,
  COUNTS_CACHE_TTL_MS,
} from '../../../lib/cache'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['inbox_ops.proposals.view'] },
}

export async function GET(req: Request) {
  try {
    const ctx = await resolveRequestContext(req)
    const cache = resolveCache(ctx.container)

    if (cache) {
      const cacheKey = createCountsCacheKey(ctx.tenantId)
      const cached = await runWithCacheTenant(ctx.tenantId, () => cache.get(cacheKey))
      if (cached) {
        return NextResponse.json(cached)
      }
    }

    const scope = {
      organizationId: ctx.organizationId,
      tenantId: ctx.tenantId,
      deletedAt: null,
      isActive: true,
    }

    // em.count() is safe here — filter fields (status, organizationId, tenantId,
    // deletedAt, isActive, category) are not encrypted, so decryption helpers are not needed.
    const [pending, partial, accepted, rejected] = await Promise.all([
      ctx.em.count(InboxProposal, { ...scope, status: 'pending' }),
      ctx.em.count(InboxProposal, { ...scope, status: 'partial' }),
      ctx.em.count(InboxProposal, { ...scope, status: 'accepted' }),
      ctx.em.count(InboxProposal, { ...scope, status: 'rejected' }),
    ])

    // Single GROUP BY query for category counts — O(1) queries
    const knex = ctx.em.getKnex()
    const categoryRows = await knex('inbox_proposals')
      .select('category')
      .count('* as count')
      .where({
        organization_id: ctx.organizationId,
        tenant_id: ctx.tenantId,
        is_active: true,
      })
      .whereNull('deleted_at')
      .groupBy('category')

    const byCategory: Record<string, number> = {}
    for (const cat of ALL_CATEGORIES) {
      byCategory[cat] = 0
    }
    for (const row of categoryRows) {
      const cat = row.category as string | null
      if (cat && cat in byCategory) {
        byCategory[cat] = Number(row.count)
      }
    }

    const responseBody = { pending, partial, accepted, rejected, byCategory }

    if (cache) {
      const cacheKey = createCountsCacheKey(ctx.tenantId)
      const tag = createCountsCacheTag(ctx.tenantId)
      try {
        await runWithCacheTenant(ctx.tenantId, () =>
          cache.set(cacheKey, responseBody, { ttl: COUNTS_CACHE_TTL_MS, tags: [tag] }),
        )
      } catch (err) {
        console.warn('[inbox_ops:proposals:counts] Failed to set cache', err)
      }
    }

    return NextResponse.json(responseBody)
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[inbox_ops:proposals:counts] Error:', err)
    return NextResponse.json({ error: 'Failed to get counts' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'InboxOps',
  summary: 'Proposal counts',
  methods: {
    GET: {
      summary: 'Get proposal status and category counts',
      description: 'Returns counts by status and by category for tab badges and filter dropdowns',
      responses: [
        { status: 200, description: 'Status and category counts object' },
      ],
    },
  },
}
