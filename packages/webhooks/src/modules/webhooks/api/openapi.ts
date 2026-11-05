import { createCrudOpenApiFactory } from '@open-mercato/shared/lib/openapi/crud'

export const buildWebhooksCrudOpenApi = createCrudOpenApiFactory({
  defaultTag: 'Webhooks',
})
