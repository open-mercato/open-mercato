# Progress Module Specification

## Overview

The Progress module provides a generic server-side progress tracking system with real-time UI updates. It replaces the existing `entity_index_jobs` table with a more flexible, reusable solution that any module can use to track long-running operations.

**Package Location:** `packages/core/src/modules/progress/`

---

## Use Cases

| ID | Actor | Use Case | Description | Priority |
|----|-------|----------|-------------|----------|
| P1 | System | Start reindex job | System starts a reindex operation and creates a progress job | High |
| P2 | System | Update progress | Worker updates processed count and ETA periodically | High |
| P3 | User | View active jobs | User sees all running jobs in collapsible top bar | High |
| P4 | User | Expand progress pane | User clicks to see detailed progress for all jobs | Medium |
| P5 | User | Cancel job | User cancels a running job (if cancellable) | Medium |
| P6 | System | Complete job | System marks job as completed with summary | High |
| P7 | System | Fail job | System marks job as failed with error details | High |
| P8 | User | View job history | User views recently completed/failed jobs | Low |
| P9 | Admin | View org-wide jobs | Admin sees all jobs across the organization | Medium |
| P10 | System | Detect stale jobs | Heartbeat timeout marks abandoned jobs as failed | High |
| P11 | System | Partition job | System creates partitioned sub-jobs for parallel processing | Medium |
| P12 | User | See ETA | User sees estimated time remaining for running jobs | High |

---

## Database Schema

### Entity: `ProgressJob`

**Table:** `progress_jobs`

```typescript
// packages/core/src/modules/progress/data/entities.ts
import { Entity, PrimaryKey, Property, Index, OptionalProps } from '@mikro-orm/core'

export type ProgressJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

@Entity({ tableName: 'progress_jobs' })
@Index({ name: 'progress_jobs_status_tenant_idx', properties: ['status', 'tenantId'] })
@Index({ name: 'progress_jobs_type_tenant_idx', properties: ['jobType', 'tenantId'] })
@Index({ name: 'progress_jobs_parent_idx', properties: ['parentJobId'] })
export class ProgressJob {
  [OptionalProps]?: 'status' | 'progressPercent' | 'processedCount' | 'cancellable' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  // Job identification
  @Property({ name: 'job_type', type: 'text' })
  jobType!: string // e.g., 'query_index:reindex', 'import:products', 'export:customers'

  @Property({ name: 'name', type: 'text' })
  name!: string // Human-readable name, e.g., "Reindexing Products"

  @Property({ name: 'description', type: 'text', nullable: true })
  description?: string | null

  // Status tracking
  @Property({ name: 'status', type: 'text' })
  status: ProgressJobStatus = 'pending'

  // Progress metrics
  @Property({ name: 'progress_percent', type: 'smallint' })
  progressPercent: number = 0 // 0-100

  @Property({ name: 'processed_count', type: 'int' })
  processedCount: number = 0

  @Property({ name: 'total_count', type: 'int', nullable: true })
  totalCount?: number | null // NULL if unknown upfront

  @Property({ name: 'eta_seconds', type: 'int', nullable: true })
  etaSeconds?: number | null // Estimated seconds remaining

  // User tracking
  @Property({ name: 'started_by_user_id', type: 'uuid', nullable: true })
  startedByUserId?: string | null // NULL for system-initiated jobs

  // Timestamps
  @Property({ name: 'started_at', type: Date, nullable: true })
  startedAt?: Date | null

  @Property({ name: 'heartbeat_at', type: Date, nullable: true })
  heartbeatAt?: Date | null // Last worker heartbeat

  @Property({ name: 'finished_at', type: Date, nullable: true })
  finishedAt?: Date | null

  // Result data
  @Property({ name: 'result_summary', type: 'json', nullable: true })
  resultSummary?: Record<string, unknown> | null // Completion summary

  @Property({ name: 'error_message', type: 'text', nullable: true })
  errorMessage?: string | null

  @Property({ name: 'error_stack', type: 'text', nullable: true })
  errorStack?: string | null

  // Custom metadata
  @Property({ name: 'meta', type: 'json', nullable: true })
  meta?: Record<string, unknown> | null

  // Cancellation
  @Property({ name: 'cancellable', type: 'boolean' })
  cancellable: boolean = false

  @Property({ name: 'cancelled_by_user_id', type: 'uuid', nullable: true })
  cancelledByUserId?: string | null

  @Property({ name: 'cancel_requested_at', type: Date, nullable: true })
  cancelRequestedAt?: Date | null

  // Partitioning support (for parallel processing)
  @Property({ name: 'parent_job_id', type: 'uuid', nullable: true })
  parentJobId?: string | null

  @Property({ name: 'partition_index', type: 'int', nullable: true })
  partitionIndex?: number | null

  @Property({ name: 'partition_count', type: 'int', nullable: true })
  partitionCount?: number | null

  // Multi-tenant scoping
  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}
```

### SQL Migration

