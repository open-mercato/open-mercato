import { z } from 'zod'
import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand, type CommandHandler, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { GlAccount, GlJournalEntry, GlJournalLine, GlPeriod } from '../data/entities'
import {
  assertJournalEntryRules,
  buildReversalLines,
  evaluatePeriodPosting,
  type JournalLineDraft,
} from '../lib/glService'
import { raiseFinancialError } from '../lib/errors'
import { isZeroDecimal, roundDecimalHalfUp, subtractDecimalStrings } from '../lib/money'
import {
  buildInvoicePostingLines,
  buildPaymentPostingLines,
  PostingConfigurationError,
  postingLinesMatch,
  resolvePostingAccounts,
  type PostingAccount,
  type PostingLineDraft,
  type PostingSettings,
} from '../lib/postingMap'
import { readFinancialJurisdiction } from '../lib/jurisdiction'
import { resolveFinancialCountryPlugin } from '../lib/registries'
import { emitFinancialEvent } from '../events'
import { financialEntryEvents, financialEntryIndexer } from './ledger'

/**
 * Automatic posting of sales documents into the general ledger.
 *
 * The command is invoked by the financial module's own subscribers on the sales
 * document events, never by an HTTP route: a route would create a second way to
 * post an invoice and the two would eventually disagree. It takes the tenant and
 * organization in the input because an event subscriber has no authenticated
 * session, and it resolves everything else from the source row.
 *
 * Idempotency is a database invariant, not an `if` in this file: a partial unique
 * index on `(organization, tenant, source entity, source kind)` excludes reversed
 * entries, so a retried event is a no-op and a corrected document reverses its
 * previous entry before posting the new one.
 */

const POSTING_SETTINGS_MODULE = 'financial'
const POSTING_SETTINGS_KEY = 'posting'

export const salesDocumentPostingSchema = z.object({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  sourceEntityType: z.enum(['sales_invoice', 'sales_payment']),
  sourceEntityId: z.string().uuid(),
  operation: z.enum(['upsert', 'reverse']).default('upsert'),
  actorUserId: z.string().uuid().optional().nullable(),
})

export type SalesDocumentPostingInput = z.infer<typeof salesDocumentPostingSchema>

export type SalesDocumentPostingResult = {
  action: 'posted' | 'reversed' | 'unchanged'
  entryId: string | null
  reversalId: string | null
}

type PostingScope = { tenantId: string; organizationId: string }

type InvoiceRow = {
  invoice_number: string | null
  currency_code: string
  issue_date: Date | string | null
  created_at: Date | string | null
  tax_total_amount: string | null
  grand_total_gross_amount: string | null
}

type PaymentRow = {
  amount: string | null
  captured_amount: string | null
  refunded_amount: string | null
  currency_code: string
  received_at: Date | string | null
  created_at: Date | string | null
  method_code: string | null
  method_name: string | null
  method_kind: string | null
}

export type PostingSource = {
  kind: string
  currencyCode: string
  postingDate: Date
  description: string
  lines: JournalLineDraft[]
}

type TaxContext = {
  standardTaxCode: string | null
  untaxedTaxCode: string | null
  standardTaxAccountCode: string | null
}

