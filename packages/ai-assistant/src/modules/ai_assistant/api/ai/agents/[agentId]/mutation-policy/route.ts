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
  isKnownMutationPolicy,
  isMutationPolicyEscalation,
} from '../../../../../lib/agent-policy'
import { AiAgentMutationPolicyOverrideRepository } from '../../../../../data/repositories/AiAgentMutationPolicyOverrideRepository'
import type { AiAgentMutationPolicyOverride } from '../../../../../data/entities'
import type {
  AiAgentDefinition,
  AiAgentMutationPolicy,
} from '../../../../../lib/ai-agent-definition'

const agentIdPattern = /^[a-z0-9_]+\.[a-z0-9_]+$/

const agentIdParamSchema = z.object({
  agentId: z
    .string()
    .regex(agentIdPattern, 'agentId must match "<module>.<agent>" (lowercase, digits, underscores only)'),
})

const mutationPolicySchema = z.enum([
  'read-only',
  'confirm-required',
  'destructive-confirm-required',
])

const mutationPolicyRequestSchema = z.object({
  mutationPolicy: mutationPolicySchema,
  notes: z.string().max(2000).optional(),
})

const VIEW_FEATURE = 'ai_assistant.view'
const MANAGE_FEATURE = 'ai_assistant.settings.manage'