```sql
-- packages/core/src/modules/progress/migrations/Migration_CreateProgressJobs.ts
CREATE TABLE progress_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Job identification
  job_type TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  
  -- Status
  status TEXT NOT NULL DEFAULT 'pending',
  
  -- Progress metrics
  progress_percent SMALLINT NOT NULL DEFAULT 0,
  processed_count INTEGER NOT NULL DEFAULT 0,
  total_count INTEGER,
  eta_seconds INTEGER,
  
  -- User tracking
  started_by_user_id UUID,
  
  -- Timestamps
  started_at TIMESTAMPTZ,
  heartbeat_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  
  -- Result data
  result_summary JSONB,
  error_message TEXT,
  error_stack TEXT,
  
  -- Custom metadata
  meta JSONB,
  
  -- Cancellation
  cancellable BOOLEAN NOT NULL DEFAULT false,
  cancelled_by_user_id UUID,
  cancel_requested_at TIMESTAMPTZ,
  
  -- Partitioning
  parent_job_id UUID REFERENCES progress_jobs(id),
  partition_index INTEGER,
  partition_count INTEGER,
  
  -- Multi-tenant
  tenant_id UUID NOT NULL,
  organization_id UUID,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX progress_jobs_status_tenant_idx ON progress_jobs(status, tenant_id);
CREATE INDEX progress_jobs_type_tenant_idx ON progress_jobs(job_type, tenant_id);
CREATE INDEX progress_jobs_parent_idx ON progress_jobs(parent_job_id) WHERE parent_job_id IS NOT NULL;
CREATE INDEX progress_jobs_heartbeat_idx ON progress_jobs(heartbeat_at) WHERE status = 'running';
CREATE INDEX progress_jobs_user_idx ON progress_jobs(started_by_user_id, created_at DESC) WHERE started_by_user_id IS NOT NULL;
```

---

## Validators (Zod Schemas)

```typescript
// packages/core/src/modules/progress/data/validators.ts
import { z } from 'zod'

export const progressJobStatusSchema = z.enum(['pending', 'running', 'completed', 'failed', 'cancelled'])

export const createProgressJobSchema = z.object({
  jobType: z.string().min(1).max(100),
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  totalCount: z.number().int().positive().optional(),
  cancellable: z.boolean().optional().default(false),
  meta: z.record(z.unknown()).optional(),
  parentJobId: z.string().uuid().optional(),
  partitionIndex: z.number().int().min(0).optional(),
  partitionCount: z.number().int().positive().optional(),
})

export const updateProgressSchema = z.object({
  processedCount: z.number().int().min(0).optional(),
  progressPercent: z.number().int().min(0).max(100).optional(),
  totalCount: z.number().int().positive().optional(),
  etaSeconds: z.number().int().min(0).optional(),
  meta: z.record(z.unknown()).optional(),
})

export const completeJobSchema = z.object({
  resultSummary: z.record(z.unknown()).optional(),
})

export const failJobSchema = z.object({
  errorMessage: z.string().max(2000),
  errorStack: z.string().max(10000).optional(),
})

export const listProgressJobsSchema = z.object({
  status: z.union([progressJobStatusSchema, z.array(progressJobStatusSchema)]).optional(),
  jobType: z.string().optional(),
  parentJobId: z.string().uuid().optional(),
  includeCompleted: z.boolean().optional().default(false),
  completedSince: z.string().datetime().optional(), // ISO date
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
})

export type CreateProgressJobInput = z.infer<typeof createProgressJobSchema>
export type UpdateProgressInput = z.infer<typeof updateProgressSchema>
export type CompleteJobInput = z.infer<typeof completeJobSchema>
export type FailJobInput = z.infer<typeof failJobSchema>
export type ListProgressJobsInput = z.infer<typeof listProgressJobsSchema>
```

---

## Service Layer

