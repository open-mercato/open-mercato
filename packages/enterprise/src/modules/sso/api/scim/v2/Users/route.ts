import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveScimContext } from '../../context'
import { ScimService, ScimServiceError } from '../../../../services/scimService'
import { scimJson, buildScimError } from '../../../../lib/scim-response'

export const metadata = {}

export async function POST(req: Request) {
  try {
    const ctx = await resolveScimContext(req)
    if (!ctx.ok) return ctx.response

    const body = await req.json()
    const baseUrl = new URL(req.url).origin

    const container = await createRequestContainer()
    const service = container.resolve<ScimService>('scimService')
    const { resource, status } = await service.createUser(body, ctx.scope, baseUrl)

    const headers: Record<string, string> = {}
    if (status === 201) {
      headers.Location = resource.meta.location
    }

    return scimJson(resource, status)
  } catch (err) {
    return handleScimError(err)
  }
}

export async function GET(req: Request) {
  try {
    const ctx = await resolveScimContext(req)
    if (!ctx.ok) return ctx.response

    const url = new URL(req.url)
    const filter = url.searchParams.get('filter')
    const startIndex = Math.max(1, parseInt(url.searchParams.get('startIndex') ?? '1', 10) || 1)
    const count = Math.min(200, Math.max(1, parseInt(url.searchParams.get('count') ?? '100', 10) || 100))
    const baseUrl = url.origin

    const container = await createRequestContainer()
    const service = container.resolve<ScimService>('scimService')
    const result = await service.listUsers(filter, startIndex, count, ctx.scope, baseUrl)

    return scimJson(result)
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
  summary: 'SCIM Users',
  methods: {
    POST: {
      summary: 'Create SCIM user',
      description: 'Provisions a new user via SCIM 2.0. Supports idempotency via externalId.',
      tags: ['SSO', 'SCIM'],
      responses: [
        { status: 201, description: 'User created' },
        { status: 200, description: 'User already exists (idempotent)' },
      ],
      errors: [
        { status: 400, description: 'Invalid payload' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'SSO config inactive' },
        { status: 409, description: 'Conflict — user already linked' },
      ],
    },
    GET: {
      summary: 'List SCIM users',
      description: 'Lists provisioned users with optional SCIM filter (eq operator).',
      tags: ['SSO', 'SCIM'],
      responses: [{ status: 200, description: 'SCIM ListResponse' }],
      errors: [
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'SSO config inactive' },
      ],
    },
  },
}
