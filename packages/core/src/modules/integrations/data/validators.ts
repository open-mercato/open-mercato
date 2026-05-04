import { z } from 'zod'

export const saveCredentialsSchema = z.object({
  credentials: z.record(
    z.string().min(1).max(128),
    z.union([z.string().max(20_000), z.number(), z.boolean(), z.null()]),
  ),
}).refine((value) => Object.keys(value.credentials).length <= 200, {
  message: 'At most 200 credential fields are allowed',
})

export type SaveCredentialsInput = z.infer<typeof saveCredentialsSchema>

export const updateVersionSchema = z.object({
  apiVersion: z.string().min(1),
})

export type UpdateVersionInput = z.infer<typeof updateVersionSchema>

export const updateStateSchema = z.object({
  isEnabled: z.boolean().optional(),
  reauthRequired: z.boolean().optional(),
}).refine((value) => value.isEnabled !== undefined || value.reauthRequired !== undefined, {
  message: 'At least one state field must be provided',
})

export type UpdateStateInput = z.infer<typeof updateStateSchema>

export const integrationLogLevelSchema = z.enum(['info', 'warn', 'error'])

export const listIntegrationLogsQuerySchema = z.object({
  integrationId: z.string().min(1).optional(),
  level: integrationLogLevelSchema.optional(),
  runId: z.string().uuid().optional(),
  entityType: z.string().optional(),
  entityId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export type ListIntegrationLogsQuery = z.infer<typeof listIntegrationLogsQuerySchema>

const optionalBooleanQuery = z.preprocess((value) => {
  if (value === undefined || value === '' || value === null) return undefined
  if (value === true || value === 'true' || value === '1') return true
  if (value === false || value === 'false' || value === '0') return false
  return value
}, z.boolean().optional()).optional()

export const integrationMarketplaceHealthStatusSchema = z.enum(['healthy', 'degraded', 'unhealthy', 'unconfigured'])

export const listIntegrationsQuerySchema = z.object({
  q: z.string().max(200).optional(),
  category: z.string().max(64).optional(),
  bundleId: z.string().max(128).optional(),
  isEnabled: optionalBooleanQuery,
  healthStatus: integrationMarketplaceHealthStatusSchema.optional(),
  sort: z.enum(['title', 'category', 'enabledAt', 'healthStatus']).optional(),
  order: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(100),
})

export type ListIntegrationsQuery = z.infer<typeof listIntegrationsQuerySchema>
