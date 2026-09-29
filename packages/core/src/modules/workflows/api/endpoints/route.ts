/**
 * Workflow Endpoint Catalog API (issue #4235)
 *
 * Endpoint:
 * - GET /api/workflows/endpoints - Trimmed index of the platform API surface for the CALL_API endpoint picker
 */

import { NextRequest, NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { getWorkflowEndpointCatalog } from '../../lib/endpoint-catalog'
import { workflowsTag, workflowErrorSchema, workflowEndpointListResponseSchema } from '../openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('workflows')

export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.definitions.view'],
}

/**
 * GET /api/workflows/endpoints
 *
 * List the endpoint catalog projected from the in-process OpenAPI surface for
 * the CALL_API endpoint picker.
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
      ['workflows.definitions.view'],
      { tenantId, organizationId }
    )

    if (!hasPermission) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const catalog = await getWorkflowEndpointCatalog()

    return NextResponse.json({ items: catalog.items })
  } catch (error) {
    logger.error('Error listing workflow endpoint catalog', { err: error })
    return NextResponse.json(
      { error: 'Failed to list workflow endpoint catalog' },
      { status: 500 }
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: workflowsTag,
  summary: 'List the workflow endpoint catalog',
  methods: {
    GET: {
      summary: 'List endpoints available to CALL_API activities',
      description: 'Returns a trimmed projection of the OpenAPI surface (path, method, summary, tag, parameters, and declared request/response schemas) consumed by the CALL_API endpoint picker. Endpoints outside this catalog can still be authored as free text. Responses without a declared schema omit responseSchema so consumers degrade to unknown typing.',
      responses: [
        { status: 200, description: 'Endpoint catalog projected from the OpenAPI surface', schema: workflowEndpointListResponseSchema },
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
