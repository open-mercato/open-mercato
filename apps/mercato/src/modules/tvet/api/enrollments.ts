import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { Enrollment } from '../data/entities'
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
    entity: Enrollment,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: 'tvet:enrollment' },
  list: {
    schema: querySchema,
    fields: ['id', 'trainee', 'classGroup', 'status', 'enrolledAt'],
  },
  actions: {
    create: { commandId: 'tvet.academic.enrollment.created' },
    update: { commandId: 'tvet.academic.enrollment.updated' },
    delete: { commandId: 'tvet.academic.enrollment.deleted' },
  },
})

export const openApi = {
  summary: 'Enrollment CRUD',
  tags: ['TVET'],
}
