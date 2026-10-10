import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { GlJournalLine } from '../../data/entities'
import { buildTrialBalance, isTrialBalanceBalanced } from '../../lib/glService'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['financial.read'] },
}

export async function GET(req: Request) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()
    if (!auth?.tenantId) throw new CrudHttpError(401, { error: translate('errors.unauthorized', 'Unauthorized') })
    const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const organizationId = organizationScope?.selectedId ?? auth.orgId ?? null
    if (!organizationId) {
      throw new CrudHttpError(400, {
        error: translate('errors.organization_required', 'Organization context is required'),
      })
    }
    const params = new URL(req.url).searchParams
    const periodId = params.get('periodId')
    const from = params.get('from')
    const to = params.get('to')
    if (!periodId && !(from && to)) {
      throw new CrudHttpError(400, { error: translate('financial.errors.invalid_period', 'The accounting period does not exist.') })
    }
    const em = (container.resolve('em') as EntityManager).fork()
    const lines = await em.find(
      GlJournalLine,
      {
        entry: {
          status: 'posted',
          tenantId: auth.tenantId,
          organizationId,
          ...(periodId ? { period: periodId } : {}),
          ...(from && to ? { postingDate: { $gte: new Date(from), $lte: new Date(to) } } : {}),
        },
      },
      { populate: ['account'] },
    )
    const rows = lines.map((line) => ({
      accountId: line.account.id,
      debitAmount: line.debitAmount,
      creditAmount: line.creditAmount,
    }))
    const balance = buildTrialBalance(rows)
    return NextResponse.json({ lines: balance, balanced: isTrialBalanceBalanced(balance) })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    const { translate } = await resolveTranslations()
    return NextResponse.json(
      { error: translate('financial.errors.action_failed', 'Unable to build the trial balance') },
      { status: 400 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Financial',
  summary: 'Trial balance',
  methods: {
    GET: {
      summary: 'Per-account debit and credit totals for posted entries',
      description:
        'Sums only posted entries, either for one accounting period (`periodId`) or for a posting-date range (`from` and `to`, inclusive). Returns each account total plus whether the set nets to zero.',
      responses: [
        {
          status: 200,
          description: 'Trial balance',
          schema: z.object({
            lines: z.array(z.object({ accountId: z.string().uuid(), debit: z.string(), credit: z.string() })),
            balanced: z.boolean(),
          }),
        },
      ],
    },
  },
}
