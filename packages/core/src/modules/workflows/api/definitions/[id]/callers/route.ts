/**
 * Workflow Definition Callers (breaking-change preview)
 *
 * GET /api/workflows/definitions/[id]/callers
 *
 * Returns the parent definitions that invoke this workflow as a sub-workflow and,
 * for each, the field mappings that this definition's current IO port contract
 * would break.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { WorkflowDefinition } from '../../../../data/entities'
import type { WorkflowIoContract } from '../../../../data/validators'
import { findSubWorkflowCallers } from '../../../../lib/caller-graph'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.definitions.view'],
}

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(request: NextRequest, context: RouteContext) {
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

    const definition = await em.findOne(WorkflowDefinition, {
      id: params.id,
      tenantId,
      organizationId,
      deletedAt: null,
    })
    if (!definition) {
      return NextResponse.json({ error: 'Workflow definition not found' }, { status: 404 })
    }

    const ports: WorkflowIoContract = (definition.definition as { io?: WorkflowIoContract })?.io || {}
    const callers = await findSubWorkflowCallers(em, {
      subWorkflowId: definition.workflowId,
      tenantId,
      organizationId,
      ports,
    })

    return NextResponse.json({ callers })
  } catch (error) {
    console.error('Error resolving workflow definition callers:', error)
    return NextResponse.json({ error: 'Failed to resolve callers' }, { status: 500 })
  }
}

export const openApi = {
  methods: {
    GET: {
      summary: 'List sub-workflow callers and breaking mappings',
      description: 'Returns parent definitions that invoke this workflow as a sub-workflow and the mappings its current port contract would break.',
      tags: ['Workflows'],
      pathParams: z.object({ id: z.string().describe('Workflow definition id') }),
      responses: [
        {
          status: 200,
          description: 'Callers',
          example: { callers: [{ workflowId: 'order-flow', version: 1, stepId: 'sub', brokenMappings: ['input:claimId'] }] },
        },
        { status: 404, description: 'Not found', example: { error: 'Workflow definition not found' } },
      ],
    },
  },
}
