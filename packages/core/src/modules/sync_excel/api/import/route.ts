import type { EntityManager } from '@mikro-orm/postgresql'
import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { z } from 'zod'
import type { ProgressService } from '@open-mercato/core/modules/progress/lib/progressService'
import type { SyncRunService } from '@open-mercato/core/modules/data_sync/lib/sync-run-service'
import { startDataSyncRun } from '@open-mercato/core/modules/data_sync/lib/start-run'
import { SyncMapping } from '@open-mercato/core/modules/data_sync/data/entities'
import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import type { IntegrationStateService } from '@open-mercato/core/modules/integrations/lib/state-service'
import { SyncExcelUpload } from '../../data/entities'
import { Attachment } from '../../../attachments/data/entities'
import { createCursor } from '../../lib/adapters/customers'
import {
  syncExcelImportRequestSchema,
  syncExcelImportResponseSchema,
} from '../../data/validators'
import { resolveSyncExcelConcreteScope } from '../../lib/scope'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['sync_excel.run'] },
}

const errorSchema = z.object({
  error: z.string(),
})

export const openApi = {
  tags: ['SyncExcel'],
  summary: 'Start a CSV import run for a stored sync_excel upload',
  methods: {
    POST: {
      summary: 'Start CSV import',
      responses: [
        { status: 201, description: 'Import run started', schema: syncExcelImportResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 404, description: 'Upload not found', schema: errorSchema },
        { status: 409, description: 'Import overlap detected', schema: errorSchema },
        { status: 422, description: 'Invalid import payload', schema: errorSchema },
      ],
    },
  },
}

export async function POST(request: Request) {
  const auth = await getAuthFromRequest(request)
  if (!auth?.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const payload = await readJsonSafe(request)
  const parsedPayload = syncExcelImportRequestSchema.safeParse(payload)
  if (!parsedPayload.success) {
    return NextResponse.json({ error: 'Invalid import payload.' }, { status: 422 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const syncRunService = container.resolve('dataSyncRunService') as SyncRunService
  const progressService = container.resolve('progressService') as ProgressService
  const credentialsService = container.resolve('integrationCredentialsService') as CredentialsService
  const integrationStateService = container.resolve('integrationStateService') as IntegrationStateService
  const scopeResult = await resolveSyncExcelConcreteScope({ auth, container, request })
  if (!scopeResult.ok) {
    return NextResponse.json({ error: scopeResult.error }, { status: scopeResult.status })
  }
  const { scope } = scopeResult

  const upload = await findOneWithDecryption(
    em,
    SyncExcelUpload,
    {
      id: parsedPayload.data.uploadId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    },
    undefined,
    scope,
  )

  if (!upload) {
    return NextResponse.json({ error: 'Upload preview not found.' }, { status: 404 })
  }

  const attachment = await findOneWithDecryption(
    em,
    Attachment,
    {
      id: upload.attachmentId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    },
    undefined,
    scope,
  )

  if (!attachment) {
    return NextResponse.json({ error: 'Upload attachment not found.' }, { status: 404 })
  }

  if (upload.entityType !== parsedPayload.data.entityType) {
    return NextResponse.json({ error: 'Upload entity type does not match requested import target.' }, { status: 422 })
  }

  if (parsedPayload.data.mapping.entityType !== parsedPayload.data.entityType) {
    return NextResponse.json({ error: 'Mapping entity type does not match requested import target.' }, { status: 422 })
  }

  const overlap = await syncRunService.findRunningOverlap('sync_excel', parsedPayload.data.entityType, 'import', scope)
  if (overlap) {
    return NextResponse.json({ error: 'A sync_excel import is already in progress for this entity type.' }, { status: 409 })
  }

  const existingMapping = await findOneWithDecryption(
    em,
    SyncMapping,
    {
      integrationId: 'sync_excel',
      entityType: parsedPayload.data.entityType,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    },
    undefined,
    scope,
  )

  if (existingMapping) {
    existingMapping.mapping = parsedPayload.data.mapping
  } else {
    em.persist(em.create(SyncMapping, {
      integrationId: 'sync_excel',
      entityType: parsedPayload.data.entityType,
      mapping: parsedPayload.data.mapping,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    }))
  }

  await credentialsService.save('sync_excel', {}, scope)
  await integrationStateService.upsert('sync_excel', { isEnabled: true }, scope)
  await em.flush()

  const { run, progressJob } = await startDataSyncRun({
    syncRunService,
    progressService,
    scope: {
      ...scope,
      userId: auth.sub,
    },
    input: {
      integrationId: 'sync_excel',
      entityType: parsedPayload.data.entityType,
      direction: 'import',
      cursor: createCursor(upload.id, 0),
      triggeredBy: auth.sub,
      batchSize: parsedPayload.data.batchSize ?? 100,
      progressJob: {
        jobType: 'sync_excel:import',
        name: `CSV import — ${parsedPayload.data.entityType}`,
        description: upload.filename,
        meta: {
          integrationId: 'sync_excel',
          uploadId: upload.id,
          hiddenFromTopBar: false,
        },
      },
    },
  })

  upload.syncRunId = run.id
  upload.status = 'importing'
  await em.flush()

  return NextResponse.json(syncExcelImportResponseSchema.parse({
    runId: run.id,
    progressJobId: progressJob?.id ?? null,
    status: run.status,
  }), { status: 201 })
}