export const openApi: OpenApiRouteDoc = {
  tag: 'AI Assistant',
  summary: 'Tenant-scoped mutationPolicy override for an AI agent',
  methods: {
    GET: {
      operationId: 'aiAssistantGetMutationPolicyOverride',
      summary:
        'Read the effective mutationPolicy for an agent — code-declared value plus any tenant override.',
      description:
        'Returns `{ agentId, codeDeclared, override }` where `codeDeclared` is the agent\'s ' +
        'compiled-in `mutationPolicy` and `override` is the persisted tenant-scoped override ' +
        '(or `null`). Requires `ai_assistant.view`.',
      responses: [
        {
          status: 200,
          description: 'Effective mutationPolicy payload.',
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
    POST: {
      operationId: 'aiAssistantSaveMutationPolicyOverride',
      summary:
        'Set (or replace) the tenant-scoped mutationPolicy override for this agent.',
      description:
        'Body: `{ mutationPolicy: "read-only" | "confirm-required" | "destructive-confirm-required", notes? }`. ' +
        'The override MUST NOT escalate beyond the agent\'s code-declared policy. Escalation attempts ' +
        'are rejected with 400 + `code: "escalation_not_allowed"`. Requires `ai_assistant.settings.manage`.',
      requestBody: {
        contentType: 'application/json',
        description: 'Body: `{ mutationPolicy, notes? }`.',
        schema: mutationPolicyRequestSchema,
      },
      responses: [
        {
          status: 200,
          description: 'Override persisted.',
          mediaType: 'application/json',
        },
      ],
      errors: [
        { status: 400, description: 'Invalid agent id, malformed body, or escalation attempt.' },
        { status: 401, description: 'Unauthenticated caller.' },
        { status: 403, description: 'Caller lacks `ai_assistant.settings.manage`.' },
        { status: 404, description: 'Unknown agent id.' },
      ],
    },
    DELETE: {
      operationId: 'aiAssistantClearMutationPolicyOverride',
      summary: 'Remove the tenant-scoped mutationPolicy override for this agent.',
      description:
        'Deletes the override row if it exists; subsequent calls fall back to the agent\'s ' +
        'code-declared policy. Idempotent — returns 200 even when no override exists. Requires ' +
        '`ai_assistant.settings.manage`.',
      responses: [
        {
          status: 200,
          description: 'Override cleared (or already absent).',
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
  POST: { requireAuth: true, requireFeatures: [MANAGE_FEATURE] },
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
  rbacService: RbacService
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
    rbacService,
  }
}

function serializeOverride(row: AiAgentMutationPolicyOverride) {
  return {
    id: row.id,
    agentId: row.agentId,
    mutationPolicy: row.mutationPolicy,
    notes: row.notes ?? null,
    createdByUserId: row.createdByUserId ?? null,
    createdAt: row.createdAt?.toISOString?.() ?? new Date().toISOString(),
    updatedAt: row.updatedAt?.toISOString?.() ?? new Date().toISOString(),
  }
}

function codeDeclaredPolicy(agent: AiAgentDefinition): AiAgentMutationPolicy {
  const declared = agent.mutationPolicy
  return declared && isKnownMutationPolicy(declared) ? declared : 'read-only'
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

    const declared = codeDeclaredPolicy(agent)
    if (!authResult.tenantId) {
      return NextResponse.json({
        agentId: agent.id,
        codeDeclared: declared,
        override: null,
      })
    }

    const em = authResult.container.resolve<EntityManager>('em')
    const repo = new AiAgentMutationPolicyOverrideRepository(em)
    const current = await repo.get(agent.id, {
      tenantId: authResult.tenantId,
      organizationId: authResult.organizationId,
    })

    return NextResponse.json({
      agentId: agent.id,
      codeDeclared: declared,
      override: current ? serializeOverride(current) : null,
    })
  } catch (error) {
    console.error('[AI Mutation Policy GET] Failure:', error)
    return jsonError(
      500,
      error instanceof Error ? error.message : 'Failed to load mutationPolicy override.',
      'internal_error',
    )
  }
}

export async function POST(req: NextRequest, context: RouteContext): Promise<Response> {
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

  const bodyResult = mutationPolicyRequestSchema.safeParse(parsedBody)
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

    const declared = codeDeclaredPolicy(agent)
    if (isMutationPolicyEscalation(declared, bodyResult.data.mutationPolicy)) {
      return jsonError(
        400,
        `Cannot set mutationPolicy="${bodyResult.data.mutationPolicy}" for agent "${agent.id}": ` +
          `the agent\'s code-declared policy is "${declared}". Upgrading beyond the declared ` +
          `policy is a code-level change, not a configuration change.`,
        'escalation_not_allowed',
        { codeDeclared: declared, requested: bodyResult.data.mutationPolicy },
      )
    }

    if (!authResult.tenantId) {
      return jsonError(
        400,
        'Caller has no tenant context; cannot persist tenant-scoped mutationPolicy override.',
        'tenant_required',
      )
    }

    const em = authResult.container.resolve<EntityManager>('em')
    const repo = new AiAgentMutationPolicyOverrideRepository(em)
    const saved = await repo.set(
      {
        agentId: agent.id,
        mutationPolicy: bodyResult.data.mutationPolicy,
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
      codeDeclared: declared,
      override: serializeOverride(saved),
    })
  } catch (error) {
    console.error('[AI Mutation Policy POST] Failure:', error)
    return jsonError(
      500,
      error instanceof Error ? error.message : 'Failed to save mutationPolicy override.',
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

    const declared = codeDeclaredPolicy(agent)
    if (!authResult.tenantId) {
      return NextResponse.json({
        ok: true,
        agentId: agent.id,
        codeDeclared: declared,
        override: null,
        cleared: false,
      })
    }

    const em = authResult.container.resolve<EntityManager>('em')
    const repo = new AiAgentMutationPolicyOverrideRepository(em)
    const cleared = await repo.clear(agent.id, {
      tenantId: authResult.tenantId,
      organizationId: authResult.organizationId,
    })

    return NextResponse.json({
      ok: true,
      agentId: agent.id,
      codeDeclared: declared,
      override: null,
      cleared,
    })
  } catch (error) {
    console.error('[AI Mutation Policy DELETE] Failure:', error)
    return jsonError(
      500,
      error instanceof Error ? error.message : 'Failed to clear mutationPolicy override.',
      'internal_error',
    )
  }
}
