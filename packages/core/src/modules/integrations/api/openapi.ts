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

export const integrationOAuthGrantSummarySchema = z.object({
  status: z.enum(['active', 'invalidated', 'unavailable']),
})

export const integrationDetailPageConfigSchema = z.object({
  widgetSpotId: z.string().optional(),
  hiddenTabs: z.array(z.enum(['credentials', 'version', 'health', 'logs', 'data-sync-schedule'])).optional(),
  connectTabId: z.string().optional(),
})

export const integrationDetailStateSchema = z.object({
  isEnabled: z.boolean(),
  apiVersion: z.string().nullable(),
  reauthRequired: z.boolean(),
  lastHealthStatus: z.string().nullable(),
  lastHealthCheckedAt: z.string().nullable(),
  lastHealthLatencyMs: z.number().nullable(),
  enabledAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
})

export const integrationDetailDefinitionSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  category: z.string().optional(),
  hub: z.string().optional(),
  providerKey: z.string().optional(),
  bundleId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  detailPage: integrationDetailPageConfigSchema.optional(),
}).passthrough()

export const integrationDetailResponseSchema = z.object({
  integration: integrationDetailDefinitionSchema,
  bundle: z.object({ id: z.string(), title: z.string() }).passthrough().optional(),
  bundleIntegrations: z.array(
    integrationDetailDefinitionSchema.extend({
      isEnabled: z.boolean(),
      state: integrationDetailStateSchema,
    }),
  ),
  state: integrationDetailStateSchema,
  hasCredentials: z.boolean(),
  credentialsUpdatedAt: z.string().nullable(),
  healthStatus: integrationMarketplaceHealthStatusSchema,
  analytics: integrationAnalyticsSchema,
  oauthGrant: integrationOAuthGrantSummarySchema
    .nullable()
    .describe('Status of the tenant-level OAuth grant of the active organization; null when the integration has no live grant'),
})