```typescript
// packages/core/src/modules/progress/lib/progressService.ts
import type { EntityManager } from '@mikro-orm/core'
import type { EventBus } from '@open-mercato/events'
import { ProgressJob, type ProgressJobStatus } from '../data/entities'
import type { CreateProgressJobInput, UpdateProgressInput, CompleteJobInput, FailJobInput } from '../data/validators'

export interface ProgressServiceContext {
  tenantId: string
  organizationId?: string | null
  userId?: string | null
}

export interface ProgressService {
  /**
   * Create a new progress job
   */
  createJob(input: CreateProgressJobInput, ctx: ProgressServiceContext): Promise<ProgressJob>

  /**
   * Start a pending job (sets status to 'running' and startedAt)
   */
  startJob(jobId: string, ctx: ProgressServiceContext): Promise<ProgressJob>

  /**
   * Update progress metrics and heartbeat
   */
  updateProgress(jobId: string, input: UpdateProgressInput, ctx: ProgressServiceContext): Promise<ProgressJob>

  /**
   * Increment processed count by delta
   */
  incrementProgress(jobId: string, delta: number, ctx: ProgressServiceContext): Promise<ProgressJob>

  /**
   * Mark job as completed
   */
  completeJob(jobId: string, input?: CompleteJobInput, ctx?: ProgressServiceContext): Promise<ProgressJob>

  /**
   * Mark job as failed
   */
  failJob(jobId: string, input: FailJobInput, ctx?: ProgressServiceContext): Promise<ProgressJob>

  /**
   * Request job cancellation
   */
  cancelJob(jobId: string, ctx: ProgressServiceContext): Promise<ProgressJob>

  /**
   * Check if cancellation was requested for a job
   */
  isCancellationRequested(jobId: string): Promise<boolean>

  /**
   * Get active jobs for current tenant/org
   */
  getActiveJobs(ctx: ProgressServiceContext): Promise<ProgressJob[]>

  /**
   * Get job by ID
   */
  getJob(jobId: string, ctx: ProgressServiceContext): Promise<ProgressJob | null>

  /**
   * Detect and mark stale jobs as failed (heartbeat timeout)
   */
  markStaleJobsFailed(timeoutSeconds: number): Promise<number>
}

// Heartbeat interval and stale detection
export const HEARTBEAT_INTERVAL_MS = 5000 // 5 seconds
export const STALE_JOB_TIMEOUT_SECONDS = 60 // 1 minute without heartbeat = stale

/**
 * Calculate ETA based on progress rate
 */
export function calculateEta(
  processedCount: number,
  totalCount: number,
  startedAt: Date,
): number | null {
  if (processedCount === 0 || totalCount === 0) return null
  
  const elapsedMs = Date.now() - startedAt.getTime()
  const rate = processedCount / elapsedMs // items per ms
  const remaining = totalCount - processedCount
  
  if (rate <= 0) return null
  
  return Math.ceil(remaining / rate / 1000) // seconds
}

/**
 * Calculate progress percentage
 */
export function calculateProgressPercent(processedCount: number, totalCount: number | null): number {
  if (!totalCount || totalCount <= 0) return 0
  return Math.min(100, Math.round((processedCount / totalCount) * 100))
}
```

### Service Implementation