function toDate(value: Date | string | null | undefined, fallback: Date): Date {
  if (value instanceof Date) return value
  if (typeof value === 'string' && value.length > 0) {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  return fallback
}

function decimal(value: string | null | undefined): string {
  return roundDecimalHalfUp(String(value ?? '0'), 2)
}

async function resolveTaxContext(
  configService: ModuleConfigService | null,
  scope: PostingScope,
): Promise<TaxContext> {
  let countryCode: string | null = null
  if (configService) {
    try {
      countryCode = await readFinancialJurisdiction(configService, scope)
    } catch {
      countryCode = null
    }
  }
  const plugin = resolveFinancialCountryPlugin(countryCode)
  const rates = plugin.tax.listRates()
  const standard = rates.find((rate) => rate.category === 'S' && rate.rate > 0) ?? null
  const untaxed = rates.find((rate) => rate.category === 'O')
    ?? rates.find((rate) => rate.category === 'Z')
    ?? null
  return {
    standardTaxCode: standard?.code ?? null,
    untaxedTaxCode: untaxed?.code ?? null,
    standardTaxAccountCode: standard?.salesAccountCode ?? null,
  }
}

async function loadPostingAccounts(
  em: EntityManager,
  scope: PostingScope,
  settings: PostingSettings,
  standardTaxAccountCode: string | null,
): Promise<ReturnType<typeof resolvePostingAccounts>> {
  const rows = await em.find(GlAccount, { ...scope, deletedAt: null })
  const accounts: PostingAccount[] = rows.map((account) => ({
    id: account.id,
    code: account.code,
    accountClass: account.accountClass,
    accountType: account.accountType ?? null,
  }))
  return resolvePostingAccounts(settings, accounts, standardTaxAccountCode)
}

async function readInvoice(
  em: EntityManager,
  scope: PostingScope,
  invoiceId: string,
): Promise<InvoiceRow | null> {
  const rows = await em.getConnection().execute<InvoiceRow[]>(
    `select invoice_number, currency_code, issue_date, created_at, tax_total_amount, grand_total_gross_amount
     from sales_invoices
     where id = ? and tenant_id = ? and organization_id = ? and deleted_at is null
     limit 1`,
    [invoiceId, scope.tenantId, scope.organizationId],
  )
  return rows[0] ?? null
}

async function readPayment(
  em: EntityManager,
  scope: PostingScope,
  paymentId: string,
): Promise<PaymentRow | null> {
  const rows = await em.getConnection().execute<PaymentRow[]>(
    `select p.amount, p.captured_amount, p.refunded_amount, p.currency_code, p.received_at, p.created_at,
            m.code as method_code, m.name as method_name, m.kind as method_kind
     from sales_payments p
     left join sales_payment_methods m on m.id = p.payment_method_id
     where p.id = ? and p.tenant_id = ? and p.organization_id = ? and p.deleted_at is null
     limit 1`,
    [paymentId, scope.tenantId, scope.organizationId],
  )
  return rows[0] ?? null
}

function isCashPayment(row: PaymentRow): boolean {
  const kind = (row.method_kind ?? '').toLowerCase()
  if (kind === 'cash') return true
  const label = `${row.method_code ?? ''} ${row.method_name ?? ''}`.toLowerCase()
  return label.includes('cash')
}

async function buildPostingSource(
  em: EntityManager,
  scope: PostingScope,
  input: SalesDocumentPostingInput,
  accounts: ReturnType<typeof resolvePostingAccounts>,
  tax: TaxContext,
  now: Date,
): Promise<PostingSource | null> {
  if (input.sourceEntityType === 'sales_invoice') {
    const invoice = await readInvoice(em, scope, input.sourceEntityId)
    if (!invoice) return raiseFinancialError(404, 'posting_source_not_found')
    const gross = decimal(invoice.grand_total_gross_amount)
    if (isZeroDecimal(gross)) return null
    const taxAmount = decimal(invoice.tax_total_amount)
    const taxCode = isZeroDecimal(taxAmount) ? tax.untaxedTaxCode : tax.standardTaxCode
    return {
      kind: 'invoice',
      currencyCode: invoice.currency_code,
      postingDate: toDate(invoice.issue_date ?? invoice.created_at, now),
      description: `Sales invoice ${invoice.invoice_number ?? input.sourceEntityId}`,
      lines: buildInvoicePostingLines({
        invoiceNumber: invoice.invoice_number ?? input.sourceEntityId,
        grossAmount: gross,
        taxAmount,
        taxCode,
      }, accounts),
    }
  }

  const payment = await readPayment(em, scope, input.sourceEntityId)
  if (!payment) return raiseFinancialError(404, 'posting_source_not_found')
  const gross = decimal(payment.captured_amount && !isZeroDecimal(payment.captured_amount)
    ? payment.captured_amount
    : payment.amount)
  const net = decimal(subtractDecimalStrings(gross, decimal(payment.refunded_amount), 6))
  if (isZeroDecimal(net)) return null
  return {
    kind: 'payment',
    currencyCode: payment.currency_code,
    postingDate: toDate(payment.received_at ?? payment.created_at, now),
    description: `Sales payment ${input.sourceEntityId}`,
    lines: buildPaymentPostingLines({
      paymentReference: input.sourceEntityId,
      amount: net,
      isCash: isCashPayment(payment),
    }, accounts),
  }
}

export function lineDraftsOf(entry: GlJournalEntry): JournalLineDraft[] {
  return entry.lines.getItems().map((line) => ({
    accountId: line.account.id,
    debitAmount: line.debitAmount,
    creditAmount: line.creditAmount,
    description: line.description ?? null,
    taxCode: line.taxCode ?? null,
  }))
}

export async function findPeriodForDate(
  em: EntityManager,
  scope: PostingScope,
  date: Date,
): Promise<GlPeriod | null> {
  return em.findOne(GlPeriod, { ...scope, startDate: { $lte: date }, endDate: { $gte: date } })
}

function persistPostedLines(
  em: EntityManager,
  entry: GlJournalEntry,
  lines: readonly JournalLineDraft[],
): void {
  lines.forEach((line, index) => {
    em.persist(
      em.create(GlJournalLine, {
        entry,
        lineNumber: index + 1,
        account: em.getReference(GlAccount, line.accountId),
        description: line.description ?? null,
        debitAmount: String(line.debitAmount),
        creditAmount: String(line.creditAmount),
        baseDebitAmount: String(line.debitAmount),
        baseCreditAmount: String(line.creditAmount),
        taxCode: line.taxCode ?? null,
      }),
    )
  })
}

export async function createPostedEntry(
  em: EntityManager,
  scope: PostingScope,
  source: PostingSource,
  sourceEntityType: string,
  sourceEntityId: string,
  actorUserId: string | null,
  now: Date,
): Promise<GlJournalEntry> {
  const period = await findPeriodForDate(em, scope, source.postingDate)
  if (!period) return raiseFinancialError(409, 'posting_period_missing')
  const gate = evaluatePeriodPosting(period.status, false)
  if (!gate.allowed) return raiseFinancialError(409, gate.code)
  assertJournalEntryRules(source.lines)

  const entry = em.create(GlJournalEntry, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    entryNumber: `AUTO-${source.kind.toUpperCase()}-${sourceEntityId.slice(0, 8)}-${now.getTime().toString(36)}`,
    entryDate: source.postingDate,
    postingDate: source.postingDate,
    period,
    entryType: 'standard',
    description: source.description,
    reference: sourceEntityId,
    sourceEntityType,
    sourceEntityId,
    sourceKind: source.kind,
    currencyCode: source.currencyCode,
    exchangeRate: '1',
    status: 'posted',
    postedAt: now,
    postedBy: actorUserId,
    createdBy: actorUserId,
    updatedBy: actorUserId,
  })
  persistPostedLines(em, entry, source.lines)
  await em.flush()
  return entry
}

