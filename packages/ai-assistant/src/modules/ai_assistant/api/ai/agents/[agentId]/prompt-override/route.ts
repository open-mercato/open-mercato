import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAgent, loadAgentRegistry } from '../../../../../lib/agent-registry'
import { hasRequiredFeatures } from '../../../../../lib/auth'
import { AiAgentPromptOverrideRepository } from '../../../../../data/repositories/AiAgentPromptOverrideRepository'
import type { AiAgentPromptOverride } from '../../../../../data/entities'
import { findReservedKeys } from '../../../../../lib/prompt-override-merge'

const agentIdPattern = /^[a-z0-9_]+\.[a-z0-9_]+$/

const agentIdParamSchema = z.object({
  agentId: z
    .string()
    .regex(agentIdPattern, 'agentId must match "<module>.<agent>" (lowercase, digits, underscores only)'),
})

const sectionsSchema = z.record(z.string(), z.string())

/**
 * Accept both `sections` (Step 5.3 canonical shape) and the Step 4.5
 * placeholder `overrides` key so UI callers that haven't redeployed still
 * work. `sections` wins when both are present.
 */
const promptOverrideRequestSchema = z
  .object({
    sections: sectionsSchema.optional(),
    overrides: sectionsSchema.optional(),
    notes: z.string().max(2000).optional(),
  })
  .refine((value) => value.sections !== undefined || value.overrides !== undefined, {
    message: 'Body must include either `sections` or `overrides`.',
  })

export type AiPromptOverrideRequest = z.infer<typeof promptOverrideRequestSchema>

const REQUIRED_FEATURE = 'ai_assistant.settings.manage'
const HISTORY_LIMIT = 10

export const openApi: OpenApiRouteDoc = {
  tag: 'AI Assistant',
  summary: 'Versioned additive prompt-overrides for an AI agent',
  methods: {
    GET: {
      operationId: 'aiAssistantGetPromptOverride',
      summary: 'Read the latest prompt-section override for an agent plus recent version history.',
      description:
        'Returns `{ agentId, override, versions }` where `override` is the latest persisted ' +
        'row (or `null`) and `versions` is the newest-first history capped at 10 rows. ' +
        'Tenant-scoped; requires `ai_assistant.settings.manage`.',
      responses: [
        {
          status: 200,
          description: 'Latest override + recent version history.',
          mediaType: 'application/json',
        },
      ],
      errors: [
        { status: 400, description: 'Invalid agent id.' },
        { status: 401, description: 'Unauthenticated caller.' },
        { status: 403, description: 'Caller lacks `ai_assistant.settings.manage`.' },
        { status: 404, description: 'Unknown agent id.' },
      ],
    },
    POST: {
      operationId: 'aiAssistantSavePromptOverride',
      summary: 'Save a new prompt-section override version for the agent.',
      description:
        'Persists an additive `{ sections: Record<sectionId, text>, notes? }` override, allocating ' +
        'the next monotonic version for `(tenant, org, agent)`. Reserved policy keys ' +
        '(`mutationPolicy`, `readOnly`, `allowedTools`, `acceptedMediaTypes`) are rejected with ' +
        '400 / `reserved_key`. Requires `ai_assistant.settings.manage`.',
      requestBody: {
        contentType: 'application/json',
        description: 'Body: `{ sections: Record<string, string>, notes?: string }`.',
        schema: promptOverrideRequestSchema,
      },
      responses: [
        {
          status: 200,
          description: 'Override persisted. Returns `{ ok: true, version, updatedAt }`.',
          mediaType: 'application/json',
        },
      ],
      errors: [
        { status: 400, description: 'Invalid agent id, malformed body, or reserved policy key.' },
        { status: 401, description: 'Unauthenticated caller.' },
        { status: 403, description: 'Caller lacks `ai_assistant.settings.manage`.' },
        { status: 404, description: 'Unknown agent id.' },
      ],
    },
  },
}

export const metadata = {
  requireAuth: true,
  requireFeatures: [REQUIRED_FEATURE],
}

interface RouteContext {
  params: Promise<{ agentId: string }>
}

function jsonError(
  status: number,
  message: string,
  code: string,
  extra?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json({ error: message, code, ...(extra ?? {}) }, { status })
}

interface ResolvedAuth {
  tenantId: string | null
  organizationId: string | null
  userId: string
  isSuperAdmin: boolean
  features: string[]
  container: Awaited<ReturnType<typeof createRequestContainer>>
  rbacService: RbacService
}

async function resolveAuthOrRespond(
  req: NextRequest,
): Promise<ResolvedAuth | NextResponse> {
  const auth = await getAuthFromRequest(req)
  if (!auth) {
    return jsonError(401, 'Unauthorized', 'unauthenticated')
  }
  const container = await createRequestContainer()
  const rbacService = container.resolve<RbacService>('rbacService')
  const acl = await rbacService.loadAcl(auth.sub, {
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
  })
  if (!hasRequiredFeatures([REQUIRED_FEATURE], acl.features, acl.isSuperAdmin, rbacService)) {
    return jsonError(403, `Caller lacks required feature "${REQUIRED_FEATURE}".`, 'forbidden')
  }
  return {
    tenantId: auth.tenantId ?? null,
    organizationId: auth.orgId ?? null,
    userId: auth.sub,
    isSuperAdmin: acl.isSuperAdmin,
    features: acl.features,
    container,
    rbacService,
  }
}