```typescript
// packages/core/src/modules/progress/lib/progressServiceImpl.ts
import type { EntityManager } from '@mikro-orm/core'
import type { EventBus } from '@open-mercato/events'
import { ProgressJob } from '../data/entities'
import type { ProgressService, ProgressServiceContext } from './progressService'
import { calculateEta, calculateProgressPercent, STALE_JOB_TIMEOUT_SECONDS } from './progressService'

export function createProgressService(em: EntityManager, eventBus: EventBus): ProgressService {
  return {
    async createJob(input, ctx) {
      const job = em.create(ProgressJob, {
        jobType: input.jobType,
        name: input.name,
        description: input.description,
        totalCount: input.totalCount,
        cancellable: input.cancellable ?? false,
        meta: input.meta,
        parentJobId: input.parentJobId,
        partitionIndex: input.partitionIndex,
        partitionCount: input.partitionCount,
        startedByUserId: ctx.userId,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        status: 'pending',
      })
      
      await em.persistAndFlush(job)
      
      await eventBus.emit('progress.job.created', {
        jobId: job.id,
        jobType: job.jobType,
        name: job.name,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
      })
      
      return job
    },

    async startJob(jobId, ctx) {
      const job = await em.findOneOrFail(ProgressJob, { id: jobId, tenantId: ctx.tenantId })
      
      job.status = 'running'
      job.startedAt = new Date()
      job.heartbeatAt = new Date()
      
      await em.flush()
      
      await eventBus.emit('progress.job.started', {
        jobId: job.id,
        jobType: job.jobType,
        tenantId: ctx.tenantId,
      })
      
      return job
    },

    async updateProgress(jobId, input, ctx) {
      const job = await em.findOneOrFail(ProgressJob, { id: jobId, tenantId: ctx.tenantId })
      
      if (input.processedCount !== undefined) {
        job.processedCount = input.processedCount
      }
      if (input.totalCount !== undefined) {
        job.totalCount = input.totalCount
      }
      if (input.meta !== undefined) {
        job.meta = { ...job.meta, ...input.meta }
      }
      
      // Auto-calculate progress percent if not provided
      if (input.progressPercent !== undefined) {
        job.progressPercent = input.progressPercent
      } else if (job.totalCount) {
        job.progressPercent = calculateProgressPercent(job.processedCount, job.totalCount)
      }
      
      // Auto-calculate ETA if not provided
      if (input.etaSeconds !== undefined) {
        job.etaSeconds = input.etaSeconds
      } else if (job.startedAt && job.totalCount) {
        job.etaSeconds = calculateEta(job.processedCount, job.totalCount, job.startedAt)
      }
      
      // Update heartbeat
      job.heartbeatAt = new Date()
      
      await em.flush()
      
      await eventBus.emit('progress.job.updated', {
        jobId: job.id,
        jobType: job.jobType,
        progressPercent: job.progressPercent,
        processedCount: job.processedCount,
        totalCount: job.totalCount,
        etaSeconds: job.etaSeconds,
        tenantId: ctx.tenantId,
      })
      
      return job
    },

    async incrementProgress(jobId, delta, ctx) {
      const job = await em.findOneOrFail(ProgressJob, { id: jobId, tenantId: ctx.tenantId })
      
      job.processedCount += delta
      job.heartbeatAt = new Date()
      
      if (job.totalCount) {
        job.progressPercent = calculateProgressPercent(job.processedCount, job.totalCount)
        if (job.startedAt) {
          job.etaSeconds = calculateEta(job.processedCount, job.totalCount, job.startedAt)
        }
      }
      
      await em.flush()
      
      await eventBus.emit('progress.job.updated', {
        jobId: job.id,
        progressPercent: job.progressPercent,
        processedCount: job.processedCount,
        tenantId: ctx.tenantId,
      })
      
      return job
    },

    async completeJob(jobId, input, ctx) {
      const job = await em.findOne(ProgressJob, { id: jobId })
      if (!job) throw new Error(`Job ${jobId} not found`)
      
      job.status = 'completed'
      job.finishedAt = new Date()
      job.progressPercent = 100
      job.etaSeconds = 0
      if (input?.resultSummary) {
        job.resultSummary = input.resultSummary
      }
      
      await em.flush()
      
      await eventBus.emit('progress.job.completed', {
        jobId: job.id,
        jobType: job.jobType,
        resultSummary: job.resultSummary,
        tenantId: job.tenantId,
      })
      
      return job
    },

    async failJob(jobId, input, ctx) {
      const job = await em.findOne(ProgressJob, { id: jobId })
      if (!job) throw new Error(`Job ${jobId} not found`)
      
      job.status = 'failed'
      job.finishedAt = new Date()
      job.errorMessage = input.errorMessage
      job.errorStack = input.errorStack
      
      await em.flush()
      
      await eventBus.emit('progress.job.failed', {
        jobId: job.id,
        jobType: job.jobType,
        errorMessage: job.errorMessage,
        tenantId: job.tenantId,
      })
      
      return job
    },

    async cancelJob(jobId, ctx) {
      const job = await em.findOneOrFail(ProgressJob, { 
        id: jobId, 
        tenantId: ctx.tenantId,
        cancellable: true,
        status: { $in: ['pending', 'running'] },
      })
      
      job.cancelRequestedAt = new Date()
      job.cancelledByUserId = ctx.userId
      
      // If pending, cancel immediately; if running, worker will check and cancel
      if (job.status === 'pending') {
        job.status = 'cancelled'
        job.finishedAt = new Date()
      }
      
      await em.flush()
      
      await eventBus.emit('progress.job.cancelled', {
        jobId: job.id,
        jobType: job.jobType,
        tenantId: ctx.tenantId,
      })
      
      return job
    },

    async isCancellationRequested(jobId) {
      const job = await em.findOne(ProgressJob, { id: jobId })
      return job?.cancelRequestedAt != null
    },

    async getActiveJobs(ctx) {
      return em.find(ProgressJob, {
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId ?? null,
        status: { $in: ['pending', 'running'] },
        parentJobId: null, // Only top-level jobs
      }, {
        orderBy: { createdAt: 'DESC' },
      })
    },

    async getJob(jobId, ctx) {
      return em.findOne(ProgressJob, { 
        id: jobId, 
        tenantId: ctx.tenantId,
      })
    },

    async markStaleJobsFailed(timeoutSeconds = STALE_JOB_TIMEOUT_SECONDS) {
      const cutoff = new Date(Date.now() - timeoutSeconds * 1000)
      
      const staleJobs = await em.find(ProgressJob, {
        status: 'running',
        heartbeatAt: { $lt: cutoff },
      })
      
      for (const job of staleJobs) {
        job.status = 'failed'
        job.finishedAt = new Date()
        job.errorMessage = `Job stale: no heartbeat for ${timeoutSeconds} seconds`
        
        await eventBus.emit('progress.job.failed', {
          jobId: job.id,
          jobType: job.jobType,
          errorMessage: job.errorMessage,
          tenantId: job.tenantId,
          stale: true,
        })
      }
      
      await em.flush()
      return staleJobs.length
    },
  }
}
```

---

## API Endpoints

### Route: `/api/progress/jobs`

