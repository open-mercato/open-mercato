/**
 * Workflow Start Validation API
 *
 * POST /api/workflows/instances/validate-start
 *
 * Validates if a workflow can be started with the given context.
 * Evaluates pre-conditions defined on the START step and returns
 * validation errors with localized messages if any fail.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import * as startValidator from '../../../lib/start-validator'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.instances.view'],
}

// Input schema for validation request
const validateStartInputSchema = z.object({
  workflowId: z.string().min(1),
  version: z.number().int().positive().optional(),
  context: z.record(z.string(), z.any()).optional().default({}),
  locale: z.string().default('en'),
})

/**
 * POST /api/workflows/instances/validate-start
 *
 * Validates if a workflow can be started with the given context.
 * Returns 200 with validation result (canStart: true/false, errors, validatedRules)
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

    const body = await request.json()
    const validation = validateStartInputSchema.safeParse(body)

    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.issues },
        { status: 400 }
      )
    }

    const { workflowId, version, context, locale } = validation.data

    // Validate start pre-conditions
    const result = await startValidator.validateWorkflowStart(em, {
      workflowId,
      version,
      context,
      locale,
      tenantId,
      organizationId,
    })

    // Always return 200 with the validation result
    // The client can check canStart to determine if workflow can proceed
    return NextResponse.json({
      canStart: result.canStart,
      workflowId,
      errors: result.errors.length > 0 ? result.errors : undefined,
      validatedRules: result.validatedRules.length > 0 ? result.validatedRules : undefined,
    })
  } catch (error) {
    console.error('Error validating workflow start:', error)
    return NextResponse.json(
      { error: 'Failed to validate workflow start' },
      { status: 500 }
    )
  }
}
