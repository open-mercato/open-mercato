import { z } from 'zod'

export const tenantScopeSchema = z.object({
  organizationId: z.string().uuid(),
  tenantId: z.string().uuid(),
})

export const saveCredentialsSchema = z.object({
  credentials: z.record(z.string(), z.unknown()),
})

export type SaveCredentialsInput = z.infer<typeof saveCredentialsSchema>

export const updateVersionSchema = z.object({
  apiVersion: z.string().min(1),
})

export type UpdateVersionInput = z.infer<typeof updateVersionSchema>

export const updateStateSchema = z.object({
  isEnabled: z.boolean().optional(),
  reauthRequired: z.boolean().optional(),
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
