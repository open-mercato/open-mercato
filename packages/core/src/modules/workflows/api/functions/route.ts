/**
 * Workflow Functions API
 *
 * Endpoint:
 * - GET /api/workflows/functions - List registered workflow function descriptors for EXECUTE_FUNCTION activities
 */

import { NextRequest, NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { listWorkflowFunctions } from '../../lib/workflow-function-registry'
import { workflowsTag, workflowErrorSchema, workflowFunctionListResponseSchema } from '../openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('workflows')

export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.definitions.edit'],
}

/**
 * GET /api/workflows/functions
 *
 * List the registered workflow function descriptors for the EXECUTE_FUNCTION function picker.
 */
export async function GET(request: NextRequest) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(request)

    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const scope = await resolveOrganizationScopeForRequest({ container, auth, request })
    const tenantId = auth.tenantId
    const organizationId = scope?.selectedId ?? auth.orgId

    if (!tenantId) {
      return NextResponse.json({ error: 'Missing tenant context' }, { status: 400 })
    }

    const rbacService = container.resolve('rbacService')
    const hasPermission = await rbacService.userHasAllFeatures(
      auth.sub,
      ['workflows.definitions.edit'],
      { tenantId, organizationId }
    )

    if (!hasPermission) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const items = listWorkflowFunctions().map((definition) => ({
      name: definition.name,
      ...(definition.labelKey ? { labelKey: definition.labelKey } : {}),
      ...(definition.description ? { description: definition.description } : {}),
    }))

    return NextResponse.json({ items })
  } catch (error) {
    logger.error('Error listing workflow functions', { err: error })
    return NextResponse.json(
      { error: 'Failed to list workflow functions' },
      { status: 500 }
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: workflowsTag,
  summary: 'List workflow functions',
  methods: {
    GET: {
      summary: 'List registered workflow function descriptors for EXECUTE_FUNCTION activities',
      description: 'Returns the registered workflow function descriptors consumed by the EXECUTE_FUNCTION function picker. Functions outside this list can still be authored but fail at runtime when no matching workflowFunction:<name> DI registration exists.',
      responses: [
        { status: 200, description: 'Registered workflow function descriptors', schema: workflowFunctionListResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Missing tenant context', schema: workflowErrorSchema },
        { status: 401, description: 'Unauthorized', schema: workflowErrorSchema },
        { status: 403, description: 'Insufficient permissions', schema: workflowErrorSchema },
        { status: 500, description: 'Internal server error', schema: workflowErrorSchema },
      ],
    },
  },
}
