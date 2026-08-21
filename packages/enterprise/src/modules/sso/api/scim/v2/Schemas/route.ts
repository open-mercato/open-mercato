import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { buildListResponse, scimJson } from '../../../../lib/scim-response'

export const metadata = { requireAuth: false }

const schemas = [
  {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:Schema'],
    id: 'urn:ietf:params:scim:schemas:core:2.0:User',
    name: 'User',
    description: 'Open Mercato provisioned user',
    attributes: [
      { name: 'userName', type: 'string', multiValued: false, required: true, mutability: 'readWrite', returned: 'default', uniqueness: 'server' },
      { name: 'displayName', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
      { name: 'active', type: 'boolean', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
      { name: 'externalId', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', uniqueness: 'server' },
    ],
  },
  {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:Schema'],
    id: 'urn:ietf:params:scim:schemas:core:2.0:Group',
    name: 'Group',
    description: 'Open Mercato provisioned group',
    attributes: [
      { name: 'displayName', type: 'string', multiValued: false, required: true, mutability: 'readWrite', returned: 'default', uniqueness: 'server' },
      { name: 'externalId', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', uniqueness: 'server' },
      {
        name: 'members',
        type: 'complex',
        multiValued: true,
        required: false,
        mutability: 'readWrite',
        returned: 'default',
        uniqueness: 'none',
        subAttributes: [
          { name: 'value', type: 'string', multiValued: false, required: true, mutability: 'immutable', returned: 'default', uniqueness: 'none', referenceTypes: ['User'] },
          { name: '$ref', type: 'reference', multiValued: false, required: false, mutability: 'immutable', returned: 'default', uniqueness: 'none', referenceTypes: ['User'] },
          { name: 'type', type: 'string', multiValued: false, required: false, mutability: 'immutable', returned: 'default', uniqueness: 'none', canonicalValues: ['User'] },
        ],
      },
    ],
  },
]

export async function GET() {
  return scimJson(buildListResponse(schemas, schemas.length, 1, schemas.length))
}

export const openApi: OpenApiRouteDoc = {
  tag: 'SCIM',
  summary: 'SCIM Schemas',
  methods: {
    GET: {
      summary: 'List SCIM schemas',
      description: 'Describes the supported User and Group schemas.',
      tags: ['SSO', 'SCIM'],
      responses: [{ status: 200, description: 'SCIM ListResponse' }],
      errors: [],
    },
  },
}
