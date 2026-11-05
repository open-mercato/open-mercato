import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { runWithCacheTenant } from '@open-mercato/cache'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import { acceptAllActions } from '../../../../lib/executionEngine'
import { resolveCache, invalidateCountsCache } from '../../../../lib/cache'
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

    const guardResult = await validateCrudMutationGuard(ctx.container, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      resourceKind: 'inbox_ops:inbox_proposal',
      resourceId: proposal.id,
      operation: 'custom',
      requestMethod: req.method,
      requestHeaders: req.headers,
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }

    const entities = resolveCrossModuleEntities(ctx.container)
    const { results, stoppedOnFailure } = await acceptAllActions(
      proposal.id,
      toExecutionContext(ctx, entities),
    )

    const succeeded = results.filter((r) => r.success).length
    const failed = results.filter((r) => !r.success).length

    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(ctx.container, {
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        resourceKind: 'inbox_ops:inbox_proposal',
        resourceId: proposal.id,
        operation: 'custom',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }

    const cache = resolveCache(ctx.container)
    await runWithCacheTenant(ctx.tenantId, () => invalidateCountsCache(cache, ctx.tenantId))

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
