import { z } from 'zod'

/**
 * Queue Status Dashboard (#3105) — Tier 1 (payload-free) types.
 *
 * Zod is the source of truth here (unlike `system-status.types.ts`'s plain TS
 * types) because this snapshot crosses a security boundary: it is built from
 * optional, strategy-dependent `Queue` methods whose shape is worth validating
 * at the point it is assembled, not just trusted at compile time.
 */

export const queueFidelitySchema = z.enum(['exact', 'partial'])
export type QueueFidelity = z.infer<typeof queueFidelitySchema>

export const failedJobSummarySchema = z.object({
  id: z.string(),
  queue: z.string(),
  type: z.string().optional(),
  workerId: z.string().optional(),
  /**
   * Stable, safe failure code (e.g. `queue.handler_error`). Raw failure text is NEVER part of
   * this broadly-granted Tier 1 response — it can echo tenant data or credentials.
   */
  errorCode: z.string().optional(),
  attemptsMade: z.number().optional(),
  failedAt: z.number().optional(),
})
export type FailedJobSummaryDto = z.infer<typeof failedJobSummarySchema>

export const queueProcessingStatsSchema = z.object({
  sampleSize: z.number(),
  lastProcessingMs: z.number().optional(),
  avgProcessingMs: z.number().optional(),
  p95ProcessingMs: z.number().optional(),
  avgWaitMs: z.number().optional(),
  lastCompletedAt: z.number().optional(),
  fidelity: queueFidelitySchema.optional(),
})
export type QueueProcessingStatsDto = z.infer<typeof queueProcessingStatsSchema>

export const inFlightJobSummarySchema = z.object({
  id: z.string(),
  queue: z.string(),
  type: z.string().optional(),
  workerId: z.string().optional(),
  state: z.enum(['active', 'waiting', 'delayed']),
  enqueuedAt: z.number().optional(),
  startedAt: z.number().optional(),
  runningMs: z.number().optional(),
  ageMs: z.number().optional(),
  attemptsMade: z.number().optional(),
})
export type InFlightJobSummaryDto = z.infer<typeof inFlightJobSummarySchema>

export const queueStatusEntrySchema = z.object({
  queue: z.string(),
  /** Worker ids declared for this queue by registered modules. */
  workerIds: z.array(z.string()),
  /** Declared concurrency per worker, for correlating a backlog with a worker. */
  concurrency: z.number().nullable(),
  strategy: z.enum(['local', 'async']),
  /**
   * Honest fidelity label — the local strategy's counts/metrics are derived/
   * partial, not exact live numbers; the UI must say so rather than imply
   * precision the strategy cannot provide.
   */
  fidelity: queueFidelitySchema,
  counts: z.object({
    waiting: z.number(),
    active: z.number(),
    completed: z.number(),
    failed: z.number(),
    delayed: z.number().optional(),
  }),
  /** Present only when the strategy implements getFailedJobsSummary. */
  failedJobs: z.array(failedJobSummarySchema).optional(),
  /** True when failedJobs is omitted because the strategy cannot supply it (never because there are none). */
  failedJobsUnavailable: z.boolean(),
  /** Present only when the strategy implements getProcessingStats. */
  processingStats: queueProcessingStatsSchema.optional(),
  /** Present only when the strategy implements getInFlightJobsSummary. */
  inFlight: z.array(inFlightJobSummarySchema).optional(),
  agedWaiting: z.array(inFlightJobSummarySchema).optional(),
  inFlightUnavailable: z.boolean(),
  /**
   * Stable error code (`queue_unavailable` | `queue_read_failed`) set when this queue's
   * introspection calls threw or timed out; the entry still renders with an error state. Never
   * carries raw exception text.
   */
  error: z.string().optional(),
})
export type QueueStatusEntryDto = z.infer<typeof queueStatusEntrySchema>

export const queueStatusSnapshotSchema = z.object({
  generatedAt: z.string(),
  /** Echoes the server-applied filters (after validation/clamping), so the UI knows what it's looking at. */
  filter: z.object({
    queue: z.string().nullable(),
    type: z.string().nullable(),
  }),
  queues: z.array(queueStatusEntrySchema),
  /** True when the session holds configs.queues_status.inspect_payloads — gates the click-through affordance. */
  canInspectPayloads: z.boolean(),
})
export type QueueStatusSnapshot = z.infer<typeof queueStatusSnapshotSchema>

// ---------------------------------------------------------------------------
// Tier 2 — Job Inspector (privileged). Types only; the route/lib enforce the
// tenant isolation and redaction this DTO's shape implies.
// ---------------------------------------------------------------------------

export const inspectedJobSchema = z.object({
  id: z.string(),
  queue: z.string(),
  state: z.string().optional(),
  type: z.string().optional(),
  attemptsMade: z.number().optional(),
  timestamp: z.number().optional(),
  processedOn: z.number().optional(),
  finishedOn: z.number().optional(),
  failedReason: z.string().optional(),
  /** Tenant the job belongs to, per its own envelope — null when it could not be determined. */
  tenantId: z.string().nullable(),
  organizationId: z.string().nullable().optional(),
  /** Redaction-applied payload tree — never the raw job data. */
  data: z.unknown(),
})
export type InspectedJobDto = z.infer<typeof inspectedJobSchema>

export const jobInspectorResponseSchema = z.object({
  jobs: z.array(inspectedJobSchema),
  /** True for a superadmin actor whose response may include jobs outside their own tenant. */
  crossTenant: z.boolean(),
})
export type JobInspectorResponse = z.infer<typeof jobInspectorResponseSchema>
