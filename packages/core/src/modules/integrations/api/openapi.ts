import { z, type ZodTypeAny } from 'zod'
import { createCrudOpenApiFactory, createPagedListResponseSchema as createSharedPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { integrationMarketplaceHealthStatusSchema } from '../data/validators'

export function createPagedListResponseSchema(itemSchema: ZodTypeAny) {
  return createSharedPagedListResponseSchema(itemSchema, { paginationMetaOptional: true })
}

export const integrationAnalyticsSchema = z.object({
  lastActivityAt: z.string().nullable(),
  totalCount: z.number(),
  errorCount: z.number(),
  errorRate: z.number(),
  dailyCounts: z.array(z.number()),
})

export const integrationInfoSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  category: z.string().nullable(),
  tags: z.array(z.string()),
  hub: z.string().nullable(),
  providerKey: z.string().nullable(),
  bundleId: z.string().nullable(),
  author: z.string().nullable().optional(),
  company: z.string().nullable().optional(),
  version: z.string().nullable().optional(),
  hasCredentials: z.boolean(),
  isEnabled: z.boolean(),
  apiVersion: z.string().nullable(),
  healthStatus: integrationMarketplaceHealthStatusSchema,
  lastHealthCheckedAt: z.string().nullable(),
  lastHealthLatencyMs: z.number().nullable(),
  enabledAt: z.string().nullable(),
  analytics: integrationAnalyticsSchema,
})

export const integrationBundleSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  icon: z.string().nullable(),
  integrationCount: z.number(),
  enabledCount: z.number(),
})

export const integrationsListResponseSchema = createPagedListResponseSchema(integrationInfoSchema).extend({
  bundles: z.array(integrationBundleSummarySchema),
})

export const buildIntegrationsCrudOpenApi = createCrudOpenApiFactory({
  defaultTag: 'Integrations',
})
