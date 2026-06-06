import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { UnitElement } from '../data/entities'
import { z } from 'zod'

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
})

export const { metadata, GET, POST, PUT, DELETE } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['tvet.academics.view'] },
    POST: { requireAuth: true, requireFeatures: ['tvet.academics.manage'] },
    PUT: { requireAuth: true, requireFeatures: ['tvet.academics.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['tvet.academics.manage'] },
  },
  orm: {
    entity: UnitElement,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: 'tvet:unit_element' },
  list: {
    schema: querySchema,
    fields: ['id', 'title', 'competencyUnit'],
  },
  actions: {
    create: { commandId: 'tvet.curriculum.unit_element.created' },
    update: { commandId: 'tvet.curriculum.unit_element.updated' },
    delete: { commandId: 'tvet.curriculum.unit_element.deleted' },
  },
})

export const openApi = {
  summary: 'Unit Element CRUD',
  tags: ['TVET'],
}
