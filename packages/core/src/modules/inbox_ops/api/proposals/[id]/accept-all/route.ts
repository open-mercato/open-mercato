import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { acceptAllActions } from '../../../../lib/executionEngine'
import {
  resolveRequestContext,
  resolveProposal,
  resolveCrossModuleEntities,
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

    const entities = resolveCrossModuleEntities(ctx.container)
    const { results, stoppedOnFailure } = await acceptAllActions(
      proposal.id,
      toExecutionContext(ctx, entities),
    )

    const succeeded = results.filter((r) => r.success).length
    const failed = results.filter((r) => !r.success).length

    return NextResponse.json({ ok: !stoppedOnFailure, succeeded, failed, stoppedOnFailure, results })
  } catch (err) {
    return handleRouteError(err, 'accept all actions')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'InboxOps',
  summary: 'Accept all actions',
  methods: {
    POST: {
      summary: 'Accept and execute all pending actions in a proposal',
      responses: [
        { status: 200, description: 'All actions processed' },
        { status: 404, description: 'Proposal not found' },
      ],
    },
  },
}
