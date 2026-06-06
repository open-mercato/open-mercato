import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { ClassGroup } from '../data/entities'
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
    entity: ClassGroup,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: 'tvet:class_group' },
  list: {
    schema: querySchema,
    fields: ['id', 'name', 'course', 'trainerId', 'createdAt'],
  },
  actions: {
    create: { commandId: 'tvet.academic.class_group.created' },
    update: { commandId: 'tvet.academic.class_group.updated' },
    delete: { commandId: 'tvet.academic.class_group.deleted' },
  },
})

export const openApi = {
  summary: 'Class Group CRUD',
  tags: ['TVET'],
}
