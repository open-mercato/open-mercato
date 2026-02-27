import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { rejectAction } from '../../../../../../lib/executionEngine'
import {
  resolveRequestContext,
  resolveActionAndProposal,
  toExecutionContext,
  handleRouteError,
  isErrorResponse,
} from '../../../../../routeHelpers'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['inbox_ops.proposals.manage'] },
}

export async function POST(req: Request) {
  try {
    const ctx = await resolveRequestContext(req)
    const resolved = await resolveActionAndProposal(new URL(req.url), ctx)
    if (isErrorResponse(resolved)) return resolved

    if (resolved.action.status !== 'pending' && resolved.action.status !== 'failed') {
      return NextResponse.json({ error: 'Action already processed' }, { status: 409 })
    }

    await rejectAction(resolved.action, toExecutionContext(ctx))

    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleRouteError(err, 'reject action')
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
