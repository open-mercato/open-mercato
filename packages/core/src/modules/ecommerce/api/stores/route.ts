import { z } from 'zod'
import { withCreateConflictRecheck } from '../../lib/createConflictRecheck'
import { storeCrud, storeListQuerySchema, storeRouteMetadata } from './crud'
import { ecommerceStoreCreateSchema, ecommerceStoreUpdateSchema } from '../../data/validators'
import { createEcommerceCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from '../openapi'

export const metadata = storeRouteMetadata

export const GET = storeCrud.GET
export const POST = withCreateConflictRecheck(storeCrud.POST)
export const PUT = storeCrud.PUT
export const DELETE = storeCrud.DELETE

export const storeListItemSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid().nullable(),
  tenantId: z.string().uuid().nullable(),
  code: z.string(),
  name: z.string(),
  slug: z.string(),
  status: z.enum(['draft', 'active', 'archived']),
  defaultLocale: z.string(),
  supportedLocales: z.array(z.string()),
  defaultCurrencyCode: z.string(),
  isPrimary: z.boolean(),
  settings: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
})

export const openApi = createEcommerceCrudOpenApi({
  resourceName: 'Store',
  pluralName: 'Stores',
  querySchema: storeListQuerySchema,
  listResponseSchema: createPagedListResponseSchema(storeListItemSchema),
  create: {
    schema: ecommerceStoreCreateSchema,
    responseSchema: z.object({
      id: z.string().uuid().nullable(),
      isPrimary: z
        .boolean()
        .describe('Whether the created store is the organization primary store. False when a concurrent request won the promotion.'),
    }),
    description:
      'Creates a store in the selected organization. Requesting isPrimary clears the previous primary store of the organization. A duplicate code or slug is rejected with a field-level 409. A non-empty settings.branding requires ecommerce.branding.manage and is otherwise rejected with a 403 field error.',
  },
  update: {
    schema: ecommerceStoreUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description:
      'Updates a store by id (id in the body). Any change to settings.branding is rejected with a 400 field error: branding is written through PUT /api/ecommerce/stores/{id}/branding. Setting isPrimary clears the previous primary store of the organization.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description:
      'Soft-deletes a store by id (?id= query parameter). Its live domain and channel bindings are soft-deleted with it, releasing their domain and path prefix, and each emits its own deleted event.',
  },
})
