import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { GlBankStatement, GlBankStatementLine } from '../../../data/entities'

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
    if (!organizationId) throw new CrudHttpError(400, { error: translate('errors.organization_required', 'Organization context is required') })
    const statementId = new URL(req.url).searchParams.get('id')
    if (!statementId) throw new CrudHttpError(400, { error: translate('financial.errors.record_id_required', 'Record id is required.') })
    const em = (container.resolve('em') as EntityManager).fork()
    const statement = await em.findOne(GlBankStatement, { id: statementId, tenantId: auth.tenantId, organizationId })
    if (!statement) throw new CrudHttpError(404, { error: translate('financial.errors.record_not_found', 'Record not found.') })
    const lines = await em.find(GlBankStatementLine, { statementId }, { orderBy: { lineNumber: 'asc' } })
    const items = lines.map((line) => ({
      id: line.id,
      line_number: line.lineNumber,
      transaction_date: line.transactionDate.toISOString().slice(0, 10),
      description: line.description ?? null,
      reference: line.reference ?? null,
      direction: line.direction,
      amount: line.amount,
      status: line.status,
      matched_entry_line_id: line.matchedEntryLineId ?? null,
      matched_at: line.matchedAt?.toISOString() ?? null,
    }))
    return NextResponse.json({ items, total: items.length, page: 1, pageSize: items.length, totalPages: 1 })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    const { translate } = await resolveTranslations()
    return NextResponse.json({ error: translate('financial.errors.action_failed', 'Unable to load the statement lines') }, { status: 400 })
  }
}

export const openApi = {
  tag: 'Financial',
  summary: 'Bank statement lines',
  methods: {
    GET: {
      summary: 'The lines of one imported statement',
      responses: [{
        status: 200,
        description: 'Lines',
        schema: z.object({
          items: z.array(z.object({
            id: z.string().uuid(),
            line_number: z.number(),
            transaction_date: z.string(),
            description: z.string().nullable(),
            reference: z.string().nullable(),
            direction: z.enum(['in', 'out']),
            amount: z.string(),
            status: z.string(),
            matched_entry_line_id: z.string().uuid().nullable(),
            matched_at: z.string().nullable(),
          })),
          total: z.number(),
          page: z.number(),
          pageSize: z.number(),
          totalPages: z.number(),
        }),
      }],
    },
  },
}
