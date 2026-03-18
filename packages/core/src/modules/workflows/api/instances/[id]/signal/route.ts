import { NextRequest, NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { z } from 'zod'
import { sendSignal } from '../../../../lib/signal-handler'
import {
  workflowsTag,
  sendSignalRequestSchema,
  sendSignalResponseSchema,
  workflowErrorSchema,
} from '../../../openapi'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.instances.signal'],
}

const sendSignalSchema = z.object({
  signalName: z.string().min(1, 'Signal name required'),
  payload: z.record(z.string(), z.any()).optional(),
})

interface RouteContext {
  params: Promise<{
    id: string
  }>
}

/**
 * POST /api/workflows/instances/[id]/signal
 *
 * Send signal to workflow instance
 */
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

    if (!tenantId || !organizationId) {
      return NextResponse.json(
        { error: 'Missing tenant or organization context' },
        { status: 400 }
      )
    }

    console.log('[Signal API] Auth context:', {
      userId: auth.sub,
      tenantId,
      organizationId,
    })

    // Check permission
    const rbacService = container.resolve('rbacService')
    const hasPermission = await rbacService.userHasAllFeatures(
      auth.sub,
      ['workflows.instances.signal'],
      { tenantId, organizationId }
    )

    if (!hasPermission) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const body = await request.json()

    const input = sendSignalSchema.parse(body)

    await sendSignal(em, container, {
      instanceId: params.id,
      signalName: input.signalName,
      payload: input.payload,
      userId: auth.sub,
      tenantId,
      organizationId,
    })

    return NextResponse.json({
      success: true,
      message: 'Signal sent successfully',
    })
  } catch (error: any) {
    console.error('[Signal API] Error occurred:', {
      name: error.name,
      message: error.message,
      code: error.code,
      stack: error.stack,
    })

    // Handle Zod validation errors
    if (error.name === 'ZodError') {
      return NextResponse.json(
        { error: 'Invalid request body', details: error.errors },
        { status: 400 }
      )
    }

    // Handle SignalError custom errors
    if (error.code === 'INSTANCE_NOT_FOUND') {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    if (error.code === 'WORKFLOW_NOT_PAUSED' || error.code === 'NOT_WAITING_FOR_SIGNAL') {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    if (error.code === 'SIGNAL_NAME_MISMATCH') {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    if (error.code === 'DEFINITION_NOT_FOUND') {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    if (error.code === 'TRANSITION_FAILED') {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Generic error handler
    return NextResponse.json(
      {
        error: error.message || 'Failed to send signal',
        details: error.details || undefined,
      },
      { status: 500 }
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: workflowsTag,
  summary: 'Send signal to workflow instance',
  methods: {
    POST: {
      summary: 'Send signal to specific workflow',
      description: 'Sends a signal to a specific workflow instance waiting for a signal. The workflow must be in PAUSED status and waiting for the specified signal.',
      requestBody: {
        contentType: 'application/json',
        schema: sendSignalRequestSchema,
      },
      responses: [
        { status: 200, description: 'Signal sent successfully', schema: sendSignalResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid request body or signal name mismatch', schema: workflowErrorSchema },
        { status: 401, description: 'Unauthorized', schema: workflowErrorSchema },
        { status: 403, description: 'Insufficient permissions', schema: workflowErrorSchema },
        { status: 404, description: 'Instance or definition not found', schema: workflowErrorSchema },
        { status: 409, description: 'Workflow not paused or not waiting for signal', schema: workflowErrorSchema },
        { status: 500, description: 'Internal server error or transition failed', schema: workflowErrorSchema },
      ],
    },
  },
}
