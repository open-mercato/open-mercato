import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAgent, loadAgentRegistry } from '../../../../../lib/agent-registry'
import { hasRequiredFeatures } from '../../../../../lib/auth'
import {
  AiAgentRuntimeOverrideRepository,
  AiAgentRuntimeOverrideValidationError,
} from '../../../../../data/repositories/AiAgentRuntimeOverrideRepository'
import type { AiAgentRuntimeOverride } from '../../../../../data/entities'

const agentIdPattern = /^[a-z0-9_]+\.[a-z0-9_]+$/

const agentIdParamSchema = z.object({
  agentId: z
    .string()
    .regex(agentIdPattern, 'agentId must match "<module>.<agent>" (lowercase, digits, underscores only)'),
})

const loopOverrideRequestSchema = z.object({
  loopDisabled: z.boolean().nullable().optional(),
  loopMaxSteps: z.number().int().min(1).max(1000).nullable().optional(),
  loopMaxToolCalls: z.number().int().min(1).max(10000).nullable().optional(),
  loopMaxWallClockMs: z.number().int().min(100).max(3_600_000).nullable().optional(),
  loopMaxTokens: z.number().int().min(1).max(10_000_000).nullable().optional(),
  loopStopWhenJson: z
    .array(
      z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('stepCount'), count: z.number().int().min(1) }),
        z.object({ kind: z.literal('hasToolCall'), toolName: z.string().min(1) }),
      ]),
    )
    .nullable()
    .optional(),
  loopActiveToolsJson: z.array(z.string().min(1)).nullable().optional(),
})

const VIEW_FEATURE = 'ai_assistant.view'
const MANAGE_FEATURE = 'ai_assistant.settings.manage'

export const openApi: OpenApiRouteDoc = {
  tag: 'AI Assistant',
  summary: 'Tenant-scoped loop-policy override for an AI agent',
  methods: {
    GET: {
      operationId: 'aiAssistantGetLoopOverride',
      summary:
        'Read the current loop-policy override for this agent, if any.',
      description:
        'Returns `{ agentId, override }` where `override` is the agent-scoped loop-policy ' +
        'row from `ai_agent_runtime_overrides` (or `null`). Requires `ai_assistant.view`.',
      responses: [
        {
          status: 200,
          description: 'Loop override payload.',
          mediaType: 'application/json',
        },
      ],
      errors: [
        { status: 400, description: 'Invalid agent id.' },
        { status: 401, description: 'Unauthenticated caller.' },
        { status: 403, description: 'Caller lacks `ai_assistant.view`.' },
        { status: 404, description: 'Unknown agent id.' },
      ],
    },
    PUT: {
      operationId: 'aiAssistantSaveLoopOverride',
      summary: 'Set (or replace) the tenant-scoped loop-policy override for this agent.',
      description:
        'Body: loop columns. All fields are nullable/optional; `null` explicitly clears ' +
        'that axis. Validates `loopStopWhenJson` items and `loopActiveToolsJson` membership. ' +
        'Requires `ai_assistant.settings.manage`.',
      requestBody: {
        contentType: 'application/json',
        description: 'Loop override payload.',
        schema: loopOverrideRequestSchema,
      },
      responses: [
        {
          status: 200,
          description: 'Override persisted.',
          mediaType: 'application/json',
        },
      ],
      errors: [
        { status: 400, description: 'Invalid agent id or validation error.' },
        { status: 401, description: 'Unauthenticated caller.' },
        { status: 403, description: 'Caller lacks `ai_assistant.settings.manage`.' },
        { status: 404, description: 'Unknown agent id.' },
      ],
    },
    DELETE: {
      operationId: 'aiAssistantClearLoopOverride',
      summary: 'Remove the loop-policy columns from the agent-scoped runtime override row.',
      description:
        'Nulls out all seven loop columns on the agent-scoped `ai_agent_runtime_overrides` row. ' +
        'Idempotent — returns 200 even when no override exists. ' +
        'Requires `ai_assistant.settings.manage`.',
      responses: [
        {
          status: 200,
          description: 'Loop override cleared (or already absent).',
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
  },
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: [VIEW_FEATURE] },
  PUT: { requireAuth: true, requireFeatures: [MANAGE_FEATURE] },
  DELETE: { requireAuth: true, requireFeatures: [MANAGE_FEATURE] },
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
}

async function resolveAuthOrRespond(
  req: NextRequest,
  requiredFeature: string,
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
  if (!hasRequiredFeatures([requiredFeature], acl.features, acl.isSuperAdmin, rbacService)) {
    return jsonError(403, `Caller lacks required feature "${requiredFeature}".`, 'forbidden')
  }
  return {
    tenantId: auth.tenantId ?? null,
    organizationId: auth.orgId ?? null,
    userId: auth.sub,
    isSuperAdmin: acl.isSuperAdmin,
    features: acl.features,
    container,
  }
}

function serializeLoopOverride(row: AiAgentRuntimeOverride) {
  return {
    id: row.id,
    agentId: row.agentId ?? null,
    loopDisabled: row.loopDisabled ?? null,
    loopMaxSteps: row.loopMaxSteps ?? null,
    loopMaxToolCalls: row.loopMaxToolCalls ?? null,
    loopMaxWallClockMs: row.loopMaxWallClockMs ?? null,
    loopMaxTokens: row.loopMaxTokens ?? null,
    loopStopWhenJson: row.loopStopWhenJson ?? null,
    loopActiveToolsJson: row.loopActiveToolsJson ?? null,
    updatedAt: row.updatedAt?.toISOString?.() ?? new Date().toISOString(),
  }
}

export async function GET(req: NextRequest, context: RouteContext): Promise<Response> {
  const authResult = await resolveAuthOrRespond(req, VIEW_FEATURE)
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
      return NextResponse.json({ agentId: agent.id, override: null })
    }

    const em = authResult.container.resolve<EntityManager>('em')
    const repo = new AiAgentRuntimeOverrideRepository(em)
    const row = await repo.getDefault({
      tenantId: authResult.tenantId,
      organizationId: authResult.organizationId,
      agentId: agent.id,
    })

    const hasLoopData =
      row !== null &&
      (row.loopDisabled !== null ||
        row.loopMaxSteps !== null ||
        row.loopMaxToolCalls !== null ||
        row.loopMaxWallClockMs !== null ||
        row.loopMaxTokens !== null ||
        row.loopStopWhenJson !== null ||
        row.loopActiveToolsJson !== null)

    return NextResponse.json({
      agentId: agent.id,
      override: hasLoopData ? serializeLoopOverride(row!) : null,
    })
  } catch (error) {
    console.error('[AI Loop Override GET] Failure:', error)
    return jsonError(
      500,
      error instanceof Error ? error.message : 'Failed to load loop override.',
      'internal_error',
    )
  }
}

