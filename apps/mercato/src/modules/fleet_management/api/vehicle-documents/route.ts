import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { parseScopedCommandInput, resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { FleetVehicleDocument } from '../../data/entities'
import { createVehicleDocumentSchema, updateVehicleDocumentSchema } from '../../data/validators'
import { createFleetCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from '../openapi'
import { FLEET_VEHICLE_DOCUMENT_ENTITY_ID } from '../../commands/fleet'
import '../../commands/fleet'

const rawBodySchema = z.object({}).passthrough()
const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  id: z.string().uuid().optional(),
  ids: z.string().optional(),
  vehicleId: z.string().uuid().optional(),
  documentType: z.enum(['istimara', 'insurance', 'fahs', 'operating_card', 'other']).optional(),
  documentNumber: z.string().optional(),
  expiringBefore: z.string().optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
}).passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['fleet.read'] },
  POST: { requireAuth: true, requireFeatures: ['fleet.write'] },
  PUT: { requireAuth: true, requireFeatures: ['fleet.write'] },
  DELETE: { requireAuth: true, requireFeatures: ['fleet.write'] },
}

export const metadata = { path: '/fleet_management/vehicle-documents', ...routeMetadata }

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: { entity: FleetVehicleDocument, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },
  indexer: { entityType: FLEET_VEHICLE_DOCUMENT_ENTITY_ID },
  list: {
    schema: listSchema,
    entityId: FLEET_VEHICLE_DOCUMENT_ENTITY_ID,
    fields: ['id', 'organization_id', 'tenant_id', 'vehicle_id', 'document_type', 'document_number', 'issue_date', 'expiry_date', 'file_attachment_id', 'notes', 'created_at', 'updated_at'],
    sortFieldMap: { documentType: 'document_type', expiryDate: 'expiry_date', issueDate: 'issue_date', createdAt: 'created_at', updatedAt: 'updated_at' },
    buildFilters: (query) => ({
      ...(query.id ? { id: { $eq: query.id } } : {}),
      ...(query.ids ? { id: { $in: query.ids.split(',').map((value) => value.trim()).filter(Boolean) } } : {}),
      ...(query.vehicleId ? { vehicle_id: { $eq: query.vehicleId } } : {}),
      ...(query.documentType ? { document_type: { $eq: query.documentType } } : {}),
      ...(query.documentNumber ? { document_number: { $ilike: `%${escapeLikePattern(query.documentNumber)}%` } } : {}),
      ...(query.expiringBefore ? { expiry_date: { $lte: new Date(query.expiringBefore), $ne: null } } : {}),
    }),
    transformItem: (item) => ({ ...item, updatedAt: item.updated_at ?? null }),
  },
  actions: {
    create: {
      commandId: 'fleet_management.vehicle_documents.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => { const { translate } = await resolveTranslations(); return parseScopedCommandInput(createVehicleDocumentSchema, raw ?? {}, ctx, translate) },
      response: ({ result }) => ({ id: result?.id ?? null, updatedAt: result?.updatedAt?.toISOString?.() ?? null }),
      status: 201,
    },
    update: {
      commandId: 'fleet_management.vehicle_documents.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => { const { translate } = await resolveTranslations(); return parseScopedCommandInput(updateVehicleDocumentSchema, raw ?? {}, ctx, translate) },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'fleet_management.vehicle_documents.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => { const { translate } = await resolveTranslations(); return { id: resolveCrudRecordId(parsed, ctx, translate) } },
      response: () => ({ ok: true }),
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const vehicleDocumentItemSchema = z.object({
  id: z.string().uuid(), organization_id: z.string().uuid(), tenant_id: z.string().uuid(),
  vehicle_id: z.string().uuid(),
  document_type: z.enum(['istimara', 'insurance', 'fahs', 'operating_card', 'other']),
  document_number: z.string().nullable().optional(),
  issue_date: z.string().nullable().optional(),
  expiry_date: z.string().nullable().optional(),
  file_attachment_id: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(), updated_at: z.string().nullable().optional(), updatedAt: z.string().nullable().optional(),
})

export const openApi = createFleetCrudOpenApi({
  resourceName: 'VehicleDocument', pluralName: 'VehicleDocuments', querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(vehicleDocumentItemSchema),
  create: { schema: createVehicleDocumentSchema, description: 'Records a vehicle compliance document.' },
  update: { schema: updateVehicleDocumentSchema, responseSchema: defaultOkResponseSchema, description: 'Updates a vehicle compliance document.' },
  del: { schema: z.object({ id: z.string().uuid() }), responseSchema: defaultOkResponseSchema, description: 'Soft-deletes a vehicle compliance document.' },
})