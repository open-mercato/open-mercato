import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { buildListResponse, scimJson } from '../../../../lib/scim-response'

export const metadata = { requireAuth: false }

export async function GET(req: Request) {
  const baseUrl = new URL(req.url).origin
  const resources = [
    {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
      id: 'User',
      name: 'User',
      endpoint: '/Users',
      schema: 'urn:ietf:params:scim:schemas:core:2.0:User',
      meta: { resourceType: 'ResourceType', location: `${baseUrl}/api/sso/scim/v2/ResourceTypes/User` },
    },
    {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
      id: 'Group',
      name: 'Group',
      endpoint: '/Groups',
      schema: 'urn:ietf:params:scim:schemas:core:2.0:Group',
      meta: { resourceType: 'ResourceType', location: `${baseUrl}/api/sso/scim/v2/ResourceTypes/Group` },
    },
  ]
  return scimJson(buildListResponse(resources, resources.length, 1, resources.length))
}

export const openApi: OpenApiRouteDoc = {
  tag: 'SCIM',
  summary: 'SCIM Resource Types',
  methods: {
    GET: {
      summary: 'List SCIM resource types',
      description: 'Describes the User and Group resources supported by this endpoint.',
      tags: ['SSO', 'SCIM'],
      responses: [{ status: 200, description: 'SCIM ListResponse' }],
      errors: [],
    },
  },
}
