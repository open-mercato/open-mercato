import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { InboxProposal, InboxProposalAction } from '../../../../../../data/entities'
import { resolveOptionalEventBus } from '../../../../../../lib/eventBus'
import { executeAction } from '../../../../../../lib/executionEngine'

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

    const eventBus = resolveOptionalEventBus(container)

    const result = await executeAction(action, {
      em,
      userId,
      tenantId: auth.tenantId,
      organizationId: auth.organizationId,
      eventBus,
      container,
      auth: auth as AuthContext,
    })

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to execute action' },
        { status: result.statusCode || 400 },
      )
    }

    return NextResponse.json({
      ok: true,
      createdEntityId: result.createdEntityId,
      createdEntityType: result.createdEntityType,
    })
  } catch (err) {
    console.error('[inbox_ops:action:accept] Error:', err)
    return NextResponse.json({ error: 'Failed to execute action' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'InboxOps',
  summary: 'Accept action',
  methods: {
    POST: {
      summary: 'Accept and execute a proposal action',
      description: 'Executes the action and creates the entity in the target module. Returns 409 if already processed.',
      responses: [
        { status: 200, description: 'Action executed successfully' },
        { status: 403, description: 'Insufficient permissions in target module' },
        { status: 404, description: 'Action not found' },
        { status: 409, description: 'Action already processed' },
      ],
    },
  },
}
