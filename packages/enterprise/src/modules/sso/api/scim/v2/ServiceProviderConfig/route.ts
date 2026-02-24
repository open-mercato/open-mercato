import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { scimJson } from '../../../../lib/scim-response'

export const metadata = {}

export async function GET() {
  return scimJson({
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
    documentationUri: 'https://open-mercato.com/docs/scim',
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      {
        type: 'oauthbearertoken',
        name: 'OAuth Bearer Token',
        description: 'Authentication scheme using the OAuth Bearer Token standard',
        specUri: 'https://www.rfc-editor.org/info/rfc6750',
        primary: true,
      },
    ],
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'SCIM',
  summary: 'SCIM Service Provider Configuration',
  methods: {
    GET: {
      summary: 'Get SCIM service provider configuration',
      description: 'Returns SCIM 2.0 ServiceProviderConfig. No authentication required — used by identity providers during connection testing.',
      tags: ['SSO', 'SCIM'],
      responses: [{ status: 200, description: 'SCIM ServiceProviderConfig' }],
      errors: [],
    },
  },
}
