import { z } from 'zod'
import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError, CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { withScopedPayload } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { invoiceSubscriptionSchema } from '../../../data/validators'
import { STUDENT_SUBSCRIPTION_ENTITY_ID } from '../../../commands/entities'
import { resolveStudentActionContext } from '../../../lib/apiAction'
import '../../../commands/invoice'

export const metadata = {
  path: '/student_transport/subscriptions/invoice',
  POST: { requireAuth: true, requireFeatures: ['student_transport.subscriptions.manage'] },
}

export async function POST(req: Request): Promise<Response> {
  try {
    const context = await resolveStudentActionContext(req)
    const raw = await readJsonSafe(req, {})
    const scoped = withScopedPayload((raw ?? {}) as Record<string, unknown>, context.ctx, context.translate)
    const input = invoiceSubscriptionSchema.parse(scoped)
    const userId = context.ctx.auth?.sub
    if (!userId) throw new CrudHttpError(401, { error: context.translate('errors.unauthorized', 'Unauthorized') })
    const guarded = await runRouteMutationGuards({
      container: context.ctx.container,
      req,
      auth: { userId, tenantId: context.tenantId, organizationId: context.organizationId },
      input: {
        resourceKind: STUDENT_SUBSCRIPTION_ENTITY_ID,
        resourceId: String(input.id),
        operation: 'update',
        mutationPayload: input,
      },
    })
    if (!guarded.ok) return guarded.response
    const commandBus = context.ctx.container.resolve('commandBus') as CommandBus
    const commandInput = guarded.modifiedPayload ? invoiceSubscriptionSchema.parse(guarded.modifiedPayload) : input
    const { result } = await commandBus.execute<Record<string, unknown>, {
      subscriptionId: string
      salesOrderId: string
      salesInvoiceId: string
      periodFrom: string
      periodTo: string
    }>('student_transport.subscriptions.invoice', { input: commandInput, ctx: context.ctx })
    await guarded.runAfterSuccess()
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    const interceptorRejection = getCommandInterceptorHttpRejection(err)
    if (interceptorRejection) return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
    const { translate } = await resolveTranslations()
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: translate('errors.invalid_input', 'Invalid input'), details: err.issues }, { status: 400 })
    }
    return NextResponse.json({ error: translate('student_transport.errors.action_failed', 'The action could not be completed.') }, { status: 400 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Student Transport',
  summary: 'Invoice a student subscription period',
  methods: {
    POST: {
      summary: 'Creates the sales order and invoice for one billing period; repeating the same period is idempotent',
      requestBody: { contentType: 'application/json', schema: invoiceSubscriptionSchema },
      responses: [{
        status: 200,
        description: 'Invoiced',
        schema: z.object({
          ok: z.boolean(),
          subscriptionId: z.string().uuid(),
          salesOrderId: z.string().uuid(),
          salesInvoiceId: z.string().uuid(),
          periodFrom: z.string(),
          periodTo: z.string(),
        }),
      }],
      errors: [
        { status: 409, description: 'Subscription not billable, period invalid or already invoiced' },
        { status: 500, description: 'Sales bridge failed' },
      ],
    },
  },
}
