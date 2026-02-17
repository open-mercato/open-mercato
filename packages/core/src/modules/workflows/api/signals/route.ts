import { NextRequest, NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { z } from 'zod'
import { sendSignalByCorrelationKey } from '../../lib/signal-handler'
import {
  workflowsTag,
  sendSignalByCorrelationRequestSchema,
  sendSignalByCorrelationResponseSchema,
  workflowErrorSchema,
} from '../openapi'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.signals.send'],
}

const sendSignalByKeySchema = z.object({
  correlationKey: z.string().min(1, 'Correlation key required'),
  signalName: z.string().min(1, 'Signal name required'),
  payload: z.record(z.string(), z.any()).optional(),
})

/**
 * POST /api/workflows/signals
 *
 * Send signal to workflows by correlation key
 */
export async function POST(request: NextRequest) {
  try {
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
      return NextResponse.json(
        { error: 'Missing tenant or organization context' },
        { status: 400 }
      )
    }

    // Check permission
    const rbacService = container.resolve('rbacService')
    const hasPermission = await rbacService.userHasAllFeatures(
      auth.sub,
      ['workflows.signals.send'],
      { tenantId, organizationId }
    )

    if (!hasPermission) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const body = await request.json()
    const input = sendSignalByKeySchema.parse(body)

    const count = await sendSignalByCorrelationKey(em, container, {
      correlationKey: input.correlationKey,
      signalName: input.signalName,
      payload: input.payload,
      userId: auth.sub,
      tenantId,
      organizationId,
    })

    return NextResponse.json({
      success: true,
      message: `Signal sent to ${count} workflow(s)`,
      count,
    })
  } catch (error: any) {
    console.error('Signal error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to send signal' },
      { status: 500 }
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: workflowsTag,
  summary: 'Send signal by correlation key',
  methods: {
    POST: {
      summary: 'Send signal to workflows by correlation key',
      description: 'Sends a signal to all workflow instances waiting for the specified signal that match the correlation key. Returns the count of workflows that received the signal.',
      requestBody: {
        contentType: 'application/json',
        schema: sendSignalByCorrelationRequestSchema,
      },
      responses: [
        { status: 200, description: 'Signal sent to matching workflows', schema: sendSignalByCorrelationResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Missing tenant or organization context', schema: workflowErrorSchema },
        { status: 401, description: 'Unauthorized', schema: workflowErrorSchema },
        { status: 403, description: 'Insufficient permissions', schema: workflowErrorSchema },
        { status: 500, description: 'Internal server error', schema: workflowErrorSchema },
      ],
    },
  },
}
