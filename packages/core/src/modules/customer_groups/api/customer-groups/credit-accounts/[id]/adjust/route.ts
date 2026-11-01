import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CrudHttpError, isCrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { customerCreditAdjustRequestSchema } from '../../../../../data/validators'
import { organizationIdsFromScope } from '../../../../../lib/customerScope'
import type { CreditEntryView } from '../../../../../services/customerCreditService'

const logger = createLogger('customer_groups')

// Release 5 Phase 3 (Step 1.12, D-R5-2/G7/G20, §6.5/§9). The operator-facing half of
// hybrid settlement: payments are "settled manually through `/adjust` or by an
// integration calling `settleCredit`" — without this route, a tenant with no payments
// integration can never lower exposure after a reservation, since `sales.order.cancelled`
// (Step 1.8) only RELEASES unsettled reservations on cancellation. The route is a thin
// HTTP adapter: it resolves the account id against the caller's organization scope,
// validates the body, and dispatches `commands/adjustCredit.ts`'s
// `customer_groups.credit.adjust` command through the command bus — the command owns the
// row-lock write, the audit entry and the undo (G20), this file owns none of that logic.
export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['customer_groups.credit.adjust'] },
}

const CREDIT_ACCOUNT_RESOURCE_KIND = 'customer_groups.credit_account'

const paramsSchema = z.object({ id: z.string().uuid() })

type RouteContext = { params: Promise<{ id: string }> | { id: string } }

type AdjustCommandInput = { creditAccountId: string; amount: string; note: string }
type AdjustCommandResult = { entry: CreditEntryView }

export async function POST(req: Request, context: RouteContext) {
  const { translate } = await resolveTranslations()
  const accountNotFound = () =>
    notFound(translate('customer_groups.errors.creditAccountNotFound', 'Credit account not found.'))
  try {
    const params = paramsSchema.safeParse(await context.params)
    if (!params.success) throw accountNotFound()

    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    if (!auth) throw new CrudHttpError(401, { error: translate('customer_groups.errors.unauthorized', 'Unauthorized') })
    const tenantId = auth.tenantId ?? null
    if (!tenantId) {
      throw new CrudHttpError(400, { error: translate('customer_groups.errors.tenant_required', 'Tenant context is required') })
    }

    // Same organization-scope resolution as the sibling `[id]/ledger` route: an account
    // outside the caller's scope is refused with the unknown-id body, never a 403 that
    // would confirm the id exists in another organization.
    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req }).catch(() => null)
    const organizationIds = organizationIdsFromScope(scope, scope?.selectedId ?? auth.orgId ?? null)
    if (Array.isArray(organizationIds) && organizationIds.length === 0) throw accountNotFound()

    const rawBody = (await readJsonSafe<Record<string, unknown>>(req, {})) ?? {}
    const parsedBody = customerCreditAdjustRequestSchema.safeParse(rawBody)
    if (!parsedBody.success) {
      const noteIssue = parsedBody.error.issues.some((issue) => issue.path.includes('note'))
      throw new CrudHttpError(400, {
        error: noteIssue
          ? translate('customer_groups.errors.creditAdjustNoteRequired', 'A note is required for every credit adjustment.')
          : translate(
            'customer_groups.errors.creditAdjustAmountInvalid',
            'Enter a signed amount with up to 2 decimal places (not zero).',
          ),
      })
    }

    const ctx: CommandRuntimeContext = {
      container,
      auth,
      organizationScope: scope,
      selectedOrganizationId: scope?.selectedId ?? auth.orgId ?? null,
      organizationIds,
      request: req,
    }

    const guarded = await runRouteMutationGuards({
      container,
      req,
      auth: { userId: auth.sub, tenantId, organizationId: ctx.selectedOrganizationId },
      input: {
        resourceKind: CREDIT_ACCOUNT_RESOURCE_KIND,
        resourceId: params.data.id,
        operation: 'update',
        mutationPayload: parsedBody.data,
      },
    })
    if (!guarded.ok) return guarded.response

    const commandBus = container.resolve('commandBus') as CommandBus
    const { result, logEntry } = await commandBus.execute<AdjustCommandInput, AdjustCommandResult>(
      'customer_groups.credit.adjust',
      { input: { creditAccountId: params.data.id, amount: parsedBody.data.amount, note: parsedBody.data.note }, ctx },
    )

    await guarded.runAfterSuccess()

    const response = NextResponse.json({ entry: result.entry })
    // Carries the undo token the same way every other command-backed route in this
    // codebase does (`x-om-operation`, G20) — without it, the command's `undo` handler
    // would be implemented but unreachable from the audit UI's "Undo" action.
    if (logEntry?.undoToken && logEntry?.id && logEntry?.commandId) {
      response.headers.set(
        'x-om-operation',
        serializeOperationMetadata({
          id: logEntry.id,
          undoToken: logEntry.undoToken,
          commandId: logEntry.commandId,
          actionLabel: logEntry.actionLabel ?? null,
          resourceKind: logEntry.resourceKind ?? CREDIT_ACCOUNT_RESOURCE_KIND,
          resourceId: logEntry.resourceId ?? result.entry.creditAccountId,
          executedAt: logEntry.createdAt instanceof Date ? logEntry.createdAt.toISOString() : undefined,
        }),
      )
    }
    return response
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    const interceptorRejection = getCommandInterceptorHttpRejection(err)
    if (interceptorRejection) return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
    logger.error('customer_groups.credit.adjust failed', { err })
    getTelemetryRuntime()?.reportError(err, { module: 'customer_groups', code: 'customer_groups.credit_adjust_failed' })
    return NextResponse.json(
      { error: translate('customer_groups.errors.creditAdjustFailed', 'Failed to post the credit adjustment.') },
      { status: 500 },
    )
  }
}

const creditEntrySchema = z.object({
  entryId: z.string().uuid(),
  creditAccountId: z.string().uuid(),
  entryType: z.enum(['reserve', 'release', 'settle', 'adjust']),
  amount: z.string(),
  balanceAfter: z.string(),
  idempotencyKey: z.string(),
  relatedEntryId: z.string().uuid().nullable(),
  linkedOrderId: z.string().uuid().nullable(),
})

const adjustResponseSchema = z.object({ entry: creditEntrySchema })
const adjustErrorSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'CustomerGroups',
  summary: 'Post a manual credit adjustment',
  methods: {
    POST: {
      summary: 'Post a manual credit ledger adjustment',
      description:
        'Appends a signed, non-zero `adjust` entry to the account ledger under the account row lock (§6.3) — the operator-facing half of hybrid settlement (D-R5-2): used to settle a payment manually, or to make any other correction. Runs as the `customer_groups.credit.adjust` command; undo appends the inverse entry and never deletes.',
      requestBody: { contentType: 'application/json', schema: customerCreditAdjustRequestSchema },
      responses: [{ status: 200, description: 'The appended ledger entry', schema: adjustResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid body, or tenant context is missing', schema: adjustErrorSchema },
        { status: 401, description: 'Unauthorized', schema: adjustErrorSchema },
        { status: 404, description: 'Credit account not found in the caller scope', schema: adjustErrorSchema },
        { status: 500, description: 'Unexpected failure', schema: adjustErrorSchema },
      ],
    },
  },
}
