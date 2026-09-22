import { z } from 'zod'
import { customerGroupCrud, customerGroupListQuerySchema, customerGroupRouteMetadata } from './crud'
import { customerGroupCreateSchema, customerGroupUpdateSchema } from '../../data/validators'
import { createCustomerGroupsCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from '../openapi'

// GET (list, or detail via ?id=) + POST (create) + PUT (update, id in body) + DELETE
// (?id=) — `makeCrudRoute`'s generated handlers already read the record id from the
// query string / body, so a single route file covers the whole resource with no
// Next.js `[id]` dynamic segment needed. Matches
// `catalog/api/price-kinds/route.ts` (the closest precedent for this entity's
// nullable-org scoping) exactly.
export const metadata = customerGroupRouteMetadata

export const GET = customerGroupCrud.GET
export const POST = customerGroupCrud.POST
export const PUT = customerGroupCrud.PUT
export const DELETE = customerGroupCrud.DELETE

export const customerGroupListItemSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  kind: z.string(),
  parent_id: z.string().uuid().nullable().optional(),
  priority: z.number(),
  is_default: z.boolean(),
  is_active: z.boolean(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export const openApi = createCustomerGroupsCrudOpenApi({
  resourceName: 'CustomerGroup',
  pluralName: 'CustomerGroups',
  querySchema: customerGroupListQuerySchema,
  listResponseSchema: createPagedListResponseSchema(customerGroupListItemSchema),
  create: {
    schema: customerGroupCreateSchema,
    responseSchema: z.object({ id: z.string().uuid().nullable() }),
    description: 'Creates a customer group scoped to the authenticated tenant.',
  },
  update: {
    schema: customerGroupUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates a customer group by id.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes a customer group by id.',
  },
})
