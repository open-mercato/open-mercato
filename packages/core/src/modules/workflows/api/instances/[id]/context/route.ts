import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import {
  bridgeLegacyGuard,
  runMutationGuards,
  type MutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import { getAllMutationGuardInstances } from '@open-mercato/shared/lib/crud/mutation-guard-store'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { updateWorkflowContextScoped } from '../../../../lib/workflow-executor'
import { wakeConditionWaiters } from '../../../../lib/condition-handler'
import {
  workflowsTag,
  workflowErrorSchema,
  updateInstanceContextRequestSchema,
  updateInstanceContextResponseSchema,
} from '../../../openapi'

const logger = createLogger('workflows')

export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.instances.update_context'],
}

const CONTEXT_RESOURCE_KIND = 'workflows.instance'

const updateContextSchema = z.object({
  context: z.record(z.string(), z.any()),
})

interface RouteContext {
  params: Promise<{ id: string }>
}

function resolveUserFeatures(auth: unknown): string[] {
  const features = (auth as { features?: unknown })?.features
  if (!Array.isArray(features)) return []
  return features.filter((value): value is string => typeof value === 'string')
}

/**
 * PATCH /api/workflows/instances/[id]/context
 *
 * Merge a partial context patch into a running instance and wake any
 * WAIT_FOR_CONDITION waiters whose predicate now holds. This is the
 * event-driven fast path; the per-waiter poll job remains the durability
 * backstop, so a missed call here only costs latency, never correctness.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const params = await context.params

    const container = await createRequestContainer()
    const em = container.resolve('em')
    const auth = await getAuthFromRequest(request)

    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const scope = await resolveOrganizationScopeForRequest({ container, auth, request })
    const tenantId = auth.tenantId
    const organizationId = scope?.selectedId ?? auth.orgId

    if (!tenantId || !organizationId) {
      return NextResponse.json({ error: 'Missing tenant or organization context' }, { status: 400 })
    }

    const rbacService = container.resolve('rbacService')
    const hasPermission = await rbacService.userHasAllFeatures(
      auth.sub,
      ['workflows.instances.update_context'],
      { tenantId, organizationId }
    )
    if (!hasPermission) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const body = await request.json()
    const input = updateContextSchema.parse(body)

    const legacyGuard = bridgeLegacyGuard(container)
    const guards: MutationGuard[] = [...getAllMutationGuardInstances()]
    if (legacyGuard) guards.push(legacyGuard)

    const guardInput = {
      tenantId,
      organizationId,
      userId: auth.sub ?? '',
      resourceKind: CONTEXT_RESOURCE_KIND,
      resourceId: params.id,
      operation: 'update' as const,
      requestMethod: request.method,
      requestHeaders: request.headers,
    }

    const guardResult = await runMutationGuards(guards, guardInput, {
      userFeatures: resolveUserFeatures(auth),
    })
    if (!guardResult.ok) {
      return NextResponse.json(
        guardResult.errorBody ?? { error: 'Operation blocked by guard' },
        { status: guardResult.errorStatus ?? 422 }
      )
    }

    const instance = await updateWorkflowContextScoped(em, {
      instanceId: params.id,
      tenantId,
      organizationId,
      updates: input.context,
      // The optimistic-lock compare must run against the freshly loaded row and
      // BEFORE the merge is flushed, so the scoped helper takes it as a hook.
      assertVersion: (current: Date | null | undefined) =>
        enforceCommandOptimisticLockWithGuards(container, {
          resourceKind: CONTEXT_RESOURCE_KIND,
          resourceId: params.id,
          current,
          request,
        }),
    })

    const { woken } = await wakeConditionWaiters(em, container, {
      instanceId: instance.id,
      tenantId,
      organizationId,
      userId: auth.sub,
    })

    for (const callback of guardResult.afterSuccessCallbacks) {
      if (!callback.guard.afterSuccess) continue
      try {
        await callback.guard.afterSuccess({ ...guardInput, metadata: callback.metadata ?? null })
      } catch (callbackError) {
        logger.error('Mutation guard afterSuccess callback failed', {
          component: 'instance-context',
          guardId: callback.guard.id,
          err: callbackError,
        })
      }
    }

    return NextResponse.json({ ok: true, instanceId: instance.id, woken })
  } catch (error: any) {
    if (isCrudHttpError(error)) {
      return NextResponse.json(error.body, { status: error.status })
    }

    if (error?.name === 'ZodError') {
      return NextResponse.json(
        { error: 'Invalid request body', details: error.errors },
        { status: 400 }
      )
    }

    if (error?.code === 'RESERVED_CONTEXT_KEY') {
      return NextResponse.json(
        { error: error.message, details: error.details },
        { status: 400 }
      )
    }
    if (error?.code === 'INSTANCE_NOT_FOUND') {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    if (error?.code === 'INSTANCE_NOT_UPDATABLE') {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }

    logger.error('Workflow context patch failed', { component: 'instance-context', err: error })

    return NextResponse.json(
      { error: error?.message || 'Failed to update workflow context' },
      { status: 500 }
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: workflowsTag,
  summary: 'Patch workflow instance context',
  methods: {
    PATCH: {
      summary: 'Merge a context patch and wake condition waiters',
      description:
        'Shallow-merges a partial context patch into a RUNNING/PAUSED/FORKED workflow instance, then re-evaluates every WAIT_FOR_CONDITION waiter in that instance and resumes the ones whose predicate now holds. Reserved engine keys are rejected. Requires the workflows.instances.update_context feature.',
      requestBody: {
        contentType: 'application/json',
        schema: updateInstanceContextRequestSchema,
      },
      responses: [
        {
          status: 200,
          description: 'Context merged; woken lists the resumed step ids',
          schema: updateInstanceContextResponseSchema,
        },
      ],
      errors: [
        { status: 400, description: 'Invalid body or reserved context key', schema: workflowErrorSchema },
        { status: 401, description: 'Unauthorized', schema: workflowErrorSchema },
        { status: 403, description: 'Insufficient permissions', schema: workflowErrorSchema },
        { status: 404, description: 'Instance not found in the caller scope', schema: workflowErrorSchema },
        { status: 409, description: 'Instance not updatable or stale version', schema: workflowErrorSchema },
        { status: 500, description: 'Internal server error', schema: workflowErrorSchema },
      ],
    },
  },
}
