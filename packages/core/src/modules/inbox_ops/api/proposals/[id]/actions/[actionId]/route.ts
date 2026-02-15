import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { EntityManager } from '@mikro-orm/postgresql'
import { InboxProposal, InboxProposalAction } from '../../../../../data/entities'
import { actionEditSchema } from '../../../../../data/validators'
import { resolveOptionalEventBus } from '../../../../../lib/eventBus'

export const metadata = {
  PATCH: { requireAuth: true, requireFeatures: ['inbox_ops.proposals.manage'] },
}

export async function PATCH(req: Request) {
  try {
    const url = new URL(req.url)
    const segments = url.pathname.split('/')
    const proposalId = segments[segments.indexOf('proposals') + 1]
    const actionId = segments[segments.indexOf('actions') + 1]

    if (!proposalId || !actionId) {
      return NextResponse.json({ error: 'Missing IDs' }, { status: 400 })
    }

    const body = await req.json()
    const parsed = actionEditSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid payload', details: parsed.error.issues }, { status: 400 })
    }

    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager).fork()
    const auth = container.resolve('auth') as any

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

    action.payload = parsed.data.payload
    await em.flush()

    const eventBus = resolveOptionalEventBus(container)
    if (eventBus) {
      await eventBus.emit('inbox_ops.action.edited', {
        actionId: action.id,
        proposalId: action.proposalId,
        actionType: action.actionType,
        tenantId: auth.tenantId,
        organizationId: auth.organizationId,
      })
    }

    return NextResponse.json({ ok: true, action })
  } catch (err) {
    console.error('[inbox_ops:action:edit] Error:', err)
    return NextResponse.json({ error: 'Failed to edit action' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'InboxOps',
  summary: 'Edit action',
  methods: {
    PATCH: {
      summary: 'Edit action payload before accepting',
      responses: [
        { status: 200, description: 'Action updated' },
        { status: 404, description: 'Action not found' },
        { status: 409, description: 'Action already processed' },
      ],
    },
  },
}
