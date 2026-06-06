import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { Sector } from '../data/entities'
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
    entity: Sector,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: 'tvet:sector' },
  list: {
    schema: querySchema,
    fields: ['id', 'name', 'code'],
  },
  actions: {
    create: { commandId: 'tvet.curriculum.sector.created' },
    update: { commandId: 'tvet.curriculum.sector.updated' },
    delete: { commandId: 'tvet.curriculum.sector.deleted' },
  },
})

export const openApi = {
  summary: 'Sector CRUD',
  tags: ['TVET'],
}
