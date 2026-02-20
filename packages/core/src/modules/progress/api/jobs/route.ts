import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { FilterQuery } from '@mikro-orm/core'
import { ProgressJob } from '../../data/entities'
import { createProgressJobSchema } from '../../data/validators'
import {
  createProgressCrudOpenApi,
  createPagedListResponseSchema,
} from '../openapi'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['progress.view'] },
  POST: { requireAuth: true, requireFeatures: ['progress.create'] },
}

export const metadata = routeMetadata

const listQuerySchema = z.object({
  status: z.string().optional(),
  jobType: z.string().optional(),
  parentJobId: z.string().uuid().optional(),
  includeCompleted: z.enum(['true', 'false']).optional(),
  completedSince: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
  search: z.string().optional(),
  sortField: z.enum(['createdAt', 'startedAt', 'finishedAt']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
}).loose()

type JobRow = {
  id: string
  jobType: string
  name: string
  description: string | null
  status: string
  progressPercent: number
  processedCount: number
  totalCount: number | null
  etaSeconds: number | null
  cancellable: boolean
  startedAt: string | null
  finishedAt: string | null
  errorMessage: string | null
  createdAt: string | null
  tenantId: string
  organizationId: string | null
}

const toRow = (job: ProgressJob): JobRow => ({
  id: String(job.id),
  jobType: String(job.jobType),
  name: String(job.name),
  description: job.description ?? null,
  status: job.status,
  progressPercent: job.progressPercent,
  processedCount: job.processedCount,
  totalCount: job.totalCount ?? null,
  etaSeconds: job.etaSeconds ?? null,
  cancellable: !!job.cancellable,
  startedAt: job.startedAt ? job.startedAt.toISOString() : null,
  finishedAt: job.finishedAt ? job.finishedAt.toISOString() : null,
  errorMessage: job.errorMessage ?? null,
  createdAt: job.createdAt ? job.createdAt.toISOString() : null,
  tenantId: String(job.tenantId),
  organizationId: job.organizationId ? String(job.organizationId) : null,
})

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.tenantId) {
    return NextResponse.json({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 }, { status: 401 })
  }

  const url = new URL(req.url)
  const parsed = listQuerySchema.safeParse({
    status: url.searchParams.get('status') ?? undefined,
    jobType: url.searchParams.get('jobType') ?? undefined,
    parentJobId: url.searchParams.get('parentJobId') ?? undefined,
    includeCompleted: url.searchParams.get('includeCompleted') ?? undefined,
    completedSince: url.searchParams.get('completedSince') ?? undefined,
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
    search: url.searchParams.get('search') ?? undefined,
    sortField: url.searchParams.get('sortField') ?? undefined,
    sortDir: url.searchParams.get('sortDir') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 }, { status: 400 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager

  const { status, jobType, parentJobId, includeCompleted, completedSince, page, pageSize, search, sortField, sortDir } = parsed.data
  const filter: FilterQuery<ProgressJob> = {
    tenantId: auth.tenantId,
  }

  if (auth.orgId) {
    filter.organizationId = auth.orgId
  }

  if (status) {
    const statusValues = status.split(',')
    filter.status = statusValues.length > 1 ? { $in: statusValues as never } : status as never
  } else if (includeCompleted !== 'true') {
    filter.status = { $in: ['pending', 'running'] }
  }

  if (jobType) filter.jobType = jobType
  if (parentJobId) filter.parentJobId = parentJobId
  if (completedSince) filter.finishedAt = { $gte: new Date(completedSince) }

  if (search) {
    filter.$or = [
      { name: { $ilike: `%${search}%` } },
      { jobType: { $ilike: `%${search}%` } },
    ]
  }

  const fieldMap: Record<string, string> = {
    createdAt: 'createdAt',
    startedAt: 'startedAt',
    finishedAt: 'finishedAt',
  }
  const orderBy: Record<string, 'ASC' | 'DESC'> = {}
  if (sortField) {
    const mapped = fieldMap[sortField] || 'createdAt'
    orderBy[mapped] = sortDir === 'asc' ? 'ASC' : 'DESC'
  } else {
    orderBy.createdAt = 'DESC'
  }

  const [all, total] = await em.findAndCount(ProgressJob, filter, { orderBy })
  const start = (page - 1) * pageSize
  const paged = all.slice(start, start + pageSize)
  const items = paged.map(toRow)
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return NextResponse.json({ items, total, page, pageSize, totalPages })
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const parsed = createProgressJobSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  const container = await createRequestContainer()
  const progressService = container.resolve('progressService') as import('../../lib/progressService').ProgressService

  const job = await progressService.createJob(parsed.data, {
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    userId: auth.sub,
  })

  return NextResponse.json({ id: job.id }, { status: 201 })
}

const jobListItemSchema = z.object({
  id: z.string().uuid(),
  jobType: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  progressPercent: z.number(),
  processedCount: z.number(),
  totalCount: z.number().nullable(),
  etaSeconds: z.number().nullable(),
  cancellable: z.boolean(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string().nullable(),
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid().nullable(),
})

export const openApi = createProgressCrudOpenApi({
  resourceName: 'ProgressJob',
  pluralName: 'ProgressJobs',
  querySchema: listQuerySchema,
  listResponseSchema: createPagedListResponseSchema(jobListItemSchema),
  create: {
    schema: createProgressJobSchema,
    description: 'Creates a new progress job for tracking a long-running operation.',
  },
})
