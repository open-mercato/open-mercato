import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandRuntimeContext, CommandBus } from '@open-mercato/shared/lib/commands'
import { pipelineStageReorderSchema, type PipelineStageReorderInput } from '../../../data/validators'
import { withScopedPayload } from '../../utils'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

const PIPELINE_STAGE_RESOURCE_KIND = 'customers.pipelineStage'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['customers.pipelines.manage'] },
}

export async function POST(req: Request) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()
    if (!auth) throw new CrudHttpError(401, { error: translate('customers.errors.unauthorized', 'Unauthorized') })
    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const ctx: CommandRuntimeContext = {
      container,
      auth,
      organizationScope: scope,
      selectedOrganizationId: scope?.selectedId ?? auth.orgId ?? null,
      organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
      request: req,
    }
    const organizationId = scope?.selectedId ?? auth.orgId ?? null
    const tenantId = auth.tenantId ?? null
    if (!organizationId || !tenantId) {
      return NextResponse.json({ error: translate('customers.errors.context_required', 'Organization and tenant context required') }, { status: 400 })
    }

    const body = await req.json().catch(() => ({}))
    const scoped = withScopedPayload(body, ctx, translate)
    const input = pipelineStageReorderSchema.parse(scoped)

    const guardResult = await validateCrudMutationGuard(ctx.container, {
      tenantId,
      organizationId,
      userId: auth.sub,
      resourceKind: PIPELINE_STAGE_RESOURCE_KIND,
      resourceId: organizationId,
      operation: 'custom',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: input,
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }

    const commandBus = (ctx.container.resolve('commandBus') as CommandBus)
    await commandBus.execute<PipelineStageReorderInput, void>(
      'customers.pipeline-stages.reorder',
      { input, ctx },
    )
    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(ctx.container, {
        tenantId,
        organizationId,
        userId: auth.sub,
        resourceKind: PIPELINE_STAGE_RESOURCE_KIND,
        resourceId: organizationId,
        operation: 'custom',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('customers.pipeline-stages.reorder failed', err)
    return NextResponse.json({ error: 'Failed to reorder pipeline stages' }, { status: 400 })
  }
}

const reorderOkResponseSchema = z.object({ ok: z.boolean() })
const reorderErrorSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Reorder pipeline stages',
  methods: {
    POST: {
      summary: 'Reorder pipeline stages',
      description: 'Updates the order of pipeline stages in bulk.',
      requestBody: { contentType: 'application/json', schema: pipelineStageReorderSchema },
      responses: [
        { status: 200, description: 'Stages reordered', schema: reorderOkResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Validation failed', schema: reorderErrorSchema },
        { status: 401, description: 'Unauthorized', schema: reorderErrorSchema },
      ],
    },
  },
}
