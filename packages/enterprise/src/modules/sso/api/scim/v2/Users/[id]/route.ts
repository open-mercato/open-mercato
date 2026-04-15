import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveScimContext } from '../../../context'
import { ScimService } from '../../../../../services/scimService'
import { parseScimPatchOperations } from '../../../../../lib/scim-patch'
import { scimJson } from '../../../../../lib/scim-response'
import { handleScimApiError } from '../../../../error-handler'

export const metadata = { requireAuth: false }

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: RouteContext) {
  try {
    const { id } = await ctx.params
    const scimCtx = await resolveScimContext(req)
    if (!scimCtx.ok) return scimCtx.response

    const baseUrl = new URL(req.url).origin
    const container = await createRequestContainer()
    const service = container.resolve<ScimService>('scimService')
    const resource = await service.getUser(id, scimCtx.scope, baseUrl)

    return scimJson(resource)
  } catch (err) {
    return handleScimApiError(err, 'SCIM Users API')
  }
}

export async function PATCH(req: Request, ctx: RouteContext) {
  try {
    const { id } = await ctx.params
    const scimCtx = await resolveScimContext(req)
    if (!scimCtx.ok) return scimCtx.response

    const body = await req.json()
    const operations = parseScimPatchOperations(body)
    const baseUrl = new URL(req.url).origin

    const container = await createRequestContainer()
    const service = container.resolve<ScimService>('scimService')
    const resource = await service.patchUser(id, operations, scimCtx.scope, baseUrl)

    return scimJson(resource)
  } catch (err) {
    return handleScimApiError(err, 'SCIM Users API')
  }
}

export async function DELETE(req: Request, ctx: RouteContext) {
  try {
    const { id } = await ctx.params
    const scimCtx = await resolveScimContext(req)
    if (!scimCtx.ok) return scimCtx.response

    const container = await createRequestContainer()
    const service = container.resolve<ScimService>('scimService')
    await service.deleteUser(id, scimCtx.scope)

    return new Response(null, { status: 204 })
  } catch (err) {
    return handleScimApiError(err, 'SCIM Users API')
  }
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
