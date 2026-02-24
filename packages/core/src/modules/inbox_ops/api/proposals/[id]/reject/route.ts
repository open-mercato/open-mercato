import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { rejectProposal } from '../../../../lib/executionEngine'
import {
  resolveRequestContext,
  resolveProposal,
  toExecutionContext,
  handleRouteError,
  isErrorResponse,
} from '../../../routeHelpers'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['inbox_ops.proposals.manage'] },
}

export async function POST(req: Request) {
  try {
    const ctx = await resolveRequestContext(req)
    const proposal = await resolveProposal(new URL(req.url), ctx)
    if (isErrorResponse(proposal)) return proposal

    await rejectProposal(proposal.id, toExecutionContext(ctx))

    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleRouteError(err, 'reject proposal')
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
