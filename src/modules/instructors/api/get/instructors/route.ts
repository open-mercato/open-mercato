import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { InstructorProfile } from '../../../data/entities'
import { instructorListSchema } from '../../../data/validators'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['instructors.view'] },
}

export const metadata = routeMetadata

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: InstructorProfile,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  list: {
    schema: instructorListSchema,
    fields: [
      'id',
      'display_name',
      'slug',
      'headline',
      'avatar_url',
      'specializations',
      'experience_years',
      'hourly_rate',
      'currency',
      'is_available',
      'is_verified',
      'is_active',
      'organization_id',
      'tenant_id',
      'created_at',
    ],
    sortFieldMap: {
      name: 'display_name',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query: z.infer<typeof instructorListSchema>) => {
      const filters: Record<string, unknown> = {}
      if (query.search) {
        filters.display_name = { $ilike: `%${escapeLikePattern(query.search)}%` }
      }
      if (query.specialization) {
        filters.specializations = { $contains: [query.specialization] }
      }
      const isAvailable = parseBooleanToken(query.isAvailable)
      if (isAvailable !== null) {
        filters.is_available = { $eq: isAvailable }
      }
      const isVerified = parseBooleanToken(query.isVerified)
      if (isVerified !== null) {
        filters.is_verified = { $eq: isVerified }
      }
      return filters
    },
    transformItem: (item: Record<string, unknown>) => {
      if (!item) return item
      return { ...item }
    },
  },
})

export const GET = crud.GET
