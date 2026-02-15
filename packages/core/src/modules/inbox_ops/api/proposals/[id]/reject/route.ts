import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { InboxProposal } from '../../../../data/entities'
import { resolveOptionalEventBus } from '../../../../lib/eventBus'
import { rejectProposal } from '../../../../lib/executionEngine'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['inbox_ops.proposals.manage'] },
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url)
    const segments = url.pathname.split('/')
    const proposalId = segments[segments.indexOf('proposals') + 1]

    if (!proposalId) {
      return NextResponse.json({ error: 'Missing proposal ID' }, { status: 400 })
    }

    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager).fork()
    const auth = container.resolve('auth') as {
      userId?: string | null
      sub?: string | null
      tenantId?: string | null
      organizationId?: string | null
    }
    const userId = typeof auth.userId === 'string' ? auth.userId : typeof auth.sub === 'string' ? auth.sub : null
    if (!userId || !auth.tenantId || !auth.organizationId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const proposal = await em.findOne(InboxProposal, {
      id: proposalId,
      organizationId: auth.organizationId,
      tenantId: auth.tenantId,
      deletedAt: null,
    })

    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
    }

    const eventBus = resolveOptionalEventBus(container)

    await rejectProposal(proposalId, {
      em,
      userId,
      tenantId: auth.tenantId,
      organizationId: auth.organizationId,
      eventBus,
      container,
      auth: auth as AuthContext,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[inbox_ops:proposal:reject] Error:', err)
    return NextResponse.json({ error: 'Failed to reject proposal' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'InboxOps',
  summary: 'Reject proposal',
  methods: {
    POST: {
      summary: 'Reject entire proposal (all pending actions)',
      responses: [
        { status: 200, description: 'Proposal rejected' },
        { status: 404, description: 'Proposal not found' },
      ],
    },
  },
}
