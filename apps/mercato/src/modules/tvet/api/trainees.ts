import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { Trainee } from '../data/entities'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'

const traineeSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  admissionNumber: z.string(),
  upiNumber: z.string().optional().nullable(),
  kcseIndex: z.string().optional().nullable(),
  courseId: z.string().uuid().optional().nullable(),
  organizationId: z.string().uuid(),
  tenantId: z.string().uuid(),
  createdAt: z.date(),
  updatedAt: z.date(),
})

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  name: z.string().optional(),
  admissionNumber: z.string().optional(),
})

export const { metadata, GET, POST, PUT, DELETE } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['tvet.academics.view'] },
    POST: { requireAuth: true, requireFeatures: ['tvet.academics.manage'] },
    PUT: { requireAuth: true, requireFeatures: ['tvet.academics.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['tvet.academics.manage'] },
  },
  orm: {
    entity: Trainee,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: 'tvet:trainee' },
  list: {
    schema: querySchema,
    fields: ['id', 'name', 'email', 'admissionNumber', 'createdAt'],
    buildFilters: (q) => {
      const filters: any = {}
      if (q.name) filters.name = { $ilike: `%${q.name}%` }
      if (q.admissionNumber) filters.admissionNumber = q.admissionNumber
      return filters
    },
  },
})

export const openApi: OpenApiRouteDoc = {
  summary: 'Trainee CRUD',
  tags: ['TVET'],
  responses: {
    200: {
      description: 'Paged list of trainees',
      content: { 'application/json': { schema: createPagedListResponseSchema(traineeSchema) } }
    }
  }
}
