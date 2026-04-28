/**
 * Customize Code-Based Workflow Definition
 *
 * POST /api/workflows/definitions/[id]/customize
 *
 * Creates a DB override row for a code-based workflow definition, seeded from
 * the current code registry values. The id param must be of the form
 * "code:<workflowId>".
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { validateCrudMutationGuard, runCrudMutationGuardAfterSuccess } from '@open-mercato/shared/lib/crud/mutation-guard'
import { WorkflowDefinition } from '../../../../data/entities'
import { serializeWorkflowDefinition } from '../../serialize'
import { getCodeWorkflow } from '../../../../lib/code-registry'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.definitions.edit'],
}

interface RouteContext {
  params: Promise<{
    id: string
  }>
}

export async function POST(request: NextRequest, context: RouteContext) {
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

    const rbacService = container.resolve('rbacService')
    const hasPermission = await rbacService.userHasAllFeatures(
      auth.sub,
      ['workflows.definitions.edit'],
      { tenantId, organizationId },
    )
    if (!hasPermission) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    if (!params.id.startsWith('code:')) {
      return NextResponse.json(
        { error: 'Customize is only supported for code-based workflow definitions' },
        { status: 400 },
      )
    }

    const workflowId = params.id.slice(5)
    const codeDef = getCodeWorkflow(workflowId)
    if (!codeDef) {
      return NextResponse.json({ error: 'Workflow definition not found' }, { status: 404 })
    }

    const guardResult = await validateCrudMutationGuard(container, {
      tenantId: tenantId ?? '',
      organizationId: organizationId ?? null,
      userId: auth.sub ?? '',
      resourceKind: 'workflows.definition',
      resourceId: params.id,
      operation: 'custom',
      requestMethod: 'POST',
      requestHeaders: request.headers,
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }

    const existingOverride = await em.findOne(WorkflowDefinition, {
      workflowId: codeDef.workflowId,
      tenantId,
    })

    let saved: WorkflowDefinition
    if (existingOverride) {
      existingOverride.deletedAt = null
      existingOverride.workflowName = codeDef.workflowName
      existingOverride.description = codeDef.description
      existingOverride.version = codeDef.version
      existingOverride.definition = codeDef.definition
      existingOverride.metadata = codeDef.metadata ?? null
      existingOverride.enabled = codeDef.enabled
      existingOverride.codeWorkflowId = codeDef.workflowId
      existingOverride.updatedBy = auth.sub
      existingOverride.updatedAt = new Date()
      await em.flush()
      saved = existingOverride
    } else {
      const override = em.create(WorkflowDefinition, {
        workflowId: codeDef.workflowId,
        workflowName: codeDef.workflowName,
        description: codeDef.description,
        version: codeDef.version,
        definition: codeDef.definition,
        metadata: codeDef.metadata,
        enabled: codeDef.enabled,
        codeWorkflowId: codeDef.workflowId,
        tenantId,
        organizationId,
        createdBy: auth.sub,
        updatedBy: auth.sub,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      em.persist(override)
      await em.flush()
      saved = override
    }

    if (guardResult?.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(container, {
        tenantId: tenantId ?? '',
        organizationId: organizationId ?? null,
        userId: auth.sub ?? '',
        resourceKind: 'workflows.definition',
        resourceId: String(saved.id),
        operation: 'custom',
        requestMethod: 'POST',
        requestHeaders: request.headers,
        metadata: guardResult.metadata,
      })
    }

    return NextResponse.json({
      data: serializeWorkflowDefinition(saved),
      message: 'Workflow definition customized successfully',
    })
  } catch (error) {
    console.error('Error customizing workflow definition:', error)
    return NextResponse.json({ error: 'Failed to customize workflow definition' }, { status: 500 })
  }
}

export const openApi = {
  methods: {
    POST: {
      summary: 'Customize code-based workflow definition',
      description: 'Creates a DB override for a code-based workflow definition, seeded from the current code registry values. The id param must be of the form "code:<workflowId>".',
      tags: ['Workflows'],
      pathParams: z.object({
        id: z.string().describe('Must be of the form "code:<workflowId>"'),
      }),
      responses: [
        {
          status: 200,
          description: 'Workflow definition customized successfully',
          example: {
            data: {
              id: '123e4567-e89b-12d3-a456-426614174000',
              workflowId: 'workflows.simple-approval',
              workflowName: 'Simple Approval Workflow',
              source: 'code_override',
            },
            message: 'Workflow definition customized successfully',
          },
        },
        {
          status: 400,
          description: 'Not a code-based id',
          example: { error: 'Customize is only supported for code-based workflow definitions' },
        },
        {
          status: 404,
          description: 'Code workflow not found',
          example: { error: 'Workflow definition not found' },
        },
      ],
    },
  },
}
