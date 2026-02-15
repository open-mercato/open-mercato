import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { InboxProposal, InboxProposalAction } from '../../../../../../data/entities'
import { resolveOptionalEventBus } from '../../../../../../lib/eventBus'
import { rejectAction } from '../../../../../../lib/executionEngine'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['inbox_ops.proposals.manage'] },
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url)
    const segments = url.pathname.split('/')
    const proposalId = segments[segments.indexOf('proposals') + 1]
    const actionId = segments[segments.indexOf('actions') + 1]

    if (!proposalId || !actionId) {
      return NextResponse.json({ error: 'Missing IDs' }, { status: 400 })
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

    const action = await em.findOne(InboxProposalAction, {
      id: actionId,
      proposalId,
      organizationId: auth.organizationId,
      tenantId: auth.tenantId,
      deletedAt: null,
    })

    if (!action) {
      return NextResponse.json({ error: 'Action not found' }, { status: 404 })
    }

    const proposal = await em.findOne(InboxProposal, {
      id: proposalId,
      organizationId: auth.organizationId,
      tenantId: auth.tenantId,
      isActive: true,
      deletedAt: null,
    })
    if (!proposal) {
      return NextResponse.json({ error: 'Proposal has been superseded by a newer extraction' }, { status: 409 })
    }

    if (action.status !== 'pending' && action.status !== 'failed') {
      return NextResponse.json({ error: 'Action already processed' }, { status: 409 })
    }

    const eventBus = resolveOptionalEventBus(container)

    await rejectAction(action, {
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
    console.error('[inbox_ops:action:reject] Error:', err)
    return NextResponse.json({ error: 'Failed to reject action' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'InboxOps',
  summary: 'Reject action',
  methods: {
    POST: {
      summary: 'Reject a proposal action',
      responses: [
        { status: 200, description: 'Action rejected' },
        { status: 404, description: 'Action not found' },
        { status: 409, description: 'Action already processed' },
      ],
    },
  },
}
