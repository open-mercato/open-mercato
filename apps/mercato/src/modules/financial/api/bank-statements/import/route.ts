import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { GlBankStatement, GlBankStatementLine, GlCashAccount } from '../../../data/entities'
import { parseBankStatementCsv } from '../../../lib/bankReconciliation'

const logger = createLogger('financial')

export const metadata = {
  path: '/financial/bank-statements/import',
  POST: { requireAuth: true, requireFeatures: ['financial.payments.manage'] },
}

const fieldsSchema = z.object({
  cashAccountId: z.string().uuid(),
})

async function POST(req: Request) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()
    if (!auth?.tenantId) throw new CrudHttpError(401, { error: translate('errors.unauthorized', 'Unauthorized') })
    const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const organizationId = organizationScope?.selectedId ?? auth.orgId ?? null
    if (!organizationId) throw new CrudHttpError(400, { error: translate('errors.organization_required', 'Organization context is required') })
    const tenantId = auth.tenantId

    const form = await req.formData()
    const fields = fieldsSchema.parse({
      cashAccountId: String(form.get('cashAccountId') ?? ''),
    })
    const file = form.get('file')
    if (!(file instanceof File)) {
      throw new CrudHttpError(400, { error: translate('financial.errors.invalid_input', 'A CSV file is required.') })
    }
    const content = await file.text()
    const parsed = parseBankStatementCsv(content)
    if (parsed.lines.length === 0) {
      return NextResponse.json({ error: 'no_transactions', errors: parsed.errors }, { status: 400 })
    }

    const guarded = await runRouteMutationGuards({
      container,
      req,
      auth: { userId: auth.sub ?? 'system', tenantId: auth.tenantId, organizationId },
      input: {
        resourceKind: 'financial:bank_statement',
        resourceId: fields.cashAccountId,
        operation: 'create',
        mutationPayload: { cashAccountId: fields.cashAccountId, lineCount: parsed.lines.length },
      },
    })
    if (!guarded.ok) return guarded.response

    const em = (container.resolve('em') as EntityManager).fork()
    const cashAccount = await em.findOne(GlCashAccount, {
      id: fields.cashAccountId,
      tenantId: auth.tenantId,
      organizationId,
      deletedAt: null,
    })
    if (!cashAccount) throw new CrudHttpError(404, { error: translate('financial.errors.cash_account_not_found', 'The cash or bank account does not exist.') })

    const dates = parsed.lines.map((line) => line.transactionDate).sort()
    const now = new Date()
    const statement = em.create(GlBankStatement, {
      tenantId: auth.tenantId,
      organizationId,
      cashAccountId: cashAccount.id,
      fileName: file.name || null,
      periodStart: new Date(`${dates[0]}T00:00:00.000Z`),
      periodEnd: new Date(`${dates[dates.length - 1]}T00:00:00.000Z`),
      status: 'imported',
      importedBy: auth.sub ?? null,
      createdAt: now,
      updatedAt: now,
    })
    em.persist(statement)
    await em.flush()
    parsed.lines.forEach((line) => {
      em.persist(em.create(GlBankStatementLine, {
        tenantId,
        organizationId,
        statementId: statement.id,
        lineNumber: line.lineNumber,
        transactionDate: new Date(`${line.transactionDate}T00:00:00.000Z`),
        description: line.description,
        reference: line.reference,
        direction: line.direction,
        amount: line.amount,
        status: 'unmatched',
        createdAt: now,
        updatedAt: now,
      }))
    })
    await em.flush()
    await guarded.runAfterSuccess()
    return NextResponse.json({ id: statement.id, lineCount: parsed.lines.length, errors: parsed.errors })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    if (err instanceof z.ZodError) {
      const { translate } = await resolveTranslations()
      return NextResponse.json({ error: translate('errors.invalid_input', 'Invalid input'), details: err.issues }, { status: 400 })
    }
    logger.error('financial.bank_statements.import failed', { err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export { POST }
