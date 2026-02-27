import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { InboxProposal } from '../../../data/entities'
import { resolveRequestContext, UnauthorizedError } from '../../routeHelpers'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['inbox_ops.proposals.view'] },
}

export async function GET(req: Request) {
  try {
    const ctx = await resolveRequestContext(req)

    const scope = {
      organizationId: ctx.organizationId,
      tenantId: ctx.tenantId,
      deletedAt: null,
      isActive: true,
    }

    // em.count() is safe here — filter fields (status, organizationId, tenantId,
    // deletedAt, isActive) are not encrypted, so decryption helpers are not needed.
    const [pending, partial, accepted, rejected] = await Promise.all([
      ctx.em.count(InboxProposal, { ...scope, status: 'pending' }),
      ctx.em.count(InboxProposal, { ...scope, status: 'partial' }),
      ctx.em.count(InboxProposal, { ...scope, status: 'accepted' }),
      ctx.em.count(InboxProposal, { ...scope, status: 'rejected' }),
    ])

    return NextResponse.json({ pending, partial, accepted, rejected })
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
      summary: 'Get proposal status counts',
      description: 'Returns counts by status for tab badges',
      responses: [
        { status: 200, description: 'Status counts object' },
      ],
    },
  },
}
