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

export const cacheStatsResponseSchema = z.object({
  total: z.number().int().describe('Total cache entries'),
  segments: z.record(z.string(), z.number().int()).describe('Cache entries per segment'),
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
