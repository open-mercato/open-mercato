import type { EntityManager } from '@mikro-orm/postgresql'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import { DataQualityCheck, DataQualitySuiteCheck } from '../../../../data/entities'
import {
  assignSuiteChecksSchema,
  type AssignSuiteChecksInput,
} from '../../../../data/validators'
import {
  resolveDataQualityRouteContext,
  unwrapRouteParams,
} from '../../../helpers'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['data_quality.suite.view'] },
  POST: { requireAuth: true, requireFeatures: ['data_quality.suite.manage'] },
}

export const metadata = routeMetadata

const paramsSchema = z.object({ id: z.string().uuid() })
const suiteCheckListItemSchema = z.object({
  id: z.string().uuid(),
  checkId: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  severity: z.string(),
  enabled: z.boolean(),
  sequence: z.number(),
})
const assignResultSchema = z.object({
  ok: z.literal(true),
  suiteId: z.string().uuid(),
  count: z.number(),
})

export async function GET(
  req: Request,
  routeContext: { params?: Promise<{ id?: string }> | { id?: string } },
) {
  const context = await resolveDataQualityRouteContext(req)
  if (!context) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsedParams = paramsSchema.safeParse(await unwrapRouteParams(routeContext))
  if (!parsedParams.success) {
    return NextResponse.json({ error: 'Invalid suite id', details: parsedParams.error.issues }, { status: 400 })
  }

  const tenantId = context.auth.tenantId
  if (!tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const em = context.container.resolve<EntityManager>('em')
  const membershipWhere: Record<string, unknown> = {
    suiteId: parsedParams.data.id,
    tenantId,
    deletedAt: null,
  }
  if (context.selectedOrganizationId) {
    membershipWhere.organizationId = context.selectedOrganizationId
  } else if (context.organizationIds) {
    membershipWhere.organizationId = { $in: context.organizationIds }
  }

  const memberships = await em.find(DataQualitySuiteCheck, membershipWhere as never, {
    orderBy: { sequence: 'ASC' },
  })

  if (memberships.length === 0) {
    return NextResponse.json({ items: [] })
  }

  const checkIds = Array.from(new Set(memberships.map((membership: DataQualitySuiteCheck) => membership.checkId)))
  const checkWhere: Record<string, unknown> = {
    id: { $in: checkIds },
    tenantId,
    deletedAt: null,
  }
  if (context.selectedOrganizationId) {
    checkWhere.organizationId = context.selectedOrganizationId
  } else if (context.organizationIds) {
    checkWhere.organizationId = { $in: context.organizationIds }
  }

  const checks = await em.find(DataQualityCheck, checkWhere as never)
  const checkMap = new Map<string, DataQualityCheck>(checks.map((check: DataQualityCheck) => [check.id, check]))

  return NextResponse.json({
    items: memberships
      .filter((membership: DataQualitySuiteCheck) => checkMap.has(membership.checkId))
      .map((membership: DataQualitySuiteCheck) => {
        const check = checkMap.get(membership.checkId)
        return {
          id: membership.id,
          checkId: membership.checkId,
          code: check?.code ?? '',
          name: check?.name ?? '',
          severity: check?.severity ?? 'info',
          enabled: membership.enabled,
          sequence: membership.sequence,
        }
      }),
  })
}

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
    const parsed = assignSuiteChecksSchema.parse(body)
    const payload = { suiteId: parsedParams.id, ...parsed }
    const guardUserId = context.auth.userId ?? context.auth.sub
    if (!guardUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const guardResult = await validateCrudMutationGuard(context.container, {
      tenantId,
      organizationId: context.selectedOrganizationId,
      userId: guardUserId,
      resourceKind: 'data_quality.suite',
      resourceId: parsedParams.id,
      operation: 'custom',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: payload,
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }

    const commandBus = context.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<
      AssignSuiteChecksInput & { suiteId: string },
      { suiteId: string; count: number }
    >('data_quality.suite_check.assign', {
      input: payload,
      ctx: context.commandContext,
    })

    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(context.container, {
      tenantId,
        organizationId: context.selectedOrganizationId,
        userId: guardUserId,
        resourceKind: 'data_quality.suite',
        resourceId: parsedParams.id,
        operation: 'custom',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }

    return NextResponse.json({ ok: true, suiteId: parsedParams.id, count: result.count })
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
    console.error('data_quality.suite_check.assign failed', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Data Quality',
  summary: 'Manage checks assigned to a data quality suite',
  pathParams: paramsSchema,
  methods: {
    GET: {
      summary: 'List checks assigned to a suite',
      responses: [{ status: 200, description: 'Assigned checks', schema: z.object({ items: z.array(suiteCheckListItemSchema) }) }],
    },
    POST: {
      summary: 'Assign checks to a suite',
      requestBody: { contentType: 'application/json', schema: assignSuiteChecksSchema },
      responses: [{ status: 200, description: 'Assigned checks', schema: assignResultSchema }],
    },
  },
}
