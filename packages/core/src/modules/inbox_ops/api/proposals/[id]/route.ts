import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { InboxProposal, InboxProposalAction, InboxDiscrepancy, InboxEmail } from '../../../data/entities'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['inbox_ops.proposals.view'] },
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const segments = url.pathname.split('/')
    const id = segments[segments.indexOf('proposals') + 1]

    if (!id) {
      return NextResponse.json({ error: 'Missing proposal ID' }, { status: 400 })
    }

    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager).fork()
    const auth = container.resolve('auth') as any

    const scope = {
      tenantId: auth.tenantId,
      organizationId: auth.organizationId,
    }

    const proposal = await findOneWithDecryption(
      em,
      InboxProposal as any,
      {
        id,
        organizationId: auth.organizationId,
        tenantId: auth.tenantId,
        deletedAt: null,
      } as any,
      undefined,
      scope,
    )

    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
    }

    const [actions, discrepancies, email] = await Promise.all([
      findWithDecryption(
        em,
        InboxProposalAction as any,
        { proposalId: id, deletedAt: null } as any,
        { orderBy: { sortOrder: 'ASC' } as any },
        scope,
      ),
      findWithDecryption(
        em,
        InboxDiscrepancy as any,
        { proposalId: id, deletedAt: null } as any,
        { orderBy: { createdAt: 'ASC' } as any },
        scope,
      ),
      findOneWithDecryption(
        em,
        InboxEmail as any,
        {
          id: (proposal as any).inboxEmailId,
          deletedAt: null,
        } as any,
        undefined,
        scope,
      ),
    ])

    return NextResponse.json({
      proposal,
      actions,
      discrepancies,
      email,
    })
  } catch (err) {
    console.error('[inbox_ops:proposals:detail] Error:', err)
    return NextResponse.json({ error: 'Failed to load proposal' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'InboxOps',
  summary: 'Proposal detail',
  methods: {
    GET: {
      summary: 'Get proposal detail',
      description: 'Returns proposal with actions, discrepancies, and source email',
      responses: [
        { status: 200, description: 'Full proposal detail' },
        { status: 404, description: 'Proposal not found' },
      ],
    },
  },
}
