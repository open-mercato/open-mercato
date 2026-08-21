import { z } from 'zod'

export const configsTag = 'Configs'

export const configErrorSchema = z
  .object({
    error: z.string(),
    details: z.unknown().optional(),
  })
  .passthrough()

const systemStatusCategoryKeySchema = z.enum([
  'profiling',
  'logging',
  'security',
  'caching',
  'query_index',
  'entities',
])

const systemStatusVariableKindSchema = z.enum(['boolean', 'string'])

const systemStatusStateSchema = z.enum([
  'enabled',
  'disabled',
  'set',
  'unset',
  'unknown',
])

const systemStatusRuntimeModeSchema = z.enum([
  'development',
  'production',
  'test',
  'unknown',
])

const systemStatusItemSchema = z.object({
  key: z.string(),
  category: systemStatusCategoryKeySchema,
  kind: systemStatusVariableKindSchema,
  labelKey: z.string(),
  descriptionKey: z.string(),
  docUrl: z.string().nullable(),
  defaultValue: z.string().nullable(),
  state: systemStatusStateSchema,
  value: z.string().nullable(),
  normalizedValue: z.string().nullable(),
})

const systemStatusCategorySchema = z.object({
  key: systemStatusCategoryKeySchema,
  labelKey: z.string(),
  descriptionKey: z.string().nullable(),
  items: z.array(systemStatusItemSchema),
})

export const systemStatusResponseSchema = z.object({
  generatedAt: z.string().describe('Snapshot generation timestamp (ISO-8601)'),
  runtimeMode: systemStatusRuntimeModeSchema.describe('Current runtime mode'),
  categories: z.array(systemStatusCategorySchema).describe('Grouped system status variables by category'),
})

export const purgeCacheResponseSchema = z.object({
  cleared: z.boolean().describe('Whether cache was successfully cleared'),
})

const cacheSegmentInfoSchema = z.object({
  segment: z.string().describe('Sanitized segment identifier'),
  resource: z.string().nullable().describe('Resource the segment maps to, when resolvable'),
  method: z.string().nullable().describe('HTTP method the segment maps to, when resolvable'),
  path: z.string().nullable().describe('Request path the segment maps to, when resolvable'),
  keyCount: z.number().int().describe('Number of cache keys in the segment'),
  keys: z.array(z.string()).describe('Cache keys contained in the segment'),
})

export const cacheStatsResponseSchema = z.object({
  generatedAt: z.string().describe('Snapshot generation timestamp (ISO-8601)'),
  totalKeys: z.number().int().describe('Total cache keys across all segments'),
  segments: z.array(cacheSegmentInfoSchema).describe('Per-segment cache breakdown'),
})

export const cachePurgeRequestSchema = z.object({
  action: z.enum(['purgeAll', 'purgeSegment']).describe('Cache purge action type'),
  segment: z.string().optional().describe('Segment identifier (required for purgeSegment action)'),
})

export const cachePurgeAllResponseSchema = z.object({
  action: z.literal('purgeAll'),
  stats: cacheStatsResponseSchema,
})

export const cachePurgeSegmentResponseSchema = z.object({
  action: z.literal('purgeSegment'),
  segment: z.string(),
  deleted: z.number().int().describe('Number of entries deleted'),
  stats: cacheStatsResponseSchema,
})

export const upgradeActionSchema = z.object({
  id: z.string().describe('Upgrade action unique identifier'),
  version: z.string().describe('Version this action applies to'),
  message: z.string().describe('Localized description of the upgrade action'),
  ctaLabel: z.string().describe('Call-to-action button label'),
  successMessage: z.string().describe('Success message after execution'),
  loadingLabel: z.string().describe('Loading state label during execution'),
})

export const upgradeActionsListResponseSchema = z.object({
  version: z.string().describe('Current application version'),
  actions: z.array(upgradeActionSchema).describe('List of pending upgrade actions'),
})

export const executeUpgradeActionRequestSchema = z.object({
  actionId: z.string().min(1).describe('Upgrade action ID to execute'),
})

export const executeUpgradeActionResponseSchema = z.object({
  status: z.string().describe('Execution status'),
  message: z.string().describe('Localized success message'),
  version: z.string().describe('Application version'),
})

const moduleResourceSurfaceSchema = z.enum(['api', 'subscriber', 'worker', 'custom'])

