import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createApiKey } from '@open-mercato/core/modules/api_keys/services/apiKeyService'
import { UserRole } from '@open-mercato/core/modules/auth/data/entities'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['api_keys.create'] },
}

/**
 * Resolve the calling user's role ids for the active tenant. Mirrors the
 * `session-key` route so the generated key carries exactly the caller's roles.
 */
async function getUserRoleIds(
  em: EntityManager,
  userId: string,
  tenantId: string | null,
): Promise<string[]> {
  if (!tenantId) return []
  const links = await findWithDecryption(
    em,
    UserRole,
    { user: userId as any, role: { tenantId } } as any,
    { populate: ['role'] },
    { tenantId, organizationId: null },
  )
  const linkList = Array.isArray(links) ? links : []
  return linkList
    .map((link) => (link.role as any)?.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
}

const bodySchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(1000).optional().nullable(),
})

/**
 * POST /api/ai_assistant/mcp-key
 *
 * Creates a persistent MCP API key (`omk_...`) for use in `.mcp.json`. Unlike a
 * raw `POST /api/api_keys/keys` call — which assigns no roles unless the client
 * passes them — this endpoint resolves the **caller's own roles** server-side
 * and attaches them to the key, so the key inherits the current user's ACL.
 * The user cannot escalate: they only ever grant their own roles to their own
 * key.
 */
export async function POST(req: NextRequest) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const raw = await req.json().catch(() => ({}))
    const body = bodySchema.parse(raw ?? {})

    const container = await createRequestContainer()
    const em = container.resolve<EntityManager>('em')

    const roleIds = await getUserRoleIds(em, auth.sub, auth.tenantId)

    const { record, secret } = await createApiKey(em, {
      name: body.name ?? `MCP Config - ${new Date().toISOString().slice(0, 10)}`,
      description: body.description ?? 'Generated from AI Assistant settings for MCP client',
      tenantId: auth.tenantId ?? null,
      organizationId: auth.orgId ?? null,
      roles: roleIds,
      createdBy: auth.sub,
    })

    return NextResponse.json({
      id: record.id,
      name: record.name,
      keyPrefix: record.keyPrefix,
      secret,
      tenantId: record.tenantId ?? null,
      organizationId: record.organizationId ?? null,
      roles: roleIds,
    })
  } catch (error) {
    console.error('[MCP Key] Error:', error)
    return NextResponse.json(
      { error: 'Failed to create MCP API key' },
      { status: 500 },
    )
  }
}

const responseSchema = z.object({
  id: z.string(),
  name: z.string(),
  keyPrefix: z.string(),
  secret: z.string().describe('Full API key value (omk_...). Shown once.'),
  tenantId: z.string().uuid().nullable(),
  organizationId: z.string().uuid().nullable(),
  roles: z.array(z.string()).describe('Role ids inherited from the calling user.'),
})

const errorSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  summary: 'Create MCP API key',
  description:
    'Creates a persistent MCP API key that inherits the calling user\'s roles, for use in an MCP client `.mcp.json`.',
  methods: {
    POST: {
      summary: 'Generate MCP API key',
      description:
        'Generates a persistent `omk_` API key scoped to the calling user\'s tenant/organization and carrying the caller\'s own roles, so the key has the same ACL as the user.',
      responses: [
        { status: 200, description: 'API key created', schema: responseSchema },
      ],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 500, description: 'Failed to create MCP API key', schema: errorSchema },
      ],
    },
  },
}