function serializeOverride(row: AiAgentPromptOverride) {
  return {
    id: row.id,
    agentId: row.agentId,
    version: row.version,
    sections: row.sections ?? {},
    notes: row.notes ?? null,
    createdByUserId: row.createdByUserId ?? null,
    createdAt: row.createdAt?.toISOString?.() ?? new Date().toISOString(),
    updatedAt: row.updatedAt?.toISOString?.() ?? new Date().toISOString(),
  }
}

export async function GET(req: NextRequest, context: RouteContext): Promise<Response> {
  const authResult = await resolveAuthOrRespond(req)
  if (authResult instanceof NextResponse) return authResult

  const rawParams = await context.params
  const paramResult = agentIdParamSchema.safeParse(rawParams)
  if (!paramResult.success) {
    return jsonError(400, 'Invalid agent id.', 'validation_error', {
      issues: paramResult.error.issues,
    })
  }

  try {
    await loadAgentRegistry()
    const agent = getAgent(paramResult.data.agentId)
    if (!agent) {
      return jsonError(404, `Unknown agent "${paramResult.data.agentId}".`, 'agent_unknown')
    }

    if (!authResult.tenantId) {
      return NextResponse.json({
        agentId: agent.id,
        override: null,
        versions: [],
      })
    }

    const em = authResult.container.resolve<EntityManager>('em')
    const repo = new AiAgentPromptOverrideRepository(em)
    const [latest, versions] = await Promise.all([
      repo.getLatest(agent.id, {
        tenantId: authResult.tenantId,
        organizationId: authResult.organizationId,
      }),
      repo.listVersions(
        agent.id,
        {
          tenantId: authResult.tenantId,
          organizationId: authResult.organizationId,
        },
        HISTORY_LIMIT,
      ),
    ])

    return NextResponse.json({
      agentId: agent.id,
      override: latest ? serializeOverride(latest) : null,
      versions: versions.map(serializeOverride),
    })
  } catch (error) {
    console.error('[AI Prompt Override GET] Failure:', error)
    return jsonError(
      500,
      error instanceof Error ? error.message : 'Failed to load prompt override.',
      'internal_error',
    )
  }
}

export async function POST(req: NextRequest, context: RouteContext): Promise<Response> {
  const authResult = await resolveAuthOrRespond(req)
  if (authResult instanceof NextResponse) return authResult

  const rawParams = await context.params
  const paramResult = agentIdParamSchema.safeParse(rawParams)
  if (!paramResult.success) {
    return jsonError(400, 'Invalid agent id.', 'validation_error', {
      issues: paramResult.error.issues,
    })
  }

  let parsedBody: unknown
  try {
    parsedBody = await req.json()
  } catch {
    return jsonError(400, 'Request body must be valid JSON.', 'validation_error')
  }

  const bodyResult = promptOverrideRequestSchema.safeParse(parsedBody)
  if (!bodyResult.success) {
    return jsonError(400, 'Invalid request body.', 'validation_error', {
      issues: bodyResult.error.issues,
    })
  }

  const sections = bodyResult.data.sections ?? bodyResult.data.overrides ?? {}
  const reservedHits = findReservedKeys(sections)
  if (reservedHits.length > 0) {
    return jsonError(
      400,
      `Prompt override contains reserved policy keys: ${reservedHits.join(', ')}.`,
      'reserved_key',
      { reservedKeys: reservedHits },
    )
  }

  try {
    await loadAgentRegistry()
    const agent = getAgent(paramResult.data.agentId)
    if (!agent) {
      return jsonError(404, `Unknown agent "${paramResult.data.agentId}".`, 'agent_unknown')
    }

    if (!authResult.tenantId) {
      return jsonError(
        400,
        'Caller has no tenant context; cannot persist tenant-scoped prompt override.',
        'tenant_required',
      )
    }

    const em = authResult.container.resolve<EntityManager>('em')
    const repo = new AiAgentPromptOverrideRepository(em)
    const saved = await repo.save(
      {
        agentId: agent.id,
        sections,
        notes: bodyResult.data.notes ?? null,
      },
      {
        tenantId: authResult.tenantId,
        organizationId: authResult.organizationId,
        userId: authResult.userId,
      },
    )

    return NextResponse.json({
      ok: true,
      agentId: agent.id,
      version: saved.version,
      updatedAt: saved.updatedAt?.toISOString?.() ?? new Date().toISOString(),
    })
  } catch (error) {
    console.error('[AI Prompt Override POST] Failure:', error)
    return jsonError(
      500,
      error instanceof Error ? error.message : 'Failed to save prompt override.',
      'internal_error',
    )
  }
}
