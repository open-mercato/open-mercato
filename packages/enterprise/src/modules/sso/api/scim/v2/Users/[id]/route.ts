import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveScimContext } from '../../../context'
import { ScimService, ScimServiceError } from '../../../../../services/scimService'
import { scimJson, buildScimError } from '../../../../../lib/scim-response'
import { parseScimPatchOperations } from '../../../../../lib/scim-patch'

export const metadata = {}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const ctx = await resolveScimContext(req)
    if (!ctx.ok) return ctx.response

    const baseUrl = new URL(req.url).origin
    const container = await createRequestContainer()
    const service = container.resolve<ScimService>('scimService')
    const resource = await service.getUser(params.id, ctx.scope, baseUrl)

    return scimJson(resource)
  } catch (err) {
    return handleScimError(err)
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const ctx = await resolveScimContext(req)
    if (!ctx.ok) return ctx.response

    const body = await req.json()
    const operations = parseScimPatchOperations(body)
    const baseUrl = new URL(req.url).origin

    const container = await createRequestContainer()
    const service = container.resolve<ScimService>('scimService')
    const resource = await service.patchUser(params.id, operations, ctx.scope, baseUrl)

    return scimJson(resource)
  } catch (err) {
    return handleScimError(err)
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    const ctx = await resolveScimContext(req)
    if (!ctx.ok) return ctx.response

    const container = await createRequestContainer()
    const service = container.resolve<ScimService>('scimService')
    await service.deleteUser(params.id, ctx.scope)

    return new Response(null, { status: 204 })
  } catch (err) {
    return handleScimError(err)
  }
}

function handleScimError(err: unknown): Response {
  if (err instanceof ScimServiceError) {
    return scimJson(buildScimError(err.statusCode, err.message), err.statusCode)
  }
  console.error('[SCIM Users API] Error:', err)
  return scimJson(buildScimError(500, 'Internal server error'), 500)
}

export const openApi: OpenApiRouteDoc = {
  tag: 'SCIM',
  summary: 'SCIM User by ID',
  methods: {
    GET: {
      summary: 'Get SCIM user',
      description: 'Returns a single provisioned user by SCIM ID.',
      tags: ['SSO', 'SCIM'],
      responses: [{ status: 200, description: 'SCIM User resource' }],
      errors: [
        { status: 401, description: 'Unauthorized' },
        { status: 404, description: 'User not found' },
      ],
    },
    PATCH: {
      summary: 'Patch SCIM user',
      description: 'Updates user attributes via SCIM PatchOp. Supports active/inactive toggling.',
      tags: ['SSO', 'SCIM'],
      responses: [{ status: 200, description: 'Updated SCIM User resource' }],
      errors: [
        { status: 400, description: 'Invalid PatchOp' },
        { status: 401, description: 'Unauthorized' },
        { status: 404, description: 'User not found' },
      ],
    },
    DELETE: {
      summary: 'Delete SCIM user',
      description: 'Deactivates the user and revokes sessions.',
      tags: ['SSO', 'SCIM'],
      responses: [{ status: 204, description: 'No content' }],
      errors: [
        { status: 401, description: 'Unauthorized' },
        { status: 404, description: 'User not found' },
      ],
    },
  },
}