```typescript
// packages/core/src/modules/progress/api/jobs/route.ts
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { ProgressJob } from '../../data/entities'
import { listProgressJobsSchema, createProgressJobSchema } from '../../data/validators'
import { buildProgressCrudOpenApi } from '../openapi'

export const { GET, POST } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['progress.view'] },
    POST: { requireAuth: true, requireFeatures: ['progress.create'] },
  },
  orm: {
    entity: ProgressJob,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: null,
  },
  resource: 'progress.jobs',
  list: {
    schema: listProgressJobsSchema,
    entityId: 'progress:progress_job',
    fields: ['id', 'jobType', 'name', 'status', 'progressPercent', 'processedCount', 'totalCount', 'etaSeconds', 'startedAt', 'finishedAt', 'createdAt'],
    sortFieldMap: { createdAt: 'createdAt', startedAt: 'startedAt' },
    defaultSort: [{ field: 'createdAt', order: 'desc' }],
    buildFilters: (input, ctx) => {
      const filters: Record<string, unknown> = {}
      if (input.status) {
        filters.status = Array.isArray(input.status) ? { $in: input.status } : input.status
      }
      if (input.jobType) {
        filters.jobType = input.jobType
      }
      if (input.parentJobId) {
        filters.parentJobId = input.parentJobId
      }
      if (!input.includeCompleted) {
        filters.status = { $in: ['pending', 'running'] }
      }
      if (input.completedSince) {
        filters.finishedAt = { $gte: new Date(input.completedSince) }
      }
      return filters
    },
  },
  create: {
    schema: createProgressJobSchema,
    mapToEntity: (input, ctx) => ({
      jobType: input.jobType,
      name: input.name,
      description: input.description,
      totalCount: input.totalCount,
      cancellable: input.cancellable,
      meta: input.meta,
      parentJobId: input.parentJobId,
      partitionIndex: input.partitionIndex,
      partitionCount: input.partitionCount,
      startedByUserId: ctx.auth?.sub,
      status: 'pending',
    }),
  },
})

export const openApi = buildProgressCrudOpenApi({
  resourceName: 'ProgressJob',
  listDescription: 'List progress jobs with optional filters',
  createDescription: 'Create a new progress job',
})
```

### Route: `/api/progress/jobs/[id]`

```typescript
// packages/core/src/modules/progress/api/jobs/[id]/route.ts
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { ProgressJob } from '../../../data/entities'
import { updateProgressSchema } from '../../../data/validators'

export const { GET, PUT, DELETE } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['progress.view'] },
    PUT: { requireAuth: true, requireFeatures: ['progress.update'] },
    DELETE: { requireAuth: true, requireFeatures: ['progress.cancel'] },
  },
  orm: {
    entity: ProgressJob,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
  },
  resource: 'progress.jobs',
  update: {
    schema: updateProgressSchema,
    applyToEntity: (entity, input) => {
      if (input.processedCount !== undefined) entity.processedCount = input.processedCount
      if (input.progressPercent !== undefined) entity.progressPercent = input.progressPercent
      if (input.totalCount !== undefined) entity.totalCount = input.totalCount
      if (input.etaSeconds !== undefined) entity.etaSeconds = input.etaSeconds
      if (input.meta) entity.meta = { ...entity.meta, ...input.meta }
      entity.heartbeatAt = new Date()
    },
  },
  del: {
    idFrom: 'params',
    hardDelete: false,
    beforeDelete: async (entity, ctx) => {
      // Cancel instead of delete
      if (entity.status === 'running' && entity.cancellable) {
        entity.cancelRequestedAt = new Date()
        entity.cancelledByUserId = ctx.auth?.sub
      } else if (entity.status === 'pending') {
        entity.status = 'cancelled'
        entity.finishedAt = new Date()
      }
    },
  },
})
```

### Route: `/api/progress/active`

```typescript
// packages/core/src/modules/progress/api/active/route.ts
import { resolveRequestContext } from '@open-mercato/shared/lib/api/context'
import type { EntityManager } from '@mikro-orm/core'
import { ProgressJob } from '../../data/entities'

export async function GET(req: Request) {
  const { ctx } = await resolveRequestContext(req)
  const em = ctx.container.resolve('em') as EntityManager

  const jobs = await em.find(ProgressJob, {
    tenantId: ctx.auth?.tenantId,
    organizationId: ctx.selectedOrganizationId ?? null,
    status: { $in: ['pending', 'running'] },
    parentJobId: null,
  }, {
    orderBy: { createdAt: 'DESC' },
    limit: 50,
  })

  // Also get recently completed (last 30 seconds)
  const recentCutoff = new Date(Date.now() - 30_000)
  const recentlyCompleted = await em.find(ProgressJob, {
    tenantId: ctx.auth?.tenantId,
    organizationId: ctx.selectedOrganizationId ?? null,
    status: { $in: ['completed', 'failed'] },
    finishedAt: { $gte: recentCutoff },
    parentJobId: null,
  }, {
    orderBy: { finishedAt: 'DESC' },
    limit: 10,
  })

  return Response.json({
    active: jobs.map(formatJob),
    recentlyCompleted: recentlyCompleted.map(formatJob),
  })
}

function formatJob(job: ProgressJob) {
  return {
    id: job.id,
    jobType: job.jobType,
    name: job.name,
    description: job.description,
    status: job.status,
    progressPercent: job.progressPercent,
    processedCount: job.processedCount,
    totalCount: job.totalCount,
    etaSeconds: job.etaSeconds,
    cancellable: job.cancellable,
    startedAt: job.startedAt?.toISOString(),
    finishedAt: job.finishedAt?.toISOString(),
    errorMessage: job.errorMessage,
  }
}

export const openApi = {
  GET: {
    summary: 'Get active progress jobs',
    description: 'Returns currently running jobs and recently completed jobs',
    tags: ['Progress'],
    responses: {
      200: { description: 'Active and recent jobs' },
    },
  },
}
```

