import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { decideApprovalInputSchema } from '../../../commands/approvals'
import { HR_APPROVAL_REQUEST_ENTITY_ID } from '../../../commands/hr'
import '../../../commands/approvals'

const logger = createLogger('hr_management')

type ActionContext = {
  ctx: CommandRuntimeContext
  tenantId: string
  organizationId: string
  translate: (key: string, fallback?: string) => string
}

export const metadata = {
  path: '/hr/approvals/reject',
  POST: { requireAuth: true, requireFeatures: ['approvals.action'] },
}

async function resolveActionContext(req: Request): Promise<ActionContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth?.tenantId) throw new CrudHttpError(401, { error: translate('errors.unauthorized', 'Unauthorized') })
  const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = organizationScope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) throw new CrudHttpError(400, { error: translate('errors.organization_required', 'Organization context is required') })
  return {
    ctx: {
      container, auth, organizationScope, selectedOrganizationId: organizationId,
      organizationIds: organizationScope?.filterIds ?? (auth.orgId ? [auth.orgId] : null), request: req,
    },
    tenantId: auth.tenantId,
    organizationId,
    translate,
  }
}

type ApprovalActionResult = { approvalRequestId: string; status: string; currentStepOrder: number; decided: boolean }

export async function POST(req: Request) {
  try {
    const context = await resolveActionContext(req)
    const rawBody = await readJsonSafe(req)
    const input = decideApprovalInputSchema.parse(rawBody)
    const userId = context.ctx.auth?.sub
    if (!userId) throw new CrudHttpError(401, { error: context.translate('errors.unauthorized', 'Unauthorized') })

    const guarded = await runRouteMutationGuards({
      container: context.ctx.container,
      req,
      auth: { userId, tenantId: context.tenantId, organizationId: context.organizationId },
      input: {
        resourceKind: HR_APPROVAL_REQUEST_ENTITY_ID,
        resourceId: input.id,
        operation: 'update',
        mutationPayload: input,
      },
    })
    if (!guarded.ok) return guarded.response

    const commandInput = guarded.modifiedPayload ? decideApprovalInputSchema.parse(guarded.modifiedPayload) : input
    const commandBus = context.ctx.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<typeof commandInput, ApprovalActionResult>(
      'hr_management.approvals.reject',
      { input: commandInput, ctx: context.ctx },
    )
    await guarded.runAfterSuccess()
    return NextResponse.json({
      ok: true,
      approvalRequestId: result.approvalRequestId,
      status: result.status,
      currentStepOrder: result.currentStepOrder,
    }, { status: 200 })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    const interceptorRejection = getCommandInterceptorHttpRejection(err)
    if (interceptorRejection) return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
    const { translate } = await resolveTranslations()
    if (err instanceof z.ZodError) return NextResponse.json({ error: translate('errors.invalid_input', 'Invalid input') }, { status: 400 })
    logger.error('hr_management.approval_reject.failed', { err })
    return NextResponse.json({ error: translate('hr_management.errors.approval_action_failed', 'Unable to reject the approval request') }, { status: 400 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'HR Management',
  summary: 'Reject an approval request',
  methods: {
    POST: {
      summary: 'Rejects the request, which is terminal at any step',
      requestBody: { contentType: 'application/json', schema: decideApprovalInputSchema },
      responses: [{
        status: 200,
        description: 'Approval request created',
        schema: z.object({
          ok: z.boolean(),
          approvalRequestId: z.string().uuid(),
          status: z.string(),
          currentStepOrder: z.number(),
        }),
      }],
    },
  },
}
