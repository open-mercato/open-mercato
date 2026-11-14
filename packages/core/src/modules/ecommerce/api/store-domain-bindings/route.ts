import { z } from 'zod'
import { withCreateConflictRecheck } from '../../lib/createConflictRecheck'
import { domainBindingCrud, domainBindingListQuerySchema, domainBindingRouteMetadata } from './crud'
import {
  ecommerceStoreDomainBindingCreateSchema,
  ecommerceStoreDomainBindingUpdateSchema,
} from '../../data/validators'
import { createEcommerceCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from '../openapi'

export const metadata = domainBindingRouteMetadata

export const GET = domainBindingCrud.GET
export const POST = withCreateConflictRecheck(domainBindingCrud.POST)
export const PUT = domainBindingCrud.PUT
export const DELETE = domainBindingCrud.DELETE

const domainBindingMappingSchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('found'),
    hostname: z.string(),
    status: z.string().describe('pending, verified, active, dns_failed or tls_failed. Only active serves.'),
    lastDnsCheckAt: z.string().nullable(),
    dnsFailureReason: z.string().nullable(),
    tlsFailureReason: z.string().nullable(),
  }),
  z.object({ state: z.literal('removed') }),
  z.object({ state: z.literal('unavailable') }),
])

export const domainBindingListItemSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid().nullable(),
  tenantId: z.string().uuid().nullable(),
  storeId: z.string().uuid(),
  domainMappingId: z.string().uuid(),
  pathPrefix: z.string().nullable(),
  isPrimary: z.boolean(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  _domainMapping: domainBindingMappingSchema
    .optional()
    .describe(
      'Added by the ecommerce.store-domain-binding-mapping response enricher: the bound customer_accounts domain mapping as read through domainMappingService. state is removed when the mapping no longer exists and unavailable when it could not be read.',
    ),
})

export const openApi = createEcommerceCrudOpenApi({
  resourceName: 'StoreDomainBinding',
  pluralName: 'StoreDomainBindings',
  querySchema: domainBindingListQuerySchema,
  listResponseSchema: createPagedListResponseSchema(domainBindingListItemSchema),
  create: {
    schema: ecommerceStoreDomainBindingCreateSchema,
    responseSchema: z.object({
      id: z.string().uuid().nullable(),
      isPrimary: z
        .boolean()
        .describe('Whether the created binding is the primary binding of its store. False when a concurrent request won the promotion.'),
    }),
    description:
      'Binds a customer_accounts domain mapping (any status) and optional path prefix to a store of the same organization. A duplicate domain and path prefix is rejected with a field-level 409. Requesting isPrimary clears the previous primary binding of the store.',
  },
  update: {
    schema: ecommerceStoreDomainBindingUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates a store domain binding by id (id in the body). Setting isPrimary clears the previous primary binding of the store.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes a store domain binding by id (?id= query parameter).',
  },
})
