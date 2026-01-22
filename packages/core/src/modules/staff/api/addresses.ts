import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveCrudRecordId, parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { StaffTeamMemberAddress } from '../data/entities'
import {
  staffTeamMemberAddressCreateSchema,
  staffTeamMemberAddressUpdateSchema,
} from '../data/validators'
import { E } from '#generated/entities.ids.generated'
import { createStaffCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from './openapi'

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
  GET: { requireAuth: true, requireFeatures: ['staff.view'] },
  POST: { requireAuth: true, requireFeatures: ['staff.manage_team'] },
  PUT: { requireAuth: true, requireFeatures: ['staff.manage_team'] },
  DELETE: { requireAuth: true, requireFeatures: ['staff.manage_team'] },
}

export const metadata = routeMetadata

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: StaffTeamMemberAddress,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
  },
  indexer: { entityType: E.staff.staff_team_member_address },
  list: {
    schema: listSchema,
    entityId: E.staff.staff_team_member_address,
    fields: [
      'id',
      'member_id',
      'name',
      'purpose',
      'company_name',
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
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.entityId) filters.member_id = { $eq: query.entityId }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'staff.team-member-addresses.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(staffTeamMemberAddressCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.addressId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'staff.team-member-addresses.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(staffTeamMemberAddressUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'staff.team-member-addresses.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id = resolveCrudRecordId(parsed, ctx, translate)
        return { id }
      },
      response: () => ({ ok: true }),
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const addressListItemSchema = z
  .object({
    id: z.string().uuid(),
    member_id: z.string().uuid().nullable().optional(),
    name: z.string().nullable().optional(),
    purpose: z.string().nullable().optional(),
    company_name: z.string().nullable().optional(),
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
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
  })
  .passthrough()

export const openApi = createStaffCrudOpenApi({
  resourceName: 'TeamMemberAddress',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(addressListItemSchema),
  create: {
    schema: staffTeamMemberAddressCreateSchema,
    responseSchema: z.object({ id: z.string().uuid().nullable() }),
    description: 'Adds a team member address.',
  },
  update: {
    schema: staffTeamMemberAddressUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates a team member address.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes a team member address.',
  },
})
