import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { EntityManager } from '@mikro-orm/postgresql'
import { InboxProposal } from '../../../data/entities'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['inbox_ops.proposals.view'] },
}

export async function GET() {
  try {
    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager).fork()
    const auth = container.resolve('auth') as any

    const scope = {
      organizationId: auth.organizationId,
      tenantId: auth.tenantId,
      deletedAt: null,
      isActive: true,
    }

    const [pending, partial, accepted, rejected] = await Promise.all([
      em.count(InboxProposal, { ...scope, status: 'pending' }),
      em.count(InboxProposal, { ...scope, status: 'partial' }),
      em.count(InboxProposal, { ...scope, status: 'accepted' }),
      em.count(InboxProposal, { ...scope, status: 'rejected' }),
    ])

    return NextResponse.json({ pending, partial, accepted, rejected })
  } catch (err) {
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
