import { z } from 'zod'
import { channelBindingCrud, channelBindingListQuerySchema, channelBindingRouteMetadata } from './crud'
import {
  ecommerceStoreChannelBindingCreateSchema,
  ecommerceStoreChannelBindingUpdateSchema,
} from '../../data/validators'
import { createEcommerceCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from '../openapi'

export const metadata = channelBindingRouteMetadata

export const GET = channelBindingCrud.GET
export const POST = channelBindingCrud.POST
export const PUT = channelBindingCrud.PUT
export const DELETE = channelBindingCrud.DELETE

const assortmentScopeSchema = z
  .object({
    categoryIds: z.array(z.string().uuid()).optional(),
    tagIds: z.array(z.string().uuid()).optional(),
    excludeProductIds: z.array(z.string().uuid()).optional(),
    excludeCategoryIds: z.array(z.string().uuid()).optional(),
    excludeTagIds: z.array(z.string().uuid()).optional(),
  })
  .nullable()

export const channelBindingListItemSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid().nullable(),
  tenantId: z.string().uuid().nullable(),
  storeId: z.string().uuid(),
  salesChannelId: z.string().uuid(),
  priceKindId: z.string().uuid().nullable(),
  assortmentScope: assortmentScopeSchema,
  priceSortFallback: z.enum(['approximate', 'unavailable']),
  isDefault: z.boolean(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
})

export const openApi = createEcommerceCrudOpenApi({
  resourceName: 'StoreChannelBinding',
  pluralName: 'StoreChannelBindings',
  querySchema: channelBindingListQuerySchema,
  listResponseSchema: createPagedListResponseSchema(channelBindingListItemSchema),
  create: {
    schema: ecommerceStoreChannelBindingCreateSchema,
    responseSchema: z.object({
      id: z.string().uuid().nullable(),
      isDefault: z
        .boolean()
        .describe('Whether the created binding is the default binding of its store. False when a concurrent request won the promotion.'),
    }),
    description:
      'Binds a sales channel of the same organization to a store, with an optional price kind and assortment scope. Requesting isDefault clears the previous default binding of the store.',
  },
  update: {
    schema: ecommerceStoreChannelBindingUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates a store channel binding by id (id in the body). Setting isDefault clears the previous default binding of the store.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes a store channel binding by id (?id= query parameter).',
  },
})
