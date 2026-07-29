/**
 * Workflow-Safe Commands API
 *
 * Endpoint:
 * - GET /api/workflows/commands - List commands allowlisted for UPDATE_ENTITY activities
 */

import { NextRequest, NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { listWorkflowSafeCommands } from '../../lib/workflow-safe-commands'
import { workflowsTag, workflowErrorSchema, workflowSafeCommandListResponseSchema } from '../openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('workflows')

export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.definitions.edit'],
}

/**
 * GET /api/workflows/commands
 *
 * List the workflow-safe command allowlist for the UPDATE_ENTITY command picker.
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

    const items = listWorkflowSafeCommands().map((command) => ({
      commandId: command.commandId,
      requiredFeatures: [...command.requiredFeatures],
    }))

    return NextResponse.json({ items })
  } catch (error) {
    logger.error('Error listing workflow-safe commands', { err: error })
    return NextResponse.json(
      { error: 'Failed to list workflow-safe commands' },
      { status: 500 }
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: workflowsTag,
  summary: 'List workflow-safe commands',
  methods: {
    GET: {
      summary: 'List commands allowlisted for UPDATE_ENTITY activities',
      description: 'Returns the registered workflow-safe command allowlist consumed by the UPDATE_ENTITY command picker. Commands outside this list can still be authored but fail at runtime.',
      responses: [
        { status: 200, description: 'Allowlisted workflow-safe commands', schema: workflowSafeCommandListResponseSchema },
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
