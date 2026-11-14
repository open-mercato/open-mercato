import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveScimContext } from '../../context'
import { ScimGroupService } from '../../../../services/scimGroupService'
import { handleScimApiError } from '../../../error-handler'
import { buildScimError, scimJson } from '../../../../lib/scim-response'
import { scimGroupPayloadSchema } from '../../../../lib/scim-group'

export const metadata = { requireAuth: false }

export async function POST(req: Request) {
  try {
    const context = await resolveScimContext(req)
    if (!context.ok) return context.response

    const parsed = scimGroupPayloadSchema.safeParse(await req.json())
    if (!parsed.success) {
      return scimJson(buildScimError(400, parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '), 'invalidValue'), 400)
    }

    const container = await createRequestContainer()
    const service = container.resolve<ScimGroupService>('scimGroupService')
    const resource = await service.createGroup(parsed.data, context.scope, new URL(req.url).origin)
    return new Response(JSON.stringify(resource), {
      status: 201,
      headers: {
        'Content-Type': 'application/scim+json',
        Location: resource.meta.location,
      },
    })
  } catch (error) {
    return handleScimApiError(error, 'SCIM Groups API')
  }
}

export async function GET(req: Request) {
  try {
    const context = await resolveScimContext(req)
    if (!context.ok) return context.response

    const url = new URL(req.url)
    const startIndex = Math.max(1, Number.parseInt(url.searchParams.get('startIndex') ?? '1', 10) || 1)
    const count = Math.min(200, Math.max(1, Number.parseInt(url.searchParams.get('count') ?? '100', 10) || 100))
    const container = await createRequestContainer()
    const service = container.resolve<ScimGroupService>('scimGroupService')
    const result = await service.listGroups(url.searchParams.get('filter'), startIndex, count, context.scope, url.origin)
    return scimJson(result)
  } catch (error) {
    return handleScimApiError(error, 'SCIM Groups API')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'SCIM',
  summary: 'SCIM Groups',
  methods: {
    POST: {
      summary: 'Create SCIM group',
      description: 'Creates a group and synchronizes its user memberships.',
      tags: ['SSO', 'SCIM'],
      responses: [{ status: 201, description: 'Group created' }],
      errors: [
        { status: 400, description: 'Invalid group payload or member' },
        { status: 401, description: 'Unauthorized' },
      ],
    },
    GET: {
      summary: 'List SCIM groups',
      description: 'Lists groups with displayName, externalId, or members.value filtering.',
      tags: ['SSO', 'SCIM'],
      responses: [{ status: 200, description: 'SCIM ListResponse' }],
      errors: [{ status: 401, description: 'Unauthorized' }],
    },
  },
}