---

## Events

```typescript
// packages/core/src/modules/progress/lib/events.ts
export const PROGRESS_EVENTS = {
  JOB_CREATED: 'progress.job.created',
  JOB_STARTED: 'progress.job.started',
  JOB_UPDATED: 'progress.job.updated',
  JOB_COMPLETED: 'progress.job.completed',
  JOB_FAILED: 'progress.job.failed',
  JOB_CANCELLED: 'progress.job.cancelled',
} as const

export type ProgressJobCreatedPayload = {
  jobId: string
  jobType: string
  name: string
  tenantId: string
  organizationId?: string | null
}

export type ProgressJobUpdatedPayload = {
  jobId: string
  jobType?: string
  progressPercent: number
  processedCount: number
  totalCount?: number | null
  etaSeconds?: number | null
  tenantId: string
}

export type ProgressJobCompletedPayload = {
  jobId: string
  jobType: string
  resultSummary?: Record<string, unknown> | null
  tenantId: string
}

export type ProgressJobFailedPayload = {
  jobId: string
  jobType: string
  errorMessage: string
  tenantId: string
  stale?: boolean
}
```

---

## DOM Events (Frontend)

```typescript
// packages/shared/src/lib/frontend/progressEvents.ts
export const PROGRESS_DOM_EVENTS = {
  UPDATE: 'om:progress:update',
  COMPLETE: 'om:progress:complete',
  ERROR: 'om:progress:error',
  CANCELLED: 'om:progress:cancelled',
} as const

export type ProgressUpdateDetail = {
  jobId: string
  jobType: string
  name: string
  progressPercent: number
  processedCount: number
  totalCount?: number | null
  etaSeconds?: number | null
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
}

export function emitProgressUpdate(detail: ProgressUpdateDetail): void {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return
  window.dispatchEvent(new CustomEvent(PROGRESS_DOM_EVENTS.UPDATE, { detail }))
}

export function emitProgressComplete(jobId: string, jobType: string): void {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return
  window.dispatchEvent(new CustomEvent(PROGRESS_DOM_EVENTS.COMPLETE, { detail: { jobId, jobType } }))
}

export function emitProgressError(jobId: string, errorMessage: string): void {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return
  window.dispatchEvent(new CustomEvent(PROGRESS_DOM_EVENTS.ERROR, { detail: { jobId, errorMessage } }))
}

export function subscribeProgressUpdate(handler: (detail: ProgressUpdateDetail) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const listener = (e: Event) => handler((e as CustomEvent<ProgressUpdateDetail>).detail)
  window.addEventListener(PROGRESS_DOM_EVENTS.UPDATE, listener)
  return () => window.removeEventListener(PROGRESS_DOM_EVENTS.UPDATE, listener)
}

export function subscribeProgressComplete(handler: (detail: { jobId: string; jobType: string }) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const listener = (e: Event) => handler((e as CustomEvent).detail)
  window.addEventListener(PROGRESS_DOM_EVENTS.COMPLETE, listener)
  return () => window.removeEventListener(PROGRESS_DOM_EVENTS.COMPLETE, listener)
}
```

---

## UI Components

### ProgressTopBar

