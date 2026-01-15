import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { FmsDocument, DocumentCategory } from '../../data/entities'
import { createDocumentSchema, updateDocumentSchema, documentListQuerySchema } from '../../data/validators'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['fms_documents.view'] },
  POST: { requireAuth: true, requireFeatures: ['fms_documents.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['fms_documents.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['fms_documents.delete'] },
}

export const metadata = routeMetadata

function buildSearchFilters(query: z.infer<typeof documentListQuerySchema>): Record<string, unknown> {
  const filters: Record<string, unknown> = {}

  if (!query.includeDeleted) {
    filters.deletedAt = null
  }

  if (query.category) {
    filters.category = query.category
  }

  if (query.relatedEntityId) {
    filters.relatedEntityId = query.relatedEntityId
  }

  if (query.relatedEntityType) {
    filters.relatedEntityType = query.relatedEntityType
  }

  if (query.search && query.search.trim().length > 0) {
    const term = `%${escapeLikePattern(query.search.trim())}%`
    filters.$or = [
      { name: { $ilike: term } },
      { description: { $ilike: term } },
    ]
  }

  return filters
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: FmsDocument,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: 'fms_documents:fms_document' },
  list: {
    schema: documentListQuerySchema,
    fields: [
      'id',
      'name',
      'category',
      'description',
      'attachment_id',
      'related_entity_id',
      'related_entity_type',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
      'created_by',
      'updated_by',
    ],
    sortFieldMap: {
      id: 'id',
      name: 'name',
      category: 'category',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query) => buildSearchFilters(query),
    transformItem: (item: any) => ({
      id: item.id,
      name: item.name ?? null,
      category: item.category ?? 'other',
      description: item.description ?? null,
      attachmentId: item.attachment_id ?? null,
      relatedEntityId: item.related_entity_id ?? null,
      relatedEntityType: item.related_entity_type ?? null,
      organizationId: item.organization_id ?? null,
      tenantId: item.tenant_id ?? null,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
      createdBy: item.created_by ?? null,
      updatedBy: item.updated_by ?? null,
    }),
  },
  create: {
    schema: createDocumentSchema,
    mapToEntity: (input) => ({
      ...input,
    }),
  },
  update: {
    schema: updateDocumentSchema,
    applyToEntity: (entity, input) => {
      if (input.name !== undefined) entity.name = input.name
      if (input.category !== undefined) entity.category = input.category as DocumentCategory
      if (input.description !== undefined) entity.description = input.description
      if (input.relatedEntityId !== undefined) entity.relatedEntityId = input.relatedEntityId
      if (input.relatedEntityType !== undefined) entity.relatedEntityType = input.relatedEntityType
      if (input.updatedBy !== undefined) entity.updatedBy = input.updatedBy
      entity.updatedAt = new Date()
    },
  },
  del: {
    softDelete: true,
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE
