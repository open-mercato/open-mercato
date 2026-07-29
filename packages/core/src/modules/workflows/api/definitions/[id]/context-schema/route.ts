/**
 * Workflow Definition Context-Schema API (spec §3.1 context ledger)
 *
 * Endpoints:
 * - GET /api/workflows/definitions/[id]/context-schema - Per-step context ledger
 *
 * Serves the SERVER-computed context ledger for a workflow definition: for
 * every step, the entries describing what context paths are available when the
 * step runs, with type/presence/source metadata. Computed on the server
 * because only the server runtime has the full activity registry and command
 * registry (UPDATE_ENTITY output schemas resolve through
 * `resolveServerOutputContract`); the browser-side editor consumes this
 * response instead of resolving contracts locally.
 *
 * Supports the same id forms as the sibling definition GET: a DB UUID
 * (tenant/org-scoped), "code:<workflowId>" for code-based definitions, and the
 * synthetic codeWorkflowUuid(workflowId) fallback used by instances started
 * from unpersisted code definitions. `?stepId=<id>` narrows the response to a
 * single step and 404s when the step does not exist in the definition.
 */

import { NextRequest, NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/core'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveOrganizationScopeFilter } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import { type WorkflowDefinitionData } from '../../../../data/entities'
import {
  computeDefinitionContextLedger,
  narrowLedgerToStep,
  resolveDefinitionDataForLedger,
  warmContextLedgerResolvers,
} from '../../../../lib/definition-context-schema'
import {
  workflowsTag,
  workflowErrorSchema,
  workflowContextSchemaResponseSchema,
} from '../../../openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('workflows')

export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.definitions.view'],
}

interface RouteContext {
  params: Promise<{
    id: string
  }>
}

function respondWithLedger(definition: WorkflowDefinitionData, stepId: string | null) {
  const ledger = computeDefinitionContextLedger(definition)
  if (stepId === null) {
    return NextResponse.json({ steps: ledger.steps })
  }
  const stepView = narrowLedgerToStep(ledger, stepId)
  if (!stepView) {
    return NextResponse.json(
      { error: 'Step not found in workflow definition' },
      { status: 404 },
    )
  }
  return NextResponse.json({ steps: { [stepId]: stepView } })
}

/**
 * GET /api/workflows/definitions/[id]/context-schema
 *
 * Compute and return the per-step context ledger for a workflow definition.
 */
export async function GET(
  request: NextRequest,
  context: RouteContext,
) {
  try {
    const params = await context.params
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const auth = await getAuthFromRequest(request)

    if (!auth || !auth.sub) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const scope = await resolveOrganizationScopeForRequest({ container, auth, request })
    const tenantId = auth.tenantId
    const organizationId = scope?.selectedId ?? auth.orgId ?? null

    if (!tenantId) {
      return NextResponse.json({ error: 'Missing tenant context' }, { status: 400 })
    }

    const rbacService = container.resolve('rbacService') as {
      userHasAllFeatures: (
        userId: string,
        features: string[],
        scope: { tenantId: string | null; organizationId: string | null },
      ) => Promise<boolean>
    }
    const hasPermission = await rbacService.userHasAllFeatures(
      auth.sub,
      ['workflows.definitions.view'],
      { tenantId, organizationId },
    )

    if (!hasPermission) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const stepId = new URL(request.url).searchParams.get('stepId')

    await warmContextLedgerResolvers(container)

    const orgFilter = resolveOrganizationScopeFilter(scope, auth)
    const definitionData = await resolveDefinitionDataForLedger(em, params.id, {
      tenantId,
      organizationWhere: orgFilter.where,
    })

    if (!definitionData) {
      return NextResponse.json({ error: 'Workflow definition not found' }, { status: 404 })
    }

    return respondWithLedger(definitionData, stepId)
  } catch (error) {
    logger.error('Error computing workflow context schema', { err: error })
    return NextResponse.json(
      { error: 'Failed to compute workflow context schema' },
      { status: 500 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: workflowsTag,
  summary: 'Workflow definition per-step context ledger',
  pathParams: z.object({
    id: z.string().describe('UUID for DB definitions, or "code:<workflowId>" for code-based definitions'),
  }),
  methods: {
    GET: {
      summary: 'Get the per-step context ledger',
      description: 'Computes what context paths are available at each step of the workflow definition, with type, presence (always/maybe), and producer source. Presence degrades to "maybe" at joins unless the entry arrives on every incoming route. Use ?stepId=<id> to narrow the response to one step.',
      query: z.object({
        stepId: z.string().optional().describe('Narrow the response to this step (404 when the step does not exist)'),
      }),
      responses: [
        {
          status: 200,
          description: 'Per-step context ledger',
          schema: workflowContextSchemaResponseSchema,
          example: {
            steps: {
              approve: {
                entries: [
                  {
                    path: 'orderId',
                    type: 'text',
                    presence: 'always',
                    source: { kind: 'contextSchema', label: 'contextSchema.input' },
                  },
                  {
                    path: 'discount',
                    type: 'number',
                    presence: 'maybe',
                    source: { kind: 'userTask', stepId: 'review', label: 'userTask:review' },
                  },
                ],
              },
            },
          },
        },
      ],
      errors: [
        { status: 400, description: 'Missing tenant context', schema: workflowErrorSchema },
        { status: 403, description: 'Insufficient permissions', schema: workflowErrorSchema },
        { status: 404, description: 'Workflow definition or requested step not found', schema: workflowErrorSchema },
      ],
    },
  },
}
