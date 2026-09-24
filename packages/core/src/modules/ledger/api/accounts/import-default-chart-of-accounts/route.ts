/**
 * `POST /api/ledger/accounts/import-default-chart-of-accounts`.
 *
 * Bulk-importing the hardcoded Phase 1 template
 * (`ledger.importDefaultChartOfAccounts`) is not a field-level CRUD edit
 * on a single `LedgerAccount`/`LedgerAccountType` row, so — same as
 * `api/fiscal-periods/[id]/lock/route.ts` — this is a thin custom write
 * route rather than a `makeCrudRoute` action, wired through the shared
 * mutation-guard registry (`route-mutation-guard.ts`). Resolves the
 * spec's own "Open validation point for implementation" (API Contracts,
 * `2026-09-15-default-chart-of-accounts.md`): the existing
 * `backend/ledger/accounts/page.tsx` does not have client-side
 * `commandBus` access (it calls the `/api/ledger/accounts` REST routes,
 * same as every other backend page in this module) and no generic
 * "run this command" endpoint exists elsewhere in the codebase, so one
 * new thin route is needed, following the `fiscal-periods` lock route's
 * precedent exactly.
 *
 * Gated by `ledger.accounts.manage` — the same feature the accounts
 * CRUD route's own POST/PUT/DELETE already require; there is no
 * separate "import" grant in this module's `acl.ts`. The command itself
 * enforces the empty-chart-of-accounts precondition, so this route's
 * only job is auth, scope, the mutation guard, and turning the
 * command's refusal into a response body.
 */

import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { z } from 'zod'
import type {
  ImportDefaultChartOfAccountsInput,
  ImportDefaultChartOfAccountsResult,
} from '../../../commands/importDefaultChartOfAccounts'

const logger = createLogger('ledger').child({ component: 'api/accounts/import-default-chart-of-accounts' })

const IMPORT_FEATURE = 'ledger.accounts.manage'
// Matches the command's own `buildLog().resourceKind` (see
// `commands/importDefaultChartOfAccounts.ts`) rather than the regular
// per-entity `ledger.ledger_account` / `ledger.ledger_account_type`
// resource kinds — this action creates rows of both entity types in one
// call, so it is guarded as its own distinct resource kind rather than
// being folded into either entity's own guard set.
const RESOURCE_KIND = 'ledger.chart_of_accounts_import'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: [IMPORT_FEATURE] },
}

export async function POST(req: Request) {
  const { translate } = await resolveTranslations()
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    if (!auth || !auth.sub || !auth.tenantId) {
      return NextResponse.json({ error: translate('ledger.errors.unauthorized', 'Unauthorized') }, { status: 401 })
    }

    const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const organizationId = organizationScope?.selectedId ?? auth.orgId ?? null
    if (!organizationId) {
      return NextResponse.json(
        { error: translate('ledger.errors.organizationRequired', 'Organization context is required') },
        { status: 400 },
      )
    }
    const tenantId = auth.tenantId

    const guardResult = await runRouteMutationGuards({
      container,
      req,
      auth: { userId: auth.sub, tenantId, organizationId },
      input: {
        resourceKind: RESOURCE_KIND,
        resourceId: null,
        operation: 'create',
        mutationPayload: { organizationId, tenantId },
      },
    })
    if (!guardResult.ok) return guardResult.response

    const ctx: CommandRuntimeContext = {
      container,
      auth,
      organizationScope,
      selectedOrganizationId: organizationId,
      organizationIds: organizationScope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
      request: req,
    }

    const commandBus = container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<ImportDefaultChartOfAccountsInput, ImportDefaultChartOfAccountsResult>(
      'ledger.importDefaultChartOfAccounts',
      { input: { organizationId, tenantId }, ctx },
    )

    await guardResult.runAfterSuccess()

    return NextResponse.json({
      ok: true,
      createdAccountTypeCount: result.createdAccountTypeIds.length,
      createdAccountCount: result.createdAccountIds.length,
    })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const interceptorRejection = getCommandInterceptorHttpRejection(err)
    if (interceptorRejection) {
      return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
    }
    logger.error('ledger.accounts.import_default_chart_of_accounts failed', { err })
    return NextResponse.json({ error: translate('ledger.errors.internal', 'Internal server error') }, { status: 500 })
  }
}

const importResponseSchema = z.object({
  ok: z.literal(true),
  createdAccountTypeCount: z.number().int().min(0),
  createdAccountCount: z.number().int().min(0),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Ledger',
  summary: 'Import the default Polish chart-of-accounts template',
  methods: {
    POST: {
      summary: 'Import the default Polish chart-of-accounts template',
      description:
        'Bulk-creates the hardcoded Phase 1 "wzorcowy plan kont" template (39 account types, 43 accounts) as ordinary, editable LedgerAccountType/LedgerAccount rows in one transaction. Refuses to run against a non-empty chart of accounts. Requires ledger.accounts.manage. See 2026-09-15-default-chart-of-accounts.md.',
      responses: [{ status: 200, description: 'Template imported', schema: importResponseSchema }],
      errors: [
        { status: 400, description: 'Missing organization context' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Missing ledger.accounts.manage' },
        { status: 409, description: 'Chart of accounts already has account types and/or accounts, or the required Polish account groups are not seeded for this organization' },
      ],
    },
  },
}
