/**
 * Workflow Definition Test-Step API (spec §3.6 mock-first dry run)
 *
 * Endpoints:
 * - POST /api/workflows/definitions/[id]/test-step - Dry-run one activity config
 *
 * Mock-first semantics (Phase 2a hard rule): this route NEVER calls
 * `entry.execute` — side-effecting activities cannot be rolled back, so a test
 * run either invokes the registry entry's would-do `mock` or returns a
 * structured refusal. A refusal (`mock: 'refuse'` or no mock declared) is a
 * NORMAL outcome the editor renders, so it responds 200 with
 * `{ refused: true, reason }`, not a 4xx.
 *
 * The config is interpolated exactly like `executeActivityByType` does — via
 * the exported `interpolateVariables` against the caller-supplied sample
 * context, the server-side `{{env.*}}` allowlist, and a SYNTHETIC workflow
 * scope (`instanceId: 'test'`, the authenticated tenant/organization, the
 * target stepId as currentStepId) since no real instance exists. The response
 * includes the interpolated config so the UI can show resolved values. The
 * definition's `interpolation` mode is honored: under strict mode an
 * unresolvable token responds 200 with a structured
 * `{ interpolationFailed: true, token, message }` body — a normal authoring
 * outcome the editor renders, mirroring what the runtime would throw.
 *
 * The route does not read the definition's content, but it still RESOLVES the
 * [id] within the caller's tenant/organization scope (same id forms as the
 * sibling context-schema GET: DB UUID, "code:<workflowId>", synthetic
 * codeWorkflowUuid fallback) and 404s otherwise — the endpoint is anchored to
 * a definition the caller can see, never a free-floating interpolation
 * service.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveOrganizationScopeFilter } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import { WorkflowDefinition, type WorkflowInstance } from '../../../../data/entities'
import { testWorkflowStepInputSchema } from '../../../../data/validators'
import { getActivityType } from '../../../../lib/activity-registry'
import {
  interpolateVariables,
  WorkflowInterpolationError,
  type ActivityContext,
} from '../../../../lib/activity-executor'
import {
  resolveDefinitionInterpolationMode,
  type WorkflowInterpolationMode,
} from '../../../../lib/interpolation-pipeline'
import { getCodeWorkflow, getAllCodeWorkflows } from '../../../../lib/code-registry'
import { codeWorkflowUuid } from '../../../../lib/find-definition'
import {
  workflowsTag,
  workflowErrorSchema,
  workflowTestStepRequestSchema,
  workflowTestStepResponseSchema,
} from '../../../openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('workflows')

export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.definitions.test_run'],
}

interface RouteContext {
  params: Promise<{
    id: string
  }>
}

type ResolvedDefinitionRef = {
  workflowId: string
  version: number
  interpolation?: WorkflowInterpolationMode
}

/**
 * POST /api/workflows/definitions/[id]/test-step
 *
 * Interpolate an activity config against a sample context and run the
 * activity type's would-do mock. Never executes the real activity.
 */
