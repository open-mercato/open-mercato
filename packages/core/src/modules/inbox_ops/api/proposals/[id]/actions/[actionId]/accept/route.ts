import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { runWithCacheTenant } from '@open-mercato/cache'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { InboxProposal, InboxProposalAction } from '../../../../../../data/entities'
import { executeAction } from '../../../../../../lib/executionEngine'
import { resolveCache, invalidateCountsCache } from '../../../../../../lib/cache'
import {
  resolveRequestContext,
  resolveActionAndProposal,
  resolveCrossModuleEntities,
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

    const entities = resolveCrossModuleEntities(ctx.container)
    const result = await executeAction(resolved.action, toExecutionContext(ctx, entities))

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to execute action' },
        { status: result.statusCode || 400 },
      )
    }

    const freshAction = await findOneWithDecryption(
      ctx.em,
      InboxProposalAction,
      { id: resolved.action.id, deletedAt: null },
      undefined,
      ctx.scope,
    )

    const freshProposal = await findOneWithDecryption(
      ctx.em,
      InboxProposal,
      { id: resolved.proposal.id, deletedAt: null },
      undefined,
      ctx.scope,
    )

    const cache = resolveCache(ctx.container)
    await runWithCacheTenant(ctx.tenantId, () => invalidateCountsCache(cache, ctx.tenantId))

    return NextResponse.json({
      ok: true,
      action: freshAction ? {
        id: freshAction.id,
        status: freshAction.status,
        createdEntityId: freshAction.createdEntityId,
        createdEntityType: freshAction.createdEntityType,
        executedAt: freshAction.executedAt,
        executedByUserId: freshAction.executedByUserId,
      } : null,
      proposal: freshProposal ? {
        id: freshProposal.id,
        status: freshProposal.status,
      } : null,
    })
  } catch (err) {
    return handleRouteError(err, 'execute action')
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
