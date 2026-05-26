import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { AiPendingActionRepository } from '../../../../../data/repositories/AiPendingActionRepository'
import { hasRequiredFeatures } from '../../../../../lib/auth'
import { serializePendingActionForClient } from '../../../../../lib/pending-action-client'
import { getAgent, loadAgentRegistry } from '../../../../../lib/agent-registry'
import { toolRegistry } from '../../../../../lib/tool-registry'
import { loadAllModuleTools } from '../../../../../lib/tool-loader'
import type { AiToolDefinition } from '../../../../../lib/types'
import {
  runPendingActionRechecks,
  type PendingActionRecheckResult,
} from '../../../../../lib/pending-action-recheck'
import {
  executePendingActionConfirm,
  type PendingActionExecuteContext,
} from '../../../../../lib/pending-action-executor'
import { AiAgentMutationPolicyOverrideRepository } from '../../../../../data/repositories/AiAgentMutationPolicyOverrideRepository'
import type { AiAgentMutationPolicy } from '../../../../../lib/ai-agent-definition'
import { isKnownMutationPolicy } from '../../../../../lib/agent-policy'

/**
 * POST `/api/ai/actions/:id/confirm` — mutation approval gate confirm
 * endpoint (spec §9.4, Step 5.8).
 *
 * Invariant: every check from spec §9.4 is re-run on the server before the
 * tool handler executes. The original model-proposed tool arguments are
 * re-parsed through the CURRENT tool `inputSchema` so that a schema
 * migration between propose and confirm surfaces as `schema_drift`
 * (412) instead of silently passing through invalid data.
 *
 * Idempotency: calling this endpoint twice on the same pending-action id
 * returns the prior execution result without re-invoking the handler.
 */

const REQUIRED_FEATURE = 'ai_assistant.view'

const idParamSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1, 'id must be a non-empty string')
    .max(128, 'id exceeds the maximum length of 128 characters'),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'AI Assistant',
  summary: 'Pending action (mutation approval gate) confirm',
  methods: {
    POST: {
      operationId: 'aiAssistantConfirmPendingAction',
      summary: 'Confirm an AI pending action, re-running every server-side check before execution.',
      description:
        'Re-verifies the full contract from spec §9.4 (status, expiry, agent registration, ' +
        'required features, mutation policy, tool whitelist, attachment tenant scope, record ' +
        'version, and schema drift), flips the pending-action state machine to `executing`, ' +
        'invokes the wrapped tool handler, and persists `executionResult`. Idempotent: a ' +
        'second call on a row already in `confirmed` state returns the prior result without ' +
        're-executing the handler.',
      responses: [
        {
          status: 200,
          description: 'Confirmation complete; body includes the serialized pending action and the mutation result.',
          mediaType: 'application/json',
        },
      ],
      errors: [
        { status: 401, description: 'Unauthenticated caller.' },
        { status: 403, description: 'Caller lacks `ai_assistant.view`, a required agent feature, tool whitelist, or accesses attachments outside their tenant.' },
        { status: 404, description: 'Pending action or agent not found in the caller scope.' },
        { status: 409, description: 'Pending action is not in `pending` status or has expired.' },
        { status: 412, description: 'Record version changed between propose and confirm, or the input schema no longer accepts the stored payload.' },
        { status: 500, description: 'Unexpected server failure during confirm.' },
      ],
    },
  },
}

export const metadata = {
  POST: { requireAuth: true, requireFeatures: [REQUIRED_FEATURE] },
}

interface RouteContext {
  params: Promise<{ id: string }>
}

function jsonError(
  status: number,
  message: string,
  code: string,
  extra?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json({ error: message, code, ...(extra ?? {}) }, { status })
}

function fromRecheckFailure(result: PendingActionRecheckResult & { ok: false }): NextResponse {
  return jsonError(result.status, result.message, result.code, result.extra)
}