export async function POST(
  request: NextRequest,
  context: RouteContext,
) {
  try {
    const params = await context.params
    const container = await createRequestContainer()
    const em = container.resolve('em') as {
      findOne: (entity: unknown, where: Record<string, unknown>) => Promise<unknown>
    }
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
      ['workflows.definitions.test_run'],
      { tenantId, organizationId },
    )

    if (!hasPermission) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const body = await request.json()
    const validation = testWorkflowStepInputSchema.safeParse(body)
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.issues },
        { status: 400 },
      )
    }
    const input = validation.data

    let definitionRef: ResolvedDefinitionRef | null = null

    if (params.id.startsWith('code:')) {
      const workflowId = params.id.slice(5)
      const codeDef = getCodeWorkflow(workflowId)
      if (codeDef) {
        definitionRef = {
          workflowId: codeDef.workflowId,
          version: 1,
          interpolation: resolveDefinitionInterpolationMode(codeDef.definition),
        }
      }
    } else {
      const orgFilter = resolveOrganizationScopeFilter(scope, auth)
      const definition = (await em.findOne(WorkflowDefinition, {
        id: params.id,
        tenantId,
        ...orgFilter.where,
        deletedAt: null,
      })) as WorkflowDefinition | null

      if (definition) {
        definitionRef = {
          workflowId: definition.workflowId,
          version: definition.version,
          interpolation: resolveDefinitionInterpolationMode(definition.definition),
        }
      } else {
        const codeDef = getAllCodeWorkflows().find(
          (workflow) => codeWorkflowUuid(workflow.workflowId) === params.id,
        )
        if (codeDef) {
          definitionRef = {
            workflowId: codeDef.workflowId,
            version: 1,
            interpolation: resolveDefinitionInterpolationMode(codeDef.definition),
          }
        }
      }
    }

    if (!definitionRef) {
      return NextResponse.json({ error: 'Workflow definition not found' }, { status: 404 })
    }

    const entry = getActivityType(input.activityType)
    if (!entry) {
      return NextResponse.json(
        { error: 'Unknown activity type', activityType: input.activityType },
        { status: 404 },
      )
    }

    const syntheticWorkflowInstance = {
      id: 'test',
      workflowId: definitionRef.workflowId,
      version: definitionRef.version,
      tenantId,
      organizationId,
      currentStepId: input.stepId ?? 'test',
    } as unknown as WorkflowInstance

    let interpolatedConfig: Record<string, unknown>
    try {
      interpolatedConfig = interpolateVariables(
        input.config,
        input.context,
        syntheticWorkflowInstance,
        { mode: definitionRef.interpolation },
      ) as Record<string, unknown>
    } catch (error) {
      if (error instanceof WorkflowInterpolationError) {
        return NextResponse.json({
          interpolationFailed: true,
          token: error.token,
          message: error.message,
          activityType: input.activityType,
        })
      }
      throw error
    }

    if (entry.mock === 'refuse' || entry.mock === undefined) {
      return NextResponse.json({
        refused: true,
        reason: entry.mock === 'refuse' ? 'refused' : 'noMock',
        activityType: input.activityType,
      })
    }

    const mockContext: ActivityContext = {
      workflowInstance: syntheticWorkflowInstance,
      workflowContext: input.context,
    }
    const output = entry.mock(interpolatedConfig, mockContext)

    return NextResponse.json({
      simulated: true,
      activityType: input.activityType,
      output: output ?? null,
      interpolatedConfig,
    })
  } catch (error) {
    logger.error('Error running workflow test step', { err: error })
    return NextResponse.json(
      { error: 'Failed to run workflow test step' },
      { status: 500 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: workflowsTag,
  summary: 'Workflow definition test-step dry run',
  pathParams: z.object({
    id: z.string().describe('UUID for DB definitions, or "code:<workflowId>" for code-based definitions'),
  }),
  methods: {
    POST: {
      summary: 'Dry-run one activity config with mock-first semantics',
      description: 'Interpolates the supplied activity config against the sample context (plus a synthetic workflow scope and the server env allowlist) and runs the activity type\'s would-do mock. Never executes the real activity. Activity types that declare no mock or opt out with "refuse" respond 200 with a structured refusal the editor renders.',
      requestBody: {
        schema: workflowTestStepRequestSchema,
        example: {
          stepId: 'notify',
          activityType: 'SEND_EMAIL',
          config: { to: '{{context.customerEmail}}', subject: 'Order {{context.orderId}} approved' },
          context: { customerEmail: 'jane@example.com', orderId: 'ORD-42' },
        },
      },
      responses: [
        {
          status: 200,
          description: 'Simulated mock output, or a structured refusal when the type cannot be simulated',
          schema: workflowTestStepResponseSchema,
          example: {
            simulated: true,
            activityType: 'SEND_EMAIL',
            output: { sent: false, simulated: true, wouldSendTo: 'jane@example.com', subject: 'Order ORD-42 approved' },
            interpolatedConfig: { to: 'jane@example.com', subject: 'Order ORD-42 approved' },
          },
        },
      ],
      errors: [
        { status: 400, description: 'Missing tenant context or malformed payload', schema: workflowErrorSchema },
        { status: 403, description: 'Insufficient permissions', schema: workflowErrorSchema },
        { status: 404, description: 'Workflow definition or activity type not found', schema: workflowErrorSchema },
      ],
    },
  },
}
