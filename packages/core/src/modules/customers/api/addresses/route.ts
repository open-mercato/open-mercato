/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CustomerAddress } from '../../data/entities'
import { addressCreateSchema, addressUpdateSchema } from '../../data/validators'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { withScopedPayload } from '../utils'
import {
  createCustomersCrudOpenApi,
  createPagedListResponseSchema,
  defaultOkResponseSchema,
} from '../openapi'

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    entityId: z.string().uuid().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.activities.view'] },
  POST: { requireAuth: true, requireFeatures: ['customers.activities.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['customers.activities.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['customers.activities.manage'] },
}

export const metadata = routeMetadata

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: CustomerAddress,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
  },
  indexer: {
    entityType: E.customers.customer_address,
  },
  list: {
    schema: listSchema,
    entityId: E.customers.customer_address,
    fields: [
      'id',
      'entity_id',
      'name',
      'purpose',
      'address_line1',
      'address_line2',
      'building_number',
      'flat_number',
      'city',
      'region',
      'postal_code',
      'country',
      'latitude',
      'longitude',
      'is_primary',
      'organization_id',
      'tenant_id',
    ],
    sortFieldMap: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query: any) => {
      const filters: Record<string, any> = {}
      if (query.entityId) filters.entity_id = { $eq: query.entityId }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'customers.addresses.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return addressCreateSchema.parse(withScopedPayload(raw ?? {}, ctx, translate))
      },
      response: ({ result }) => ({ id: result?.addressId ?? result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'customers.addresses.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return addressUpdateSchema.parse(withScopedPayload(raw ?? {}, ctx, translate))
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'customers.addresses.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id =
          parsed?.body?.id ??
          parsed?.id ??
          parsed?.query?.id ??
          (ctx.request ? new URL(ctx.request.url).searchParams.get('id') : null)
        if (!id) throw new CrudHttpError(400, { error: translate('customers.errors.address_required', 'Address id is required') })
        return { id }
      },
      response: () => ({ ok: true }),
    },
  },
})

const { POST, PUT, DELETE } = crud

export { POST, PUT, DELETE }
export const GET = crud.GET

const addressListItemSchema = z.object({
  id: z.string().uuid(),
  entity_id: z.string().uuid(),
  name: z.string().nullable().optional(),
  purpose: z.string().nullable().optional(),
  address_line1: z.string().nullable().optional(),
  address_line2: z.string().nullable().optional(),
  building_number: z.string().nullable().optional(),
  flat_number: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  region: z.string().nullable().optional(),
  postal_code: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  is_primary: z.boolean().nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
})

const addressCreateResponseSchema = z.object({
  id: z.string().uuid().nullable(),
})

export const openApi = createCustomersCrudOpenApi({
  resourceName: 'Address',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(addressListItemSchema),
  create: {
    schema: addressCreateSchema,
    responseSchema: addressCreateResponseSchema,
    description: 'Creates a customer address record and associates it with the referenced entity.',
  },
  update: {
    schema: addressUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates fields on an existing customer address.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes an address by id. The identifier may be included in the body or query.',
  },
})
