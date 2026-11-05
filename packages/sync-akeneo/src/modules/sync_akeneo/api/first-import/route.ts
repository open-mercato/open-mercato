import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { ProgressJob } from '@open-mercato/core/modules/progress/data/entities'
import type { ProgressService } from '@open-mercato/core/modules/progress/lib/progressService'
import { getSyncQueue } from '@open-mercato/core/modules/data_sync/lib/queue'
import type { SyncRunService } from '@open-mercato/core/modules/data_sync/lib/sync-run-service'
import {
  AKENEO_FIRST_IMPORT_QUEUE,
  getAkeneoFirstImportStatus,
} from '../../lib/first-import'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['data_sync.configure'] },
  POST: { requireAuth: true, requireFeatures: ['data_sync.run'] },
}

export const openApi = {
  GET: {
    tags: ['Akeneo'],
    summary: 'Get the current Akeneo first-import sequence status',
  },
  POST: {
    tags: ['Akeneo'],
    summary: 'Start the first full Akeneo import sequence',
  },
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const container = await createRequestContainer()
  const syncRunService = container.resolve('dataSyncRunService') as SyncRunService
  const status = await getAkeneoFirstImportStatus({
    container,
    scope: {
      organizationId: auth.orgId,
      tenantId: auth.tenantId,
    },
  })
  const completedProductRuns = await syncRunService.listRuns(
    {
      integrationId: 'sync_akeneo',
      entityType: 'products',
      direction: 'import',
      status: 'completed',
      page: 1,
      pageSize: 1,
    },
    {
      organizationId: auth.orgId,
      tenantId: auth.tenantId,
    },
  )

  return NextResponse.json({
    ok: true,
    sequence: status,
    hasCompletedProductImport: completedProductRuns.total > 0,
  })
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const progressService = container.resolve('progressService') as ProgressService
  const scope = {
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
    userId: auth.sub,
  }

  const [activeJob] = await findWithDecryption(
    em,
    ProgressJob,
    {
      jobType: 'sync_akeneo.first_import',
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      status: { $in: ['pending', 'running'] },
    },
    {
      limit: 1,
      orderBy: { createdAt: 'DESC' },
    },
    scope,
  )

  if (activeJob) {
    return NextResponse.json(
      {
        ok: false,
        error: 'The first full Akeneo import is already running.',
      },
      { status: 409 },
    )
  }

  const progressJob = await progressService.createJob(
    {
      jobType: 'sync_akeneo.first_import',
      name: 'Akeneo first full import',
      description: 'Categories, attributes, then products',
      totalCount: 3,
      cancellable: false,
      meta: {
        integrationId: 'sync_akeneo',
        workflow: 'first_import',
        hiddenFromTopBar: true,
        currentStep: null,
        currentRunId: null,
      },
    },
    scope,
  )

  const queue = getSyncQueue(AKENEO_FIRST_IMPORT_QUEUE)
  await queue.enqueue({
    progressJobId: progressJob.id,
    scope,
  })

  return NextResponse.json({
    ok: true,
    progressJobId: progressJob.id,
  }, { status: 202 })
}
