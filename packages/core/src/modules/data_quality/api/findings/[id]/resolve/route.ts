import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import { resolveFindingSchema } from '../../../../data/validators'
import {
  resolveDataQualityRouteContext,
  unwrapRouteParams,
} from '../../../helpers'

const routeMetadata = {
  POST: { requireAuth: true, requireFeatures: ['data_quality.finding.manage'] },
}

export const metadata = routeMetadata

const paramsSchema = z.object({ id: z.string().uuid() })
const resolveResultSchema = z.object({
  ok: z.literal(true),
  id: z.string().uuid(),
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

    const body = await readJsonSafe<Record<string, unknown>>(req, {})
    resolveFindingSchema.parse(body)
    const guardUserId = context.auth.userId ?? context.auth.sub
    if (!guardUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const guardResult = await validateCrudMutationGuard(context.container, {
      tenantId,
      organizationId: context.selectedOrganizationId,
      userId: guardUserId,
      resourceKind: 'data_quality.finding',
      resourceId: parsedParams.id,
      operation: 'custom',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: { id: parsedParams.id, ...body },
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }

    const commandBus = context.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<{ id: string }, { id: string; status: string }>(
      'data_quality.finding.resolve',
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
        resourceKind: 'data_quality.finding',
        resourceId: parsedParams.id,
        operation: 'custom',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }

    return NextResponse.json({ ok: true, id: parsedParams.id, status: result.status })
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
    console.error('data_quality.finding.resolve failed', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Data Quality',
  summary: 'Resolve a data quality finding',
  pathParams: paramsSchema,
  methods: {
    POST: {
      summary: 'Resolve a data quality finding',
      requestBody: { contentType: 'application/json', schema: resolveFindingSchema },
      responses: [{ status: 200, description: 'Resolved finding', schema: resolveResultSchema }],
    },
  },
}