export async function reversePostedEntry(
  em: EntityManager,
  scope: PostingScope,
  original: GlJournalEntry,
  actorUserId: string | null,
  now: Date,
): Promise<GlJournalEntry | null> {
  if (original.status !== 'posted') return null
  const period = await findPeriodForDate(em, scope, now)
  if (!period) return raiseFinancialError(409, 'posting_period_missing')
  const gate = evaluatePeriodPosting(period.status, false)
  if (!gate.allowed) return raiseFinancialError(409, gate.code)

  const drafts = buildReversalLines(lineDraftsOf(original))
  assertJournalEntryRules(drafts)
  const reversal = em.create(GlJournalEntry, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    entryNumber: `${original.entryNumber}-R`,
    entryDate: now,
    postingDate: now,
    period,
    entryType: 'reversing',
    description: `Reversal of ${original.entryNumber}`,
    reference: original.reference ?? null,
    sourceEntityType: original.sourceEntityType ?? null,
    sourceEntityId: original.sourceEntityId ?? null,
    sourceKind: original.sourceKind ? `${original.sourceKind}:reversal` : null,
    currencyCode: original.currencyCode,
    exchangeRate: original.exchangeRate,
    status: 'posted',
    reversesEntry: original,
    postedAt: now,
    postedBy: actorUserId,
    createdBy: actorUserId,
    updatedBy: actorUserId,
  })
  persistPostedLines(em, reversal, drafts)
  original.status = 'reversed'
  original.reversedByEntry = reversal
  original.updatedAt = now
  original.updatedBy = actorUserId
  await em.flush()
  return reversal
}