```typescript
// packages/ui/src/backend/progress/ProgressTopBar.tsx
"use client"
import * as React from 'react'
import { ChevronDown, ChevronUp, Loader2, CheckCircle, XCircle, X } from 'lucide-react'
import { Button } from '../../primitives/button'
import { Progress } from '../../primitives/progress'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useProgressPoll } from './useProgressPoll'
import { cn } from '../../lib/utils'

export type ProgressTopBarProps = {
  className?: string
}

export function ProgressTopBar({ className }: ProgressTopBarProps) {
  const t = useT()
  const { activeJobs, recentlyCompleted, refresh } = useProgressPoll()
  const [expanded, setExpanded] = React.useState(false)
  
  // Persist expand state
  React.useEffect(() => {
    const saved = localStorage.getItem('om:progress:expanded')
    if (saved === 'true') setExpanded(true)
  }, [])
  
  React.useEffect(() => {
    localStorage.setItem('om:progress:expanded', String(expanded))
  }, [expanded])
  
  const hasActiveJobs = activeJobs.length > 0
  const hasRecentJobs = recentlyCompleted.length > 0
  
  if (!hasActiveJobs && !hasRecentJobs) return null
  
  return (
    <div className={cn('border-b bg-muted/30', className)}>
      {/* Collapsed summary bar */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-2 hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2 text-sm">
          {hasActiveJobs ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span>
                {t('progress.activeCount', { count: activeJobs.length })}
              </span>
              {activeJobs[0] && (
                <span className="text-muted-foreground">
                  — {activeJobs[0].name} ({activeJobs[0].progressPercent}%)
                </span>
              )}
            </>
          ) : (
            <>
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span className="text-muted-foreground">
                {t('progress.recentlyCompleted', { count: recentlyCompleted.length })}
              </span>
            </>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4" />
        ) : (
          <ChevronDown className="h-4 w-4" />
        )}
      </button>
      
      {/* Expanded job list */}
      {expanded && (
        <div className="px-4 pb-3 space-y-2">
          {activeJobs.map((job) => (
            <ProgressJobCard key={job.id} job={job} onCancel={refresh} />
          ))}
          {recentlyCompleted.map((job) => (
            <ProgressJobCard key={job.id} job={job} />
          ))}
        </div>
      )}
    </div>
  )
}

type ProgressJob = {
  id: string
  jobType: string
  name: string
  description?: string | null
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  progressPercent: number
  processedCount: number
  totalCount?: number | null
  etaSeconds?: number | null
  cancellable: boolean
  errorMessage?: string | null
}

function ProgressJobCard({ job, onCancel }: { job: ProgressJob; onCancel?: () => void }) {
  const t = useT()
  const [cancelling, setCancelling] = React.useState(false)
  
  const handleCancel = async () => {
    if (!job.cancellable || cancelling) return
    setCancelling(true)
    try {
      await fetch(`/api/progress/jobs/${job.id}`, { method: 'DELETE' })
      onCancel?.()
    } finally {
      setCancelling(false)
    }
  }
  
  const isActive = job.status === 'pending' || job.status === 'running'
  const isFailed = job.status === 'failed'
  const isCompleted = job.status === 'completed'
  
  return (
    <div className={cn(
      'rounded-md border p-3',
      isFailed && 'border-destructive/50 bg-destructive/5',
      isCompleted && 'border-green-500/50 bg-green-50/50 dark:bg-green-950/20',
    )}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {isActive && <Loader2 className="h-4 w-4 animate-spin text-primary flex-shrink-0" />}
            {isCompleted && <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />}
            {isFailed && <XCircle className="h-4 w-4 text-destructive flex-shrink-0" />}
            <span className="font-medium truncate">{job.name}</span>
          </div>
          
          {job.description && (
            <p className="text-sm text-muted-foreground mt-1 truncate">{job.description}</p>
          )}
          
          {isFailed && job.errorMessage && (
            <p className="text-sm text-destructive mt-1">{job.errorMessage}</p>
          )}
        </div>
        
        {isActive && job.cancellable && (
          <Button
            variant="ghost"
            size="icon"
            onClick={handleCancel}
            disabled={cancelling}
            className="flex-shrink-0"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
      
      {isActive && (
        <div className="mt-2 space-y-1">
          <Progress value={job.progressPercent} className="h-2" />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>
              {job.totalCount
                ? `${job.processedCount.toLocaleString()} / ${job.totalCount.toLocaleString()}`
                : `${job.processedCount.toLocaleString()} processed`
              }
            </span>
            {job.etaSeconds != null && job.etaSeconds > 0 && (
              <span>{formatEta(job.etaSeconds, t)}</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function formatEta(seconds: number, t: (key: string, params?: Record<string, unknown>) => string): string {
  if (seconds < 60) {
    return t('progress.eta.seconds', { count: seconds })
  }
  if (seconds < 3600) {
    const minutes = Math.ceil(seconds / 60)
    return t('progress.eta.minutes', { count: minutes })
  }
  const hours = Math.floor(seconds / 3600)
  const mins = Math.ceil((seconds % 3600) / 60)
  return t('progress.eta.hoursMinutes', { hours, minutes: mins })
}
```

### useProgressPoll Hook

```typescript
// packages/ui/src/backend/progress/useProgressPoll.ts
"use client"
import * as React from 'react'
import { apiCall } from '../utils/apiCall'
import { subscribeProgressUpdate, subscribeProgressComplete } from '@open-mercato/shared/lib/frontend/progressEvents'

export type ProgressJob = {
  id: string
  jobType: string
  name: string
  description?: string | null
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  progressPercent: number
  processedCount: number
  totalCount?: number | null
  etaSeconds?: number | null
  cancellable: boolean
  startedAt?: string | null
  finishedAt?: string | null
  errorMessage?: string | null
}

export type UseProgressPollResult = {
  activeJobs: ProgressJob[]
  recentlyCompleted: ProgressJob[]
  isLoading: boolean
  error: string | null
  refresh: () => void
}

const POLL_INTERVAL = 5000 // 5 seconds

export function useProgressPoll(): UseProgressPollResult {
  const [activeJobs, setActiveJobs] = React.useState<ProgressJob[]>([])
  const [recentlyCompleted, setRecentlyCompleted] = React.useState<ProgressJob[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const refreshTrigger = React.useRef(0)
  
  const fetchJobs = React.useCallback(async () => {
    try {
      const result = await apiCall<{ active: ProgressJob[]; recentlyCompleted: ProgressJob[] }>(
        '/api/progress/active'
      )
      if (result.ok && result.result) {
        setActiveJobs(result.result.active)
        setRecentlyCompleted(result.result.recentlyCompleted)
        setError(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch progress')
    } finally {
      setIsLoading(false)
    }
  }, [])
  
  const refresh = React.useCallback(() => {
    refreshTrigger.current++
    fetchJobs()
  }, [fetchJobs])
  
  // Initial fetch and polling
  React.useEffect(() => {
    fetchJobs()
    const interval = setInterval(fetchJobs, POLL_INTERVAL)
    return () => clearInterval(interval)
  }, [fetchJobs])
  
  // Subscribe to DOM events for instant updates
  React.useEffect(() => {
    const unsubUpdate = subscribeProgressUpdate(() => refresh())
    const unsubComplete = subscribeProgressComplete(() => refresh())
    return () => {
      unsubUpdate()
      unsubComplete()
    }
  }, [refresh])
  
  return { activeJobs, recentlyCompleted, isLoading, error, refresh }
}
```

