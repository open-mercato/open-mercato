/**
 * Reset Customized Workflow Definition to Code
 *
 * POST /api/workflows/definitions/[id]/reset-to-code
 *
 * Deletes the DB override row for a code-based workflow definition,
 * reverting it back to the original code registry version.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { WorkflowDefinition, WorkflowInstance } from '../../../../data/entities'
import { serializeCodeWorkflowDefinition } from '../../serialize'
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

/**
 * POST /api/workflows/definitions/[id]/reset-to-code
 *
 * Reset a customized code workflow definition back to its original code version.
 */
export async function POST(
  request: NextRequest,
  context: RouteContext
) {
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

    // Check edit permission
    const rbacService = container.resolve('rbacService')
    const hasPermission = await rbacService.userHasAllFeatures(
      auth.sub,
      ['workflows.definitions.edit'],
      {
        tenantId,
        organizationId,
      }
    )

    if (!hasPermission) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      )
    }

    // Find existing definition
    const definition = await em.findOne(WorkflowDefinition, {
      id: params.id,
      tenantId,
      organizationId,
      deletedAt: null,
    })

    if (!definition) {
      return NextResponse.json(
        { error: 'Workflow definition not found' },
        { status: 404 }
      )
    }

    // Verify this is a code-based override
    if (!definition.codeWorkflowId) {
      return NextResponse.json(
        { error: 'This workflow definition is not a code-based override and cannot be reset' },
        { status: 400 }
      )
    }

    // Check if there are active workflow instances using this definition
    const activeInstances = await em.count(WorkflowInstance, {
      definitionId: definition.id,
      status: { $in: ['RUNNING', 'WAITING'] },
    })

    if (activeInstances > 0) {
      return NextResponse.json(
        {
          error: `Cannot reset workflow definition with ${activeInstances} active instance(s)`,
        },
        { status: 409 }
      )
    }

    // Look up the original code definition before deleting
    const codeDef = getCodeWorkflow(definition.codeWorkflowId)

    // Hard-delete the DB override row
    await em.removeAndFlush(definition)

    if (!codeDef) {
      return NextResponse.json({
        message: 'Workflow definition reset to code version (code definition no longer registered)',
        data: null,
      })
    }

    const syntheticId = `code:${codeDef.workflowId}`

    return NextResponse.json({
      data: serializeCodeWorkflowDefinition(codeDef, syntheticId),
      message: 'Workflow definition reset to code version',
    })
  } catch (error) {
    console.error('Error resetting workflow definition to code:', error)
    return NextResponse.json(
      { error: 'Failed to reset workflow definition to code' },
      { status: 500 }
    )
  }
}

export const openApi = {
  methods: {
    POST: {
      summary: 'Reset workflow definition to code version',
      description: 'Deletes the DB override for a code-based workflow definition, reverting it to the original code registry version. Cannot be reset if there are active instances.',
      tags: ['Workflows'],
      pathParams: z.object({
        id: z.string().uuid(),
      }),
      responses: [
        {
          status: 200,
          description: 'Workflow definition reset to code version',
          example: {
            data: {
              id: 'code:checkout-flow',
              workflowId: 'checkout-flow',
              workflowName: 'Checkout Flow',
              description: 'Code-defined checkout workflow',
              version: 1,
              source: 'code',
              isCodeBased: true,
            },
            message: 'Workflow definition reset to code version',
          },
        },
        {
          status: 400,
          description: 'Definition is not a code-based override',
          example: {
            error: 'This workflow definition is not a code-based override and cannot be reset',
          },
        },
        {
          status: 404,
          description: 'Workflow definition not found',
          example: {
            error: 'Workflow definition not found',
          },
        },
        {
          status: 409,
          description: 'Cannot reset - active workflow instances exist',
          example: {
            error: 'Cannot reset workflow definition with 3 active instance(s)',
          },
        },
      ],
    },
  },
}