export async function PUT(req: NextRequest, context: RouteContext): Promise<Response> {
  const authResult = await resolveAuthOrRespond(req, MANAGE_FEATURE)
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

  const bodyResult = loopOverrideRequestSchema.safeParse(parsedBody)
  if (!bodyResult.success) {
    return jsonError(400, 'Invalid request body.', 'validation_error', {
      issues: bodyResult.error.issues,
    })
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
        'Caller has no tenant context; cannot persist tenant-scoped loop override.',
        'tenant_required',
      )
    }

    const em = authResult.container.resolve<EntityManager>('em')
    const repo = new AiAgentRuntimeOverrideRepository(em)
    const row = await repo.upsertDefault(
      {
        agentId: agent.id,
        agentAllowedTools: agent.allowedTools,
        loopDisabled: bodyResult.data.loopDisabled ?? null,
        loopMaxSteps: bodyResult.data.loopMaxSteps ?? null,
        loopMaxToolCalls: bodyResult.data.loopMaxToolCalls ?? null,
        loopMaxWallClockMs: bodyResult.data.loopMaxWallClockMs ?? null,
        loopMaxTokens: bodyResult.data.loopMaxTokens ?? null,
        loopStopWhenJson: bodyResult.data.loopStopWhenJson ?? null,
        loopActiveToolsJson: bodyResult.data.loopActiveToolsJson ?? null,
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
      override: serializeLoopOverride(row),
    })
  } catch (error) {
    if (error instanceof AiAgentRuntimeOverrideValidationError) {
      return jsonError(400, error.message, error.code)
    }
    console.error('[AI Loop Override PUT] Failure:', error)
    return jsonError(
      500,
      error instanceof Error ? error.message : 'Failed to save loop override.',
      'internal_error',
    )
  }
}

export async function DELETE(req: NextRequest, context: RouteContext): Promise<Response> {
  const authResult = await resolveAuthOrRespond(req, MANAGE_FEATURE)
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
      return NextResponse.json({ ok: true, agentId: agent.id, cleared: false })
    }

    const em = authResult.container.resolve<EntityManager>('em')
    const repo = new AiAgentRuntimeOverrideRepository(em)

    const existing = await repo.getDefault({
      tenantId: authResult.tenantId,
      organizationId: authResult.organizationId,
      agentId: agent.id,
    })

    if (!existing) {
      return NextResponse.json({ ok: true, agentId: agent.id, cleared: false })
    }

    await repo.upsertDefault(
      {
        agentId: agent.id,
        loopDisabled: null,
        loopMaxSteps: null,
        loopMaxToolCalls: null,
        loopMaxWallClockMs: null,
        loopMaxTokens: null,
        loopStopWhenJson: null,
        loopActiveToolsJson: null,
      },
      {
        tenantId: authResult.tenantId,
        organizationId: authResult.organizationId,
        userId: authResult.userId,
      },
    )

    return NextResponse.json({ ok: true, agentId: agent.id, cleared: true })
  } catch (error) {
    console.error('[AI Loop Override DELETE] Failure:', error)
    return jsonError(
      500,
      error instanceof Error ? error.message : 'Failed to clear loop override.',
      'internal_error',
    )
  }
}
