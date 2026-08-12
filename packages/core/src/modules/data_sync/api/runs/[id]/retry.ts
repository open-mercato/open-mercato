import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { organizationScopeRequiredResponse, resolveActiveOrganizationId } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { ProgressService } from '../../../../progress/lib/progressService'
import type { SyncRunService } from '../../../lib/sync-run-service'
import { getIntegration } from '@open-mercato/shared/modules/integrations/types'
import { retrySyncSchema } from '../../../data/validators'
import { startDataSyncRun } from '../../../lib/start-run'
import { getDataSyncAdapter } from '../../../lib/adapter-registry'
import { normalizeRunParameters } from '../../../lib/run-parameters'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'

const paramsSchema = z.object({ id: z.string().uuid() })

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['data_sync.run'] },
}

export const openApi = {
  tags: ['DataSync'],
  summary: 'Retry a failed sync run',
}

export async function POST(req: Request, ctx: { params?: Promise<{ id?: string }> | { id?: string } }) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) {
    return organizationScopeRequiredResponse()
  }

  const rawParams = (ctx.params && typeof (ctx.params as Promise<unknown>).then === 'function')
    ? await (ctx.params as Promise<{ id?: string }>)
    : (ctx.params as { id?: string } | undefined)

  const parsedParams = paramsSchema.safeParse(rawParams)
  if (!parsedParams.success) {
    return NextResponse.json({ error: 'Invalid run id' }, { status: 400 })
  }

  const payload = await readJsonSafe(req)
  const parsedBody = retrySyncSchema.safeParse(payload ?? {})
  if (!parsedBody.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsedBody.error.flatten() }, { status: 422 })
  }

  const container = await createRequestContainer()
  const syncRunService = container.resolve('dataSyncRunService') as SyncRunService
  const progressService = container.resolve('progressService') as ProgressService
  const scope = { organizationId, tenantId: auth.tenantId }

  const previous = await syncRunService.getRun(parsedParams.data.id, scope)
  if (!previous) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  }
  if (previous.status !== 'failed' && previous.status !== 'cancelled') {
    return NextResponse.json({ error: 'Only failed or cancelled runs can be retried' }, { status: 409 })
  }

  const overlap = await syncRunService.findRunningOverlap(
    previous.integrationId,
    previous.entityType,
    previous.direction,
    scope,
  )
  if (overlap) {
    return NextResponse.json({ error: 'A sync run is already in progress for this integration and entity direction' }, { status: 409 })
  }

  const guardResult = await validateCrudMutationGuard(container, {
    tenantId: auth.tenantId,
    organizationId: scope.organizationId,
    userId: auth.sub,
    resourceKind: 'data_sync.run',
    resourceId: previous.id,
    operation: 'custom',
    requestMethod: req.method,
    requestHeaders: req.headers,
    mutationPayload: { action: 'retry', ...parsedBody.data },
  })
  if (guardResult && !guardResult.ok) {
    return NextResponse.json(guardResult.body, { status: guardResult.status })
  }

  // A retry replays the stored parameters, but the adapter's declaration may
  // have moved on since the original run — a parameter dropped, a bound
  // tightened, a select option removed, a scope narrowed. Re-normalize against
  // the current declaration so an adapter never receives a set the run API
  // would reject today. Undeclared keys fall away silently; values that are now
  // invalid stop the retry, because the operator has no form here to fix them.
  const retryIntegration = getIntegration(previous.integrationId)
  const retryAdapter = retryIntegration?.providerKey ? getDataSyncAdapter(retryIntegration.providerKey) : null
  const normalizedParameters = normalizeRunParameters(
    retryAdapter?.runParameters,
    previous.direction,
    previous.parameters ?? null,
    previous.entityType,
  )
  if (!normalizedParameters.ok) {
    return NextResponse.json(
      {
        error: 'Stored run parameters are no longer valid for this integration. Start a new run from the Data Sync dashboard.',
        details: { parameters: normalizedParameters.errors },
      },
      { status: 422 },
    )
  }
  const retryParameters = Object.keys(normalizedParameters.values).length > 0
    ? normalizedParameters.values
    : null

  const cursor = parsedBody.data.fromBeginning
    ? null
    : previous.cursor ?? await syncRunService.resolveCursor(previous.integrationId, previous.entityType, previous.direction, scope)

  const { run, progressJob } = await startDataSyncRun({
    syncRunService,
    progressService,
    scope: {
      ...scope,
      userId: auth.sub,
    },
    input: {
      integrationId: previous.integrationId,
      entityType: previous.entityType,
      direction: previous.direction,
      cursor,
      triggeredBy: auth.sub,
      batchSize: 100,
      parameters: retryParameters,
      progressJob: {
        name: `Retry data sync ${previous.integrationId} — ${previous.entityType}`,
      },
    },
  })

  if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
    await runCrudMutationGuardAfterSuccess(container, {
      tenantId: auth.tenantId,
      organizationId: scope.organizationId,
      userId: auth.sub,
      resourceKind: 'data_sync.run',
      resourceId: run.id,
      operation: 'custom',
      requestMethod: req.method,
      requestHeaders: req.headers,
      metadata: guardResult.metadata ?? null,
    })
  }

  return NextResponse.json({ id: run.id, progressJobId: progressJob?.id ?? null }, { status: 201 })
}
