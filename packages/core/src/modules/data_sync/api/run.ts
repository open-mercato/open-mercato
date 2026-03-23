import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { getIntegration } from '@open-mercato/shared/modules/integrations/types'
import type { ProgressService } from '../../progress/lib/progressService'
import type { IntegrationStateService } from '../../integrations/lib/state-service'
import type { SyncRunService } from '../lib/sync-run-service'
import { runSyncSchema } from '../data/validators'
import { startDataSyncRun } from '../lib/start-run'
import { getDataSyncAdapter } from '../lib/adapter-registry'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['data_sync.run'] },
}

export const openApi = {
  tags: ['DataSync'],
  summary: 'Start a data sync run',
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const payload = await readJsonSafe(req)
  const parsed = runSyncSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 422 })
  }

  const container = await createRequestContainer()
  const syncRunService = container.resolve('dataSyncRunService') as SyncRunService
  const progressService = container.resolve('progressService') as ProgressService
  const integrationStateService = container.resolve('integrationStateService') as IntegrationStateService

  const scope = {
    organizationId: auth.orgId as string,
    tenantId: auth.tenantId,
  }

  const integration = getIntegration(parsed.data.integrationId)
  if (!integration?.providerKey) {
    return NextResponse.json({ error: 'Integration not found' }, { status: 404 })
  }

  const adapter = getDataSyncAdapter(integration.providerKey)
  if (!adapter) {
    return NextResponse.json({ error: 'No registered sync adapter for provider' }, { status: 404 })
  }

  if (!adapter.supportedEntities.includes(parsed.data.entityType)) {
    return NextResponse.json({ error: 'Unsupported entity type for this integration' }, { status: 422 })
  }

  const integrationEnabled = await integrationStateService.isEnabled(parsed.data.integrationId, scope)
  if (!integrationEnabled) {
    return NextResponse.json({ error: 'Integration is disabled' }, { status: 409 })
  }

  const overlap = await syncRunService.findRunningOverlap(
    parsed.data.integrationId,
    parsed.data.entityType,
    parsed.data.direction,
    scope,
  )
  if (overlap) {
    return NextResponse.json({ error: 'A sync run is already in progress for this integration and entity direction' }, { status: 409 })
  }

  const cursor = parsed.data.fullSync
    ? null
    : await syncRunService.resolveCursor(parsed.data.integrationId, parsed.data.entityType, parsed.data.direction, scope)

  const { run, progressJob } = await startDataSyncRun({
    syncRunService,
    progressService,
    scope: {
      ...scope,
      userId: auth.sub,
    },
    input: {
      integrationId: parsed.data.integrationId,
      entityType: parsed.data.entityType,
      direction: parsed.data.direction,
      cursor,
      triggeredBy: parsed.data.triggeredBy ?? auth.sub,
      batchSize: parsed.data.batchSize,
    },
  })

  return NextResponse.json({ id: run.id, progressJobId: progressJob?.id ?? null }, { status: 201 })
}
