import { z } from 'zod'

export const configsTag = 'Configs'

// ============================================================================
// Common Schemas
// ============================================================================

export const configErrorSchema = z
  .object({
    error: z.string(),
    details: z.any().optional(),
  })
  .passthrough()

// ============================================================================
// System Status Schemas
// ============================================================================

export const systemStatusResponseSchema = z.object({
  env: z.string().describe('Current environment (development, production, etc.)'),
  version: z.string().describe('Application version'),
  nodeVersion: z.string().describe('Node.js version'),
  platform: z.string().describe('Operating system platform'),
  uptime: z.number().describe('Process uptime in seconds'),
  memoryUsage: z.object({
    rss: z.number().describe('Resident Set Size in bytes'),
    heapTotal: z.number().describe('Total heap size in bytes'),
    heapUsed: z.number().describe('Used heap size in bytes'),
    external: z.number().describe('External memory usage in bytes'),
  }),
  databaseConnected: z.boolean().describe('Database connection status'),
  cacheConnected: z.boolean().describe('Cache service connection status'),
})

export const purgeCacheResponseSchema = z.object({
  cleared: z.boolean().describe('Whether cache was successfully cleared'),
})

// ============================================================================
// Cache Management Schemas
// ============================================================================

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

// ============================================================================
// Upgrade Actions Schemas
// ============================================================================

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
