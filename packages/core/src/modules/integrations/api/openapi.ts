import { z, type ZodTypeAny } from 'zod'
import { createCrudOpenApiFactory, createPagedListResponseSchema as createSharedPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'

export function createPagedListResponseSchema(itemSchema: ZodTypeAny) {
  return createSharedPagedListResponseSchema(itemSchema, { paginationMetaOptional: true })
}

export const integrationInfoSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string().nullable(),
  hub: z.string().nullable(),
  providerKey: z.string().nullable(),
  bundleId: z.string().nullable(),
  hasCredentials: z.boolean(),
  isEnabled: z.boolean(),
  apiVersion: z.string().nullable(),
})

export const buildIntegrationsCrudOpenApi = createCrudOpenApiFactory({
  defaultTag: 'Integrations',
})
