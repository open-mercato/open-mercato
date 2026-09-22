import { z } from 'zod'
import {
  customerGroupMembershipCrud,
  customerGroupMembershipListQuerySchema,
  customerGroupMembershipRouteMetadata,
} from './crud'
import {
  customerGroupMembershipCreateSchema,
  customerGroupMembershipUpdateSchema,
} from '../../../data/validators'
import { createCustomerGroupsCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from '../../openapi'

// GET (list, or detail via ?id=) + POST (create) + PUT (update, id in body) +
// DELETE (?id=) — one shared `makeCrudRoute` instance covers the whole
// resource, no `[id]` dynamic segment. Mirrors `../route.ts` (the base
// `CustomerGroup` route) exactly.
export const metadata = customerGroupMembershipRouteMetadata

export const GET = customerGroupMembershipCrud.GET
export const POST = customerGroupMembershipCrud.POST
export const PUT = customerGroupMembershipCrud.PUT
export const DELETE = customerGroupMembershipCrud.DELETE

export const customerGroupMembershipListItemSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  group_id: z.string().uuid(),
  customer_id: z.string().uuid(),
  source: z.string(),
  valid_from: z.string().nullable().optional(),
  valid_until: z.string().nullable().optional(),
  assigned_by_user_id: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  // Optimistic locking (default ON — root AGENTS.md § Always): the list/detail
  // response returns `updated_at` (same field name the base `CustomerGroup`
  // route returns) so `CrudForm`/`buildOptimisticLockHeader` can auto-derive
  // the lock header from it.
  updated_at: z.string().nullable().optional(),
})

export const openApi = createCustomerGroupsCrudOpenApi({
  resourceName: 'CustomerGroupMembership',
  pluralName: 'CustomerGroupMemberships',
  querySchema: customerGroupMembershipListQuerySchema,
  listResponseSchema: createPagedListResponseSchema(customerGroupMembershipListItemSchema),
  create: {
    schema: customerGroupMembershipCreateSchema,
    responseSchema: z.object({ id: z.string().uuid().nullable() }),
    description: 'Adds a customer to a customer group, scoped to the authenticated tenant.',
  },
  update: {
    schema: customerGroupMembershipUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates a customer group membership by id.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes a customer group membership by id.',
  },
})
