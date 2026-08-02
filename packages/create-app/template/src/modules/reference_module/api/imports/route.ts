import { NextResponse } from 'next/server'
import { z } from 'zod'
import { runWithCacheTenant, type CacheStrategy } from '@open-mercato/cache'
import type { ProgressService } from '@open-mercato/core/modules/progress/lib/progressService'
import { resolveReferenceRouteContext } from '../context'
import {
  getReferenceTaskImportQueue,
  hashReferenceImportKey,
  parseReferenceImportCsv,
  REFERENCE_IMPORT_MAX_BYTES,
  type ReferenceTaskImportJobPayload,
} from '../../lib/task-import'

const acceptedResponseSchema = z.object({
  jobId: z.string().uuid(),
  status: z.literal('pending'),
  totalCount: z.number().int().positive(),
})

type AcceptedResponse = z.infer<typeof acceptedResponseSchema>

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['reference_module.import'] },
}

export const openApi = {
  tags: ['Reference Module'],
  summary: 'Queue a bounded reference task CSV import',
  methods: {
    POST: {
      summary: 'Queue reference tasks for import',
      responses: [
        { status: 202, description: 'Import queued', schema: acceptedResponseSchema },
        { status: 400, description: 'Invalid CSV import' },
        { status: 401, description: 'Unauthorized' },
        { status: 413, description: 'Import exceeds byte or row limits' },
      ],
    },
  },
}

function invalid(message: string, status = 400): NextResponse {
  return NextResponse.json({ error: message }, { status })
}

export async function POST(request: Request): Promise<NextResponse> {
  const context = await resolveReferenceRouteContext(request)
  if (!context) return invalid('Unauthorized', 401)
  const declaredLength = Number(request.headers.get('content-length') ?? 0)
  if (declaredLength > REFERENCE_IMPORT_MAX_BYTES + 64 * 1024) return invalid('Import file is too large', 413)
  const idempotencyKey = request.headers.get('idempotency-key')?.trim() ?? ''
  if (!idempotencyKey || idempotencyKey.length > 200) return invalid('A valid Idempotency-Key header is required')

  let file: File
  let csv: string
  let rows: Array<Record<string, string>>
  try {
    const form = await request.formData()
    const files = form.getAll('file')
    if (files.length !== 1 || !(files[0] instanceof File)) return invalid('Exactly one CSV file is required')
    file = files[0]
    if (file.size > REFERENCE_IMPORT_MAX_BYTES) return invalid('Import file is too large', 413)
    const bytes = await file.arrayBuffer()
    csv = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    rows = parseReferenceImportCsv(csv)
  } catch (error) {
    const message = error instanceof TypeError ? 'Import file must be valid UTF-8' : 'Import CSV is invalid'
    return invalid(message)
  }

  const idempotencyKeyHash = hashReferenceImportKey(idempotencyKey)
  const cache = context.container.resolve('cacheService') as CacheStrategy
  const cacheKey = `reference_module:${context.scope.organizationId}:import:${idempotencyKeyHash}`
  const duplicate = await runWithCacheTenant(context.scope.tenantId, () => cache.get(cacheKey))
  const duplicateResult = acceptedResponseSchema.safeParse(duplicate)
  if (duplicateResult.success) return NextResponse.json(duplicateResult.data, { status: 202 })

  const progressService = context.container.resolve('progressService') as ProgressService
  const progressContext = { ...context.scope, userId: context.auth.sub }
  const progressJob = await progressService.createJob({
    jobType: 'reference_module.tasks.import',
    name: 'Reference task CSV import',
    description: `${rows.length} rows queued`,
    totalCount: rows.length,
    cancellable: true,
    meta: { source: 'reference_module.csv', idempotencyKeyHash },
  }, progressContext)
  const response: AcceptedResponse = { jobId: progressJob.id, status: 'pending', totalCount: rows.length }
  const payload: ReferenceTaskImportJobPayload = {
    progressJobId: progressJob.id,
    csv,
    idempotencyKeyHash,
    scope: progressContext,
  }
  try {
    await getReferenceTaskImportQueue().enqueue(payload)
    await runWithCacheTenant(context.scope.tenantId, () => cache.set(cacheKey, response, {
      ttl: 24 * 60 * 60 * 1000,
      tags: [`reference_module:imports:organization:${context.scope.organizationId}`],
    }))
  } catch (error) {
    await progressService.failJob(progressJob.id, { errorMessage: 'Import could not be queued' }, progressContext)
    throw error
  }
  return NextResponse.json(acceptedResponseSchema.parse(response), { status: 202 })
}
