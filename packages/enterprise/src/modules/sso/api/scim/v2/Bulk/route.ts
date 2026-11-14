import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveScimContext } from '../../context'
import { ScimBulkService } from '../../../../services/scimBulkService'
import { buildScimError, scimJson } from '../../../../lib/scim-response'
import { handleScimApiError } from '../../../error-handler'

const bulkRequestSchema = z.object({
  schemas: z.array(z.string()).optional(),
  failOnErrors: z.coerce.number().int().min(0).max(100).default(1),
  Operations: z.array(z.object({
    method: z.enum(['POST', 'PATCH', 'DELETE']).or(z.enum(['post', 'patch', 'delete'])),
    path: z.string().min(1).max(2048),
    bulkId: z.string().min(1).max(255).optional(),
    data: z.unknown().optional(),
  })).min(1).max(100),
})

const MAX_BULK_PAYLOAD_BYTES = 1024 * 1024

export const metadata = { requireAuth: false }

export async function POST(req: Request) {
  try {
    const context = await resolveScimContext(req)
    if (!context.ok) return context.response
    const rawBody = await req.text()
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BULK_PAYLOAD_BYTES) {
      return scimJson(buildScimError(413, 'Bulk request exceeds the 1 MiB payload limit', 'tooLarge'), 413)
    }
    let body: unknown
    try {
      body = JSON.parse(rawBody)
    } catch {
      return scimJson(buildScimError(400, 'Bulk request must contain valid JSON', 'invalidSyntax'), 400)
    }
    const parsed = bulkRequestSchema.safeParse(body)
    if (!parsed.success) {
      return scimJson(buildScimError(400, parsed.error.issues.map((issue) => issue.message).join('; '), 'invalidValue'), 400)
    }

    const container = await createRequestContainer()
    const service = container.resolve<ScimBulkService>('scimBulkService')
    return scimJson(await service.execute(parsed.data.Operations, context.scope, new URL(req.url).origin, parsed.data.failOnErrors))
  } catch (error) {
    return handleScimApiError(error, 'SCIM Bulk API')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'SCIM',
  summary: 'SCIM Bulk',
  methods: {
    POST: {
      summary: 'Execute SCIM bulk request',
      description: 'Executes up to 100 user or group provisioning operations with per-operation results.',
      tags: ['SSO', 'SCIM'],
      responses: [{ status: 200, description: 'SCIM BulkResponse' }],
      errors: [
        { status: 400, description: 'Invalid bulk request' },
        { status: 401, description: 'Unauthorized' },
        { status: 413, description: 'Bulk payload too large' },
      ],
    },
  },
}