---

## ACL (Features)

```typescript
// packages/core/src/modules/progress/acl.ts
export const features = [
  'progress.view',
  'progress.create',
  'progress.update',
  'progress.cancel',
  'progress.manage', // Admin-level access to all jobs
]
```

---

## i18n Keys

```json
// packages/core/src/modules/progress/i18n/en.json
{
  "progress": {
    "title": "Progress",
    "activeCount": "{count, plural, one {# operation running} other {# operations running}}",
    "recentlyCompleted": "{count, plural, one {# operation completed} other {# operations completed}}",
    "eta": {
      "seconds": "{count}s remaining",
      "minutes": "{count}m remaining",
      "hoursMinutes": "{hours}h {minutes}m remaining"
    },
    "status": {
      "pending": "Pending",
      "running": "Running",
      "completed": "Completed",
      "failed": "Failed",
      "cancelled": "Cancelled"
    },
    "actions": {
      "cancel": "Cancel",
      "retry": "Retry",
      "dismiss": "Dismiss"
    },
    "errors": {
      "notFound": "Job not found",
      "cannotCancel": "This job cannot be cancelled",
      "alreadyFinished": "Job has already finished"
    }
  }
}
```

---

## DI Registration

```typescript
// packages/core/src/modules/progress/di.ts
import type { AwilixContainer } from 'awilix'
import { asFunction } from 'awilix'
import { createProgressService } from './lib/progressServiceImpl'

export function register(container: AwilixContainer): void {
  container.register({
    progressService: asFunction(({ em, eventBus }) => 
      createProgressService(em, eventBus)
    ).scoped(),
  })
}
```

---

## Migration from entity_index_jobs

### Migration Steps

1. **Create `progress_jobs` table** via migration
2. **Update reindex operations** in `packages/core/src/modules/query_index/` to use `ProgressService`
3. **Update search reindex** in `packages/search/` to use `ProgressService`
4. **Deprecate old API** - add deprecation warnings to old endpoints
5. **Drop `entity_index_jobs`** after transition period

### Example: Updating Reindexer

```typescript
// Before (using entity_index_jobs directly)
await prepareJob(knex, jobScope, 'reindexing', { totalCount: total })
await updateJobProgress(knex, jobScope, processedDelta)

// After (using ProgressService)
const progressService = container.resolve('progressService') as ProgressService
const job = await progressService.createJob({
  jobType: 'query_index:reindex',
  name: `Reindexing ${entityType}`,
  totalCount: total,
  cancellable: true,
  meta: { entityType, partitionIndex, partitionCount },
}, ctx)

await progressService.startJob(job.id, ctx)

// In batch loop:
await progressService.incrementProgress(job.id, batchSize, ctx)

// Check for cancellation:
if (await progressService.isCancellationRequested(job.id)) {
  // Clean up and exit
}

// On completion:
await progressService.completeJob(job.id, { resultSummary: { processed, skipped } })
```

---

## Test Scenarios

| Scenario | Given | When | Then |
|----------|-------|------|------|
| Create job | User initiates reindex | POST /api/progress/jobs | Job created with status 'pending' |
| Start job | Job in pending state | Worker calls startJob | Status changes to 'running', startedAt set |
| Update progress | Job is running | Worker calls incrementProgress | progressPercent and ETA updated |
| Complete job | Job finishes successfully | Worker calls completeJob | Status 'completed', finishedAt set |
| Fail job | Job encounters error | Worker calls failJob | Status 'failed', errorMessage set |
| Cancel job | User cancels running job | DELETE /api/progress/jobs/:id | cancelRequestedAt set, worker will stop |
| Stale detection | Job has no heartbeat for 60s | Scheduler runs markStaleJobsFailed | Job marked as failed with stale error |
| View active | User opens admin panel | GET /api/progress/active | Returns running and recently completed jobs |
| Poll updates | Progress pane open | Poll every 5s | UI reflects current progress |
