import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { GlJournalEntry, GlJournalLine } from '../../../data/entities'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['financial.read'] },
}

/**
 * The lines of one journal entry, for the edit screen.
 *
 * `gl_journal_lines` carries no tenant or organization column — it is scoped through its entry — so
 * this is a plain handler rather than a `makeCrudRoute` list: the entry is resolved in scope first,
 * and only then are its lines read. An entry in another organization reads as not found.
 *
 * `metadata.path` is the URL, so it matches the route directory (`/financial/journal-entries/lines`).
 */
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
    const entryId = params.get('id')
    if (!entryId) {
      throw new CrudHttpError(400, { error: translate('financial.errors.entry_number_required', 'An entry number is required.') })
    }

    const em = (container.resolve('em') as EntityManager).fork()
    const entry = await em.findOne(GlJournalEntry, {
      id: entryId,
      tenantId: auth.tenantId,
      organizationId,
    })
    if (!entry) throw new CrudHttpError(404, { error: translate('financial.errors.entry_not_found', 'Journal entry not found.') })

    const lines = await em.find(
      GlJournalLine,
      { entry: entryId },
      { orderBy: { lineNumber: 'asc' }, populate: ['account'] },
    )

    const items = lines.map((line) => ({
      id: line.id,
      line_number: line.lineNumber,
      account_id: line.account.id,
      account_code: line.account.code,
      account_name: line.account.name,
      description: line.description ?? null,
      debit_amount: line.debitAmount,
      credit_amount: line.creditAmount,
      tax_code: line.taxCode ?? null,
    }))

    return NextResponse.json({
      items,
      total: items.length,
      page: 1,
      pageSize: items.length,
      totalPages: 1,
    })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    const { translate } = await resolveTranslations()
    return NextResponse.json(
      { error: translate('financial.errors.action_failed', 'Unable to load the entry lines') },
      { status: 400 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Financial',
  summary: 'Journal entry lines',
  methods: {
    GET: {
      summary: 'Read the postings of one journal entry',
      description: 'Returns the lines of one entry, in line order, scoped to the caller organization.',
      responses: [
        {
          status: 200,
          description: 'Entry lines',
          schema: z.object({
            items: z.array(z.object({
              id: z.string().uuid(),
              line_number: z.number(),
              account_id: z.string().uuid(),
              account_code: z.string(),
              account_name: z.string(),
              description: z.string().nullable(),
              debit_amount: z.string(),
              credit_amount: z.string(),
              tax_code: z.string().nullable(),
            })),
            total: z.number(),
            page: z.number(),
            pageSize: z.number(),
            totalPages: z.number(),
          }),
        },
      ],
    },
  },
}
