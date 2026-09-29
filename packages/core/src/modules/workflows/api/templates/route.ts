/**
 * Workflow Templates API
 *
 * Endpoint:
 * - GET /api/workflows/templates - List seeded workflow templates for the gallery
 */

import { NextRequest, NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { loadWorkflowTemplates } from '../../lib/workflow-templates'
import { workflowsTag, workflowErrorSchema, workflowTemplateListResponseSchema } from '../openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('workflows')

export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.definitions.view'],
}

/**
 * GET /api/workflows/templates
 *
 * List the shipped workflow templates (gallery metadata + full definitions).
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

    const items = loadWorkflowTemplates()

    return NextResponse.json({ items })
  } catch (error) {
    logger.error('Error listing workflow templates', { err: error })
    return NextResponse.json(
      { error: 'Failed to list workflow templates' },
      { status: 500 }
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: workflowsTag,
  summary: 'List workflow templates',
  methods: {
    GET: {
      summary: 'List seeded workflow templates',
      description: 'Returns the shipped workflow template gallery: metadata (id, i18n name/description keys, category, icon) plus the complete workflow definition each template seeds.',
      responses: [
        { status: 200, description: 'Available workflow templates', schema: workflowTemplateListResponseSchema },
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
