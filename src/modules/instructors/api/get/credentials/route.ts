import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { InstructorCredential } from '../../../data/entities'
import { credentialListSchema } from '../../../data/validators'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['instructors.credentials.view'] },
}

export const metadata = routeMetadata

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: InstructorCredential,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  list: {
    schema: credentialListSchema,
    fields: [
      'id',
      'instructor_id',
      'credential_url',
      'credential_type',
      'title',
      'issuer',
      'badge_image_url',
      'issued_at',
      'expires_at',
      'verification_status',
      'verified_at',
      'sort_order',
      'is_active',
      'organization_id',
      'tenant_id',
      'created_at',
    ],
    sortFieldMap: {
      createdAt: 'created_at',
      sortOrder: 'sort_order',
    },
    buildFilters: async (query: z.infer<typeof credentialListSchema>) => {
      const filters: Record<string, unknown> = {}
      if (query.instructorId) {
        filters.instructor_id = { $eq: query.instructorId }
      }
      if (query.verificationStatus) {
        filters.verification_status = { $eq: query.verificationStatus }
      }
      if (query.credentialType) {
        filters.credential_type = { $eq: query.credentialType }
      }
      return filters
    },
  },
})

export const GET = crud.GET
