/**
 * Business Rule Usage in Workflows (dependency visibility)
 *
 * GET /api/workflows/rule-usage?ruleId=<business rule id>
 *
 * Backs the "used by: N workflows" panel the Studio renders beside the inline
 * business-rule editor. It lives in workflows — not business_rules — so the
 * upstream module never learns about its consumers.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { countReferencingWorkflows, findBusinessRuleUsage } from '../../lib/business-rule-usage'

const logger = createLogger('workflows').child({ component: 'rule-usage-api' })

export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.definitions.view'],
}

const querySchema = z.object({
  ruleId: z.string().min(1).max(50),
})

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthFromRequest(request)
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    const parsed = querySchema.safeParse({ ruleId: url.searchParams.get('ruleId') || undefined })
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid query parameters' }, { status: 400 })
    }

    const container = await createRequestContainer()
    const em = container.resolve('em')
    const scope = await resolveOrganizationScopeForRequest({ container, auth, request })
    const tenantId = auth.tenantId
    const organizationId = scope?.selectedId ?? auth.orgId

    if (!tenantId || !organizationId) {
      return NextResponse.json({ error: 'Missing tenant or organization context' }, { status: 400 })
    }

    const references = await findBusinessRuleUsage(em, {
      ruleId: parsed.data.ruleId,
      tenantId,
      organizationId,
    })

    return NextResponse.json({
      ruleId: parsed.data.ruleId,
      workflowCount: countReferencingWorkflows(references),
      references,
    })
  } catch (error) {
    logger.error('Failed to resolve business rule usage', { err: error })
    return NextResponse.json({ error: 'Failed to resolve business rule usage' }, { status: 500 })
  }
}

export const openApi = {
  methods: {
    GET: {
      summary: 'List workflows referencing a business rule',
      description: 'Returns the workflow definitions whose START pre-conditions or transition pre/post-conditions reference the given business rule.',
      tags: ['Workflows'],
      query: querySchema,
      responses: [
        {
          status: 200,
          description: 'Usage references',
          example: {
            ruleId: 'ORDER_ABOVE_LIMIT',
            workflowCount: 1,
            references: [
              { workflowId: 'order-approval', version: 2, kind: 'transitionPreCondition', locationId: 'e_start_review' },
            ],
          },
        },
        { status: 400, description: 'Invalid query parameters', example: { error: 'Invalid query parameters' } },
        { status: 401, description: 'Unauthorized', example: { error: 'Unauthorized' } },
      ],
    },
  },
}
