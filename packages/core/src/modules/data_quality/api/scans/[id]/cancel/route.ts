import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import {
  resolveDataQualityRouteContext,
  unwrapRouteParams,
} from '../../../helpers'

const routeMetadata = {
  POST: { requireAuth: true, requireFeatures: ['data_quality.scan.run'] },
}

export const metadata = routeMetadata

const paramsSchema = z.object({ id: z.string().uuid() })
const cancelResultSchema = z.object({
  ok: z.literal(true),
  scanRunId: z.string().uuid(),
  status: z.string(),
})

export async function POST(
  req: Request,
  routeContext: { params?: Promise<{ id?: string }> | { id?: string } },
) {
  try {
    const context = await resolveDataQualityRouteContext(req)
    if (!context) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsedParams = paramsSchema.parse(await unwrapRouteParams(routeContext))
    const tenantId = context.auth.tenantId
    if (!tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const guardUserId = context.auth.userId ?? context.auth.sub
    if (!guardUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const guardResult = await validateCrudMutationGuard(context.container, {
      tenantId,
      organizationId: context.selectedOrganizationId,
      userId: guardUserId,
      resourceKind: 'data_quality.scan',
      resourceId: parsedParams.id,
      operation: 'custom',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: { id: parsedParams.id },
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }

    const commandBus = context.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<{ id: string }, { id: string; status: string }>(
      'data_quality.scan.cancel',
      {
        input: { id: parsedParams.id },
        ctx: context.commandContext,
      },
    )

    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(context.container, {
        tenantId,
        organizationId: context.selectedOrganizationId,
        userId: guardUserId,
        resourceKind: 'data_quality.scan',
        resourceId: parsedParams.id,
        operation: 'custom',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }

    return NextResponse.json({ ok: true, scanRunId: parsedParams.id, status: result.status })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation failed', details: error.issues }, { status: 400 })
    }
    if (error && typeof error === 'object' && 'body' in error && 'status' in error) {
      const maybeCrudError = error as { body?: Record<string, unknown>; status?: number }
      if (typeof maybeCrudError.status === 'number' && maybeCrudError.body) {
        return NextResponse.json(maybeCrudError.body, { status: maybeCrudError.status })
      }
    }
    console.error('data_quality.scan.cancel failed', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Data Quality',
  summary: 'Cancel a data quality scan',
  pathParams: paramsSchema,
  methods: {
    POST: {
      summary: 'Cancel a running data quality scan',
      responses: [{ status: 200, description: 'Cancelled scan', schema: cancelResultSchema }],
    },
  },
}
