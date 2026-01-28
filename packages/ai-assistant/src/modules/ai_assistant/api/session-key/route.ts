import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import {
  generateSessionToken,
  createSessionApiKey,
} from '@open-mercato/core/modules/api_keys/services/apiKeyService'
import { UserRole } from '@open-mercato/core/modules/auth/data/entities'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['ai_assistant.view'] },
}

const SESSION_TTL_MINUTES = 120 // 2 hours

/**
 * Get user's role IDs from the database.
 */
async function getUserRoleIds(
  em: EntityManager,
  userId: string,
  tenantId: string | null
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
    .map((l) => (l.role as any)?.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
}

/**
 * POST /api/ai_assistant/session-key
 *
 * Creates an ephemeral session API key for programmatic LLM access.
 * The key inherits the user's permissions and expires after 2 hours.
 */
export async function POST(req: NextRequest) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const container = await createRequestContainer()
    const em = container.resolve<EntityManager>('em')

    // Get user's role IDs from database
    const userRoleIds = await getUserRoleIds(em, auth.sub, auth.tenantId)

    // Generate session token and create ephemeral key
    const sessionToken = generateSessionToken()
    const expiresAt = new Date(Date.now() + SESSION_TTL_MINUTES * 60 * 1000)

    await createSessionApiKey(em, {
      sessionToken,
      userId: auth.sub,
      userRoles: userRoleIds,
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
      ttlMinutes: SESSION_TTL_MINUTES,
    })

    return NextResponse.json({
      sessionToken,
      expiresAt: expiresAt.toISOString(),
    })
  } catch (error) {
    console.error('[Session Key] Error:', error)
    return NextResponse.json(
      { error: 'Failed to create session key' },
      { status: 500 }
    )
  }
}

// OpenAPI documentation
const responseSchema = z.object({
  sessionToken: z.string().describe('Ephemeral session token for MCP tool calls'),
  expiresAt: z.string().describe('ISO 8601 timestamp when the token expires'),
})

const errorSchema = z.object({
  error: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  summary: 'Create session API key',
  description:
    'Creates an ephemeral session API key for programmatic LLM access to MCP tools. The key inherits the authenticated user\'s permissions and expires after 2 hours.',
  methods: {
    POST: {
      summary: 'Generate session key',
      description:
        'Generates a new session token that can be included in MCP tool calls via the _sessionToken parameter. The token inherits the calling user\'s roles and organization context.',
      responses: [
        {
          status: 200,
          description: 'Session key created successfully',
          schema: responseSchema,
        },
      ],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 500, description: 'Failed to create session key', schema: errorSchema },
      ],
    },
  },
}
