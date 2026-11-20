import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { reconciliationResolutionSchema } from '../../../../data/validators'
import { resolvePaymentGatewayTranslator } from '../../../../lib/order-amount-reconciliation'
import { resolveUserFeatures, runPaymentGatewayMutationGuards, runPaymentGatewayMutationGuardAfterSuccess } from '../../../guards'
import { paymentGatewaysTag } from '../../../openapi'

export const metadata = { POST: { requireAuth: true, requireFeatures: ['payment_gateways.refund'] } }

export async function POST(request: Request, context: { auth: AuthContext; params: { id: string } | Promise<{ id: string }> }) {
  const translate = await resolvePaymentGatewayTranslator()
  const auth = context.auth
  if (!auth?.tenantId || !auth.orgId || !auth.sub) return NextResponse.json({ error: translate('payment_gateways.reconciliation.errors.unauthorized') }, { status: 401 })
  const params = z.object({ id: z.string().uuid() }).safeParse(await context.params)
  const parsed = reconciliationResolutionSchema.safeParse(await readJsonSafe(request))
  if (!params.success || !parsed.success) return NextResponse.json({ error: translate('payment_gateways.reconciliation.errors.invalidPayload') }, { status: 422 })
  const container = await createRequestContainer()
  const mutation = {
    tenantId: auth.tenantId, organizationId: auth.orgId, userId: auth.sub,
    resourceKind: 'payment_gateways.payment_operation', resourceId: params.data.id,
    operation: 'update' as const, requestMethod: request.method, requestHeaders: request.headers,
  }
  const guard = await runPaymentGatewayMutationGuards(container, { ...mutation, mutationPayload: parsed.data }, resolveUserFeatures(auth))
  if (!guard.ok) return NextResponse.json(guard.errorBody, { status: guard.errorStatus ?? 422 })
  const evidence = reconciliationResolutionSchema.safeParse(guard.modifiedPayload ?? parsed.data)
  if (!evidence.success) return NextResponse.json({ error: translate('payment_gateways.reconciliation.errors.invalidPayload') }, { status: 422 })
  try {
    const { result } = await container.resolve<CommandBus>('commandBus').execute('payment_gateways.reconciliation.resolve', {
      input: { id: params.data.id, evidence: evidence.data },
      ctx: { container, auth, selectedOrganizationId: auth.orgId, organizationIds: [auth.orgId], organizationScope: null, request },
    })
    await runPaymentGatewayMutationGuardAfterSuccess(guard.afterSuccessCallbacks, mutation)
    return NextResponse.json(result)
  } catch (error) {
    if (isCrudHttpError(error)) return NextResponse.json(error.body, { status: error.status })
    throw error
  }
}

export const openApi = {
  tags: [paymentGatewaysTag], summary: 'Record confirmed external refund evidence',
  methods: { POST: { summary: 'Resolve a capture reconciliation obligation without invoking the provider', requestBody: { schema: reconciliationResolutionSchema, contentType: 'application/json' }, responses: [
    { status: 200, description: 'Recorded resolution or identical replay' },
    { status: 404, description: 'No scoped obligation' }, { status: 409, description: 'Conflicting evidence or stale version' },
    { status: 422, description: 'Invalid or unconfirmed evidence' },
  ] } },
}