export async function POST(req: NextRequest, context: RouteContext): Promise<Response> {
  const auth = await getAuthFromRequest(req)
  if (!auth) {
    return jsonError(401, 'Unauthorized', 'unauthenticated')
  }

  const rawParams = await context.params
  const paramResult = idParamSchema.safeParse(rawParams)
  if (!paramResult.success) {
    return jsonError(400, 'Invalid pending action id.', 'validation_error', {
      issues: paramResult.error.issues,
    })
  }
  const pendingActionId = paramResult.data.id

  try {
    const container = await createRequestContainer()
    const rbacService = container.resolve<RbacService>('rbacService')
    const acl = await rbacService.loadAcl(auth.sub, {
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
    })

    if (!hasRequiredFeatures([REQUIRED_FEATURE], acl.features, acl.isSuperAdmin, rbacService)) {
      return jsonError(403, `Caller lacks required feature "${REQUIRED_FEATURE}".`, 'forbidden')
    }

    if (!auth.tenantId) {
      return jsonError(
        404,
        `No pending action "${pendingActionId}" accessible to the caller.`,
        'pending_action_not_found',
      )
    }

    const em = container.resolve<EntityManager>('em')
    const repo = new AiPendingActionRepository(em)
    const row = await repo.getById(pendingActionId, {
      tenantId: auth.tenantId,
      organizationId: auth.orgId ?? null,
      userId: auth.sub,
    })
    if (!row) {
      return jsonError(
        404,
        `No pending action "${pendingActionId}" accessible to the caller.`,
        'pending_action_not_found',
      )
    }

    // Idempotency short-circuit — a prior confirm already ran.
    if (row.status === 'confirmed' || row.status === 'failed') {
      const executionResult = row.executionResult ?? null
      return NextResponse.json({
        ok: row.status === 'confirmed',
        pendingAction: serializePendingActionForClient(row),
        mutationResult: executionResult,
      })
    }

    await loadAgentRegistry()
    await loadAllModuleTools()
    const agent = getAgent(row.agentId)
    const tool = toolRegistry.getTool(row.toolName) as AiToolDefinition | undefined

    const policyOverrideRepo = new AiAgentMutationPolicyOverrideRepository(em)
    const overrideRow = await policyOverrideRepo.get(row.agentId, {
      tenantId: auth.tenantId,
      organizationId: auth.orgId ?? null,
    })
    const rawOverridePolicy = overrideRow?.mutationPolicy ?? null
    const mutationPolicyOverride: AiAgentMutationPolicy | null =
      rawOverridePolicy && isKnownMutationPolicy(rawOverridePolicy) ? rawOverridePolicy : null

    const recheckResult = await runPendingActionRechecks({
      action: row,
      agent,
      tool,
      ctx: {
        tenantId: auth.tenantId,
        organizationId: auth.orgId ?? null,
        userId: auth.sub,
        userFeatures: acl.features,
        isSuperAdmin: acl.isSuperAdmin,
        container,
        em,
      },
      mutationPolicyOverride,
    })
    if (!recheckResult.ok) {
      return fromRecheckFailure(recheckResult)
    }

    const executeCtx: PendingActionExecuteContext = {
      tenantId: auth.tenantId,
      organizationId: auth.orgId ?? null,
      userId: auth.sub,
      userFeatures: acl.features,
      isSuperAdmin: acl.isSuperAdmin,
      container,
    }

    const executed = await executePendingActionConfirm({
      action: row,
      agent: agent!,
      tool: tool!,
      ctx: executeCtx,
      repo,
      failedRecords: recheckResult.failedRecords ?? null,
    })

    return NextResponse.json({
      ok: executed.ok,
      pendingAction: serializePendingActionForClient(executed.action),
      mutationResult: executed.executionResult,
    })
  } catch (error) {
    console.error('[AI Pending Action CONFIRM] Failure:', error)
    return jsonError(
      500,
      error instanceof Error ? error.message : 'Failed to confirm pending action.',
      'confirm_internal_error',
    )
  }
}