const moduleResourceUsageEntrySchema = z.object({
  moduleId: z.string(),
  surface: moduleResourceSurfaceSchema,
  operation: z.string(),
  resourceId: z.string().nullable(),
  calls: z.number().int(),
  errors: z.number().int(),
  totalDurationMs: z.number(),
  maxDurationMs: z.number(),
  p95DurationMs: z.number(),
  totalCpuUserMs: z.number(),
  totalCpuSystemMs: z.number(),
  maxCpuMs: z.number(),
  totalHeapDeltaBytes: z.number(),
  positiveHeapDeltaBytes: z.number(),
  maxHeapDeltaBytes: z.number(),
  totalRssDeltaBytes: z.number(),
  positiveRssDeltaBytes: z.number(),
  maxRssDeltaBytes: z.number(),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
})

const moduleResourceUsageSurfaceSummarySchema = z.object({
  surface: moduleResourceSurfaceSchema,
  calls: z.number().int(),
  errors: z.number().int(),
  totalDurationMs: z.number(),
  p95DurationMs: z.number(),
  totalCpuMs: z.number(),
  positiveHeapDeltaBytes: z.number(),
  positiveRssDeltaBytes: z.number(),
})

const moduleResourceUsageModuleSummarySchema = z.object({
  moduleId: z.string(),
  calls: z.number().int(),
  errors: z.number().int(),
  totalDurationMs: z.number(),
  p95DurationMs: z.number(),
  totalCpuMs: z.number(),
  positiveHeapDeltaBytes: z.number(),
  positiveRssDeltaBytes: z.number(),
  surfaces: z.array(moduleResourceUsageSurfaceSummarySchema),
  topOperations: z.array(moduleResourceUsageEntrySchema),
  candidateReasons: z.array(z.string()),
})

const moduleResourceUsageBucketModuleSchema = z.object({
  moduleId: z.string(),
  calls: z.number().int(),
  errors: z.number().int(),
  totalDurationMs: z.number(),
  p95DurationMs: z.number(),
  totalCpuMs: z.number(),
  positiveHeapDeltaBytes: z.number(),
  positiveRssDeltaBytes: z.number(),
  surfaces: z.array(moduleResourceUsageSurfaceSummarySchema),
  topOperations: z.array(moduleResourceUsageEntrySchema),
  candidateReasons: z.array(z.string()),
})

const moduleResourceUsageBucketSchema = z.object({
  bucketStart: z.string().describe('UTC bucket start timestamp (ISO-8601)'),
  bucketEnd: z.string().describe('UTC bucket end timestamp (ISO-8601)'),
  bucketIntervalMs: z.number().int().describe('Bucket size used for this specific bucket in milliseconds'),
  stage: z.enum(['startup', 'running']).describe('Lifecycle stage for this telemetry bucket'),
  partial: z.boolean().describe('True when the bucket does not represent a complete process-observed interval'),
  totals: z.object({
    modules: z.number().int(),
    calls: z.number().int(),
    errors: z.number().int(),
    totalDurationMs: z.number(),
    totalCpuMs: z.number(),
    positiveHeapDeltaBytes: z.number(),
    positiveRssDeltaBytes: z.number(),
  }),
  modules: z.array(moduleResourceUsageBucketModuleSchema),
})

const moduleTelemetryReportSchema = z.object({
  generatedAt: z.string().describe('Report generation timestamp (ISO-8601)'),
  startedAt: z.string().describe('Telemetry aggregation start timestamp (ISO-8601)'),
  enabled: z.boolean().describe('Whether module resource tracking is enabled'),
  bucketIntervalMs: z.number().int().describe('Bucket size in milliseconds; module telemetry uses 5-minute buckets in every environment'),
  totals: z.object({
    modules: z.number().int(),
    operations: z.number().int(),
    calls: z.number().int(),
    errors: z.number().int(),
    totalDurationMs: z.number(),
    totalCpuMs: z.number(),
    positiveHeapDeltaBytes: z.number(),
    positiveRssDeltaBytes: z.number(),
  }),
  thresholds: z.object({
    p95DurationMs: z.number(),
    cpuMs: z.number(),
    positiveHeapDeltaBytes: z.number(),
    positiveRssDeltaBytes: z.number(),
    errors: z.number(),
  }),
  modules: z.array(moduleResourceUsageModuleSummarySchema),
  candidates: z.array(moduleResourceUsageModuleSummarySchema),
  buckets: z.array(moduleResourceUsageBucketSchema),
})

export const moduleTelemetryResponseSchema = moduleTelemetryReportSchema.extend({
  canClearTelemetry: z.boolean().optional(),
})

export const moduleTelemetryClearResponseSchema = z.object({
  cleared: z.boolean(),
})
