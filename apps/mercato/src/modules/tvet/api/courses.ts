import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { Course } from '../data/entities'
import { z } from 'zod'

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  name: z.string().optional(),
  code: z.string().optional(),
})

export const { metadata, GET, POST, PUT, DELETE } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['tvet.academics.view'] },
    POST: { requireAuth: true, requireFeatures: ['tvet.academics.manage'] },
    PUT: { requireAuth: true, requireFeatures: ['tvet.academics.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['tvet.academics.manage'] },
  },
  orm: {
    entity: Course,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  list: {
    schema: querySchema,
    fields: ['id', 'name', 'code', 'level', 'durationMonths', 'createdAt'],
    buildFilters: (q) => {
      const filters: any = {}
      if (q.name) filters.name = { $ilike: `%${q.name}%` }
      if (q.code) filters.code = q.code
      return filters
    },
  },
})

export const openApi = {
  summary: 'Course CRUD',
  tags: ['TVET'],
}