export async function emitEntrySideEffects(
  ctx: CommandRuntimeContext,
  scope: PostingScope,
  actorUserId: string | null,
  action: 'posted' | 'reversed',
  entry: GlJournalEntry,
  original?: GlJournalEntry | null,
): Promise<void> {
  const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
  if (original) {
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: original,
      identifiers: { id: original.id, ...scope },
      actorUserId,
      events: financialEntryEvents,
      indexer: financialEntryIndexer,
    })
  }
  await emitCrudSideEffects({
    dataEngine,
    action: 'created',
    entity: entry,
    identifiers: { id: entry.id, ...scope },
    actorUserId,
    events: financialEntryEvents,
    indexer: financialEntryIndexer,
  })
  if (action === 'posted') {
    await emitFinancialEvent('financial.journal_entry.posted', {
      id: entry.id,
      entryNumber: entry.entryNumber,
      periodId: entry.period.id,
      postingDate: entry.postingDate.toISOString().slice(0, 10),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    return
  }
  await emitFinancialEvent('financial.journal_entry.reversed', {
    id: entry.id,
    reversedEntryId: original?.id ?? '',
    entryNumber: entry.entryNumber,
    periodId: entry.period.id,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
}

const postSalesDocumentCommand: CommandHandler<SalesDocumentPostingInput, SalesDocumentPostingResult> = {
  id: 'financial.sales_document.post',
  async execute(raw, ctx) {
    const input = salesDocumentPostingSchema.parse(raw)
    const scope: PostingScope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const actorUserId = input.actorUserId ?? null
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const configService = (() => {
      try {
        return ctx.container.resolve('moduleConfigService') as ModuleConfigService
      } catch {
        return null
      }
    })()

    const tax = await resolveTaxContext(configService, scope)
    const settings = configService
      ? ((await configService.getValue<PostingSettings>(POSTING_SETTINGS_MODULE, POSTING_SETTINGS_KEY, {
        defaultValue: {},
        scope: { tenantId: scope.tenantId },
      })) ?? {})
      : {}

    let accounts: ReturnType<typeof resolvePostingAccounts>
    try {
      accounts = await loadPostingAccounts(em, scope, settings, tax.standardTaxAccountCode)
    } catch (error) {
      if (error instanceof PostingConfigurationError) {
        return raiseFinancialError(409, 'posting_accounts_missing')
      }
      throw error
    }

    const result = await em.transactional(async (trx) => {
      const now = new Date()
      // A reverse arrives after the source row was soft-deleted, so reading it
      // would fail with `posting_source_not_found`. The reversal only needs the
      // existing entry; the source's kind is known from the entity type.
      const source = input.operation === 'reverse'
        ? null
        : await buildPostingSource(trx, scope, input, accounts, tax, now)
      const existing = await trx.findOne(GlJournalEntry, {
        ...scope,
        sourceEntityType: input.sourceEntityType,
        sourceEntityId: input.sourceEntityId,
        sourceKind: source?.kind ?? (input.sourceEntityType === 'sales_invoice' ? 'invoice' : 'payment'),
        status: { $ne: 'reversed' },
      }, { populate: ['lines'], lockMode: LockMode.PESSIMISTIC_WRITE })

      if (input.operation === 'reverse' || !source) {
        if (!existing) return { action: 'unchanged' as const, entry: null, original: null }
        const reversal = await reversePostedEntry(trx, scope, existing, actorUserId, now)
        return { action: 'reversed' as const, entry: reversal, original: existing }
      }

      if (existing && postingLinesMatch(lineDraftsOf(existing), source.lines)) {
        return { action: 'unchanged' as const, entry: existing, original: null }
      }

      const original = existing
        ? await reversePostedEntry(trx, scope, existing, actorUserId, now)
        : null
      const entry = await createPostedEntry(
        trx,
        scope,
        source,
        input.sourceEntityType,
        input.sourceEntityId,
        actorUserId,
        now,
      )
      return { action: 'posted' as const, entry, original: original ? existing : null }
    })

    if (result.action !== 'unchanged' && result.entry) {
      await emitEntrySideEffects(
        ctx,
        scope,
        actorUserId,
        result.action,
        result.entry,
        result.original,
      )
    }

    return {
      action: result.action,
      entryId: result.entry?.id ?? null,
      reversalId: result.action === 'reversed' ? result.entry?.id ?? null : null,
    }
  },
}

registerCommand(postSalesDocumentCommand)
