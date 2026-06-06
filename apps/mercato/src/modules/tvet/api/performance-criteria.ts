import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { PerformanceCriteria } from '../data/entities'
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
    entity: PerformanceCriteria,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: 'tvet:performance_criteria' },
  list: {
    schema: querySchema,
    fields: ['id', 'description', 'unitElement'],
  },
  actions: {
    create: { commandId: 'tvet.curriculum.performance_criteria.created' },
    update: { commandId: 'tvet.curriculum.performance_criteria.updated' },
    delete: { commandId: 'tvet.curriculum.performance_criteria.deleted' },
  },
})

export const openApi = {
  summary: 'Performance Criteria CRUD',
  tags: ['TVET'],
}
