import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveScimContext } from '../../../context'
import { ScimGroupService } from '../../../../../services/scimGroupService'
import { parseScimGroupPatchOperations } from '../../../../../lib/scim-group'
import { scimJson } from '../../../../../lib/scim-response'
import { handleScimApiError } from '../../../../error-handler'

export const metadata = { requireAuth: false }

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(req: Request, routeContext: RouteContext) {
  try {
    const context = await resolveScimContext(req)
    if (!context.ok) return context.response
    const { id } = await routeContext.params
    const container = await createRequestContainer()
    const service = container.resolve<ScimGroupService>('scimGroupService')
    return scimJson(await service.getGroup(id, context.scope, new URL(req.url).origin))
  } catch (error) {
    return handleScimApiError(error, 'SCIM Groups API')
  }
}

export async function PATCH(req: Request, routeContext: RouteContext) {
  try {
    const context = await resolveScimContext(req)
    if (!context.ok) return context.response
    const { id } = await routeContext.params
    const operations = parseScimGroupPatchOperations(await req.json())
    const container = await createRequestContainer()
    const service = container.resolve<ScimGroupService>('scimGroupService')
    return scimJson(await service.patchGroup(id, operations, context.scope, new URL(req.url).origin))
  } catch (error) {
    return handleScimApiError(error, 'SCIM Groups API')
  }
}

export async function DELETE(req: Request, routeContext: RouteContext) {
  try {
    const context = await resolveScimContext(req)
    if (!context.ok) return context.response
    const { id } = await routeContext.params
    const container = await createRequestContainer()
    const service = container.resolve<ScimGroupService>('scimGroupService')
    await service.deleteGroup(id, context.scope)
    return new Response(null, { status: 204 })
  } catch (error) {
    return handleScimApiError(error, 'SCIM Groups API')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'SCIM',
  summary: 'SCIM Group by ID',
  methods: {
    GET: {
      summary: 'Get SCIM group',
      description: 'Returns a group and its current memberships.',
      tags: ['SSO', 'SCIM'],
      responses: [{ status: 200, description: 'SCIM Group resource' }],
      errors: [{ status: 404, description: 'Group not found' }],
    },
    PATCH: {
      summary: 'Patch SCIM group',
      description: 'Updates group attributes or membership through SCIM PatchOp.',
      tags: ['SSO', 'SCIM'],
      responses: [{ status: 200, description: 'Updated SCIM Group resource' }],
      errors: [{ status: 400, description: 'Invalid PatchOp or member' }],
    },
    DELETE: {
      summary: 'Delete SCIM group',
      description: 'Deletes the group and removes its SSO-sourced role memberships.',
      tags: ['SSO', 'SCIM'],
      responses: [{ status: 204, description: 'No content' }],
      errors: [{ status: 404, description: 'Group not found' }],
    },
  },
}
