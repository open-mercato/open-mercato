import { z } from 'zod'
import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand, type CommandHandler, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import {
  ApPayment,
  ApPaymentAllocation,
  ApVendor,
  ApVendorInvoice,
  ApVendorInvoiceLine,
  GlAccount,
  GlJournalEntry,
} from '../data/entities'
import {
  createApPaymentSchema,
  createVendorInvoiceSchema,
  createVendorSchema,
  updateVendorInvoiceSchema,
  updateVendorSchema,
} from '../data/validators'
import { registerCrudCommands } from './crud'
import { computeApInvoiceTotals, computeWithholding } from '../lib/apService'
import { raiseFinancialError } from '../lib/errors'
import { isZeroDecimal, roundDecimalHalfUp, subtractDecimalStrings, sumDecimalStrings } from '../lib/money'
import { readFinancialJurisdiction } from '../lib/jurisdiction'
import { resolveFinancialCountryPlugin } from '../lib/registries'
import { readPostingSettingsRecord } from '../lib/postingSettings'
import {
  PostingConfigurationError,
  resolvePayablePostingAccounts,
  type PayablePostingAccounts,
  type PostingAccount,
} from '../lib/postingMap'
import {
  createPostedEntry,
  emitEntrySideEffects,
  reversePostedEntry,
  type PostingSource,
} from './posting'
import { makeEvents, makeIndexer } from './ledger'
import type { JournalLineDraft } from '../lib/glService'

/**
 * Accounts payable.
 *
 * A vendor invoice and a payment are aggregates of their own: the invoice owns
 * its lines, the payment owns its allocations, and each posts exactly one
 * journal entry whose id is stored on the record. Posting is a state transition,
 * not an edit — a posted invoice can only be voided (reversed), never changed.
 *
 * Withholding is a jurisdiction capability. The payment path asks the country
 * plugin for the category and the net arithmetic, so the engine holds no rate.
 */

type Scope = { tenantId: string; organizationId: string }

function resolveScope(ctx: CommandRuntimeContext): Scope {
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!tenantId || !organizationId) {
    throw new Error('[internal] Tenant and organization context are required.')
  }
  return { tenantId, organizationId }
}

export const AP_VENDOR_ENTITY_ID = 'financial:ap_vendor' as const
export const AP_VENDOR_INVOICE_ENTITY_ID = 'financial:ap_vendor_invoice' as const
export const AP_PAYMENT_ENTITY_ID = 'financial:ap_payment' as const

const apVendorEvents = makeEvents<ApVendor>('ap_vendor')
const apVendorIndexer = makeIndexer<ApVendor>(AP_VENDOR_ENTITY_ID)
const apInvoiceEvents = makeEvents<ApVendorInvoice>('ap_vendor_invoice')
const apInvoiceIndexer = makeIndexer<ApVendorInvoice>(AP_VENDOR_INVOICE_ENTITY_ID)
const apPaymentEvents = makeEvents<ApPayment>('ap_payment')
const apPaymentIndexer = makeIndexer<ApPayment>(AP_PAYMENT_ENTITY_ID)

registerCrudCommands({
  entity: ApVendor,
  entityId: AP_VENDOR_ENTITY_ID,
  resource: 'ap_vendors',
  createSchema: createVendorSchema,
  updateSchema: updateVendorSchema,
  toCreateData: (input) => input,
  toUpdateData: (input) => {
    const { id: _id, ...patch } = input
    return patch
  },
  events: apVendorEvents,
  indexer: apVendorIndexer,
})

function readConfigService(ctx: CommandRuntimeContext): ModuleConfigService | null {
  try {
    return ctx.container.resolve('moduleConfigService') as ModuleConfigService
  } catch {
    return null
  }
}

type ApAccounts = {
  accounts: PayablePostingAccounts
  byCode: Map<string, PostingAccount>
}

async function loadApAccounts(
  ctx: CommandRuntimeContext,
  em: EntityManager,
  scope: Scope,
): Promise<ApAccounts> {
  const configService = readConfigService(ctx)
  const jurisdiction = configService ? await readFinancialJurisdiction(configService, scope) : null
  const plugin = resolveFinancialCountryPlugin(jurisdiction)
  const standardPurchase = plugin.tax.listRates()
    .find((rate) => rate.category === 'S' && rate.purchaseAccountCode)
    ?.purchaseAccountCode ?? null
  const settings = configService
    ? (await readPostingSettingsRecord(configService, { tenantId: scope.tenantId })).settings
    : {}
  const rows = await em.find(GlAccount, { ...scope, deletedAt: null })
  const accounts: PostingAccount[] = rows.map((account) => ({
    id: account.id,
    code: account.code,
    accountClass: account.accountClass,
    accountType: account.accountType ?? null,
  }))
  try {
    return {
      accounts: resolvePayablePostingAccounts(settings, accounts, standardPurchase),
      byCode: new Map(accounts.map((account) => [account.code, account])),
    }
  } catch (error) {
    if (error instanceof PostingConfigurationError) {
      return raiseFinancialError(409, 'posting_accounts_missing')
    }
    throw error
  }
}

async function emitInvoiceSideEffects(
  ctx: CommandRuntimeContext,
  scope: Scope,
  action: 'created' | 'updated' | 'deleted',
  invoice: ApVendorInvoice,
  actorUserId: string | null,
): Promise<void> {
  await emitCrudSideEffects({
    dataEngine: ctx.container.resolve('dataEngine') as DataEngine,
    action,
    entity: invoice,
    identifiers: { id: invoice.id, ...scope },
    actorUserId,
    events: apInvoiceEvents,
    indexer: apInvoiceIndexer,
  })
}

async function emitPaymentSideEffects(
  ctx: CommandRuntimeContext,
  scope: Scope,
  action: 'created' | 'updated',
  payment: ApPayment,
  actorUserId: string | null,
): Promise<void> {
  await emitCrudSideEffects({
    dataEngine: ctx.container.resolve('dataEngine') as DataEngine,
    action,
    entity: payment,
    identifiers: { id: payment.id, ...scope },
    actorUserId,
    events: apPaymentEvents,
    indexer: apPaymentIndexer,
  })
}

function invoiceLinesOf(lines: ApVendorInvoiceLine[]): JournalLineDraft[] {
  const drafts: JournalLineDraft[] = lines.map((line) => ({
    accountId: line.expenseAccountId,
    debitAmount: line.totalNetAmount,
    creditAmount: '0',
    description: line.description,
    taxCode: line.taxCode ?? null,
  }))
  return drafts
}

async function recomputeInvoiceStatus(
  em: EntityManager,
  scope: Scope,
  invoiceId: string,
): Promise<void> {
  const invoice = await em.findOne(ApVendorInvoice, { id: invoiceId, ...scope, deletedAt: null })
  if (!invoice || invoice.status === 'void' || invoice.status === 'draft') return
  const allocations = await em.find(ApPaymentAllocation, { invoiceId })
  const paymentIds = Array.from(new Set(allocations.map((allocation) => allocation.paymentId)))
  const payments = paymentIds.length
    ? await em.find(ApPayment, {
        id: { $in: paymentIds },
        status: 'posted',
        deletedAt: null,
        ...scope,
      })
    : []
  const postedPaymentIds = new Set(payments.map((payment) => payment.id))
  const paid = roundDecimalHalfUp(
    sumDecimalStrings(
      allocations
        .filter((allocation) => postedPaymentIds.has(allocation.paymentId))
        .map((allocation) => allocation.amount),
    ),
    2,
  )
  invoice.status = Number(paid) >= Number(invoice.grandTotalGrossAmount) ? 'paid' : 'posted'
  invoice.updatedAt = new Date()
  await em.flush()
}

const createVendorInvoiceCommand: CommandHandler<Record<string, unknown>, { id: string }> = {
  id: 'financial.ap_vendor_invoices.create',
  async execute(raw, ctx) {
    const input = createVendorInvoiceSchema.parse(raw)
    const scope = resolveScope(ctx)
    const actorUserId = ctx.auth?.sub ?? null
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const invoice = await em.transactional(async (trx) => {
      const vendor = await trx.findOne(ApVendor, { id: input.vendorId, ...scope, deletedAt: null })
      if (!vendor) return raiseFinancialError(404, 'vendor_not_found')
      const totals = computeApInvoiceTotals(input.lines)
      if (isZeroDecimal(totals.grandTotalGrossAmount)) {
        return raiseFinancialError(400, 'invalid_amount')
      }
      const now = new Date()
      const created = trx.create(ApVendorInvoice, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        vendorId: input.vendorId,
        internalNumber: input.internalNumber?.trim() || `AP-INV-${Date.now().toString(36).toUpperCase()}`,
        vendorInvoiceNumber: input.vendorInvoiceNumber ?? null,
        issueDate: new Date(input.issueDate),
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        currencyCode: input.currencyCode.toUpperCase(),
        subtotalNetAmount: totals.subtotalNetAmount,
        taxTotalAmount: totals.taxTotalAmount,
        grandTotalGrossAmount: totals.grandTotalGrossAmount,
        withholdingCode: input.withholdingCode ?? null,
        withholdingAmount: '0',
        status: 'draft',
        notes: input.notes ?? null,
        createdBy: actorUserId,
        updatedBy: actorUserId,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })
      trx.persist(created)
      await trx.flush()
      input.lines.forEach((_line, index) => {
        const computed = totals.lines[index]
        trx.persist(trx.create(ApVendorInvoiceLine, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          invoiceId: created.id,
          lineNumber: index + 1,
          description: computed.description,
          expenseAccountId: computed.expenseAccountId,
          quantity: computed.quantity,
          unitPriceNet: computed.unitPriceNet,
          totalNetAmount: computed.totalNetAmount,
          taxRate: computed.taxRate,
          taxAmount: computed.taxAmount,
          totalGrossAmount: computed.totalGrossAmount,
          taxCode: computed.taxCode,
        }))
      })
      await trx.flush()
      return created
    })
    await emitInvoiceSideEffects(ctx, scope, 'created', invoice, actorUserId)
    return { id: invoice.id }
  },
}

const updateVendorInvoiceCommand: CommandHandler<Record<string, unknown>, { id: string }> = {
  id: 'financial.ap_vendor_invoices.update',
  async execute(raw, ctx) {
    const input = updateVendorInvoiceSchema.parse(raw)
    const scope = resolveScope(ctx)
    const actorUserId = ctx.auth?.sub ?? null
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const invoice = await em.transactional(async (trx) => {
      const current = await trx.findOne(ApVendorInvoice, {
        id: input.id,
        ...scope,
        deletedAt: null,
      }, { lockMode: LockMode.PESSIMISTIC_WRITE })
      if (!current) return raiseFinancialError(404, 'vendor_invoice_not_found')
      if (current.status !== 'draft') return raiseFinancialError(409, 'vendor_invoice_not_draft')
      if (input.vendorId) {
        const vendor = await trx.findOne(ApVendor, { id: input.vendorId, ...scope, deletedAt: null })
        if (!vendor) return raiseFinancialError(404, 'vendor_not_found')
        current.vendorId = input.vendorId
      }
      if (input.vendorInvoiceNumber !== undefined) current.vendorInvoiceNumber = input.vendorInvoiceNumber
      if (input.issueDate) current.issueDate = new Date(input.issueDate)
      if (input.dueDate !== undefined) current.dueDate = input.dueDate ? new Date(input.dueDate) : null
      if (input.currencyCode) current.currencyCode = input.currencyCode.toUpperCase()
      if (input.withholdingCode !== undefined) current.withholdingCode = input.withholdingCode
      if (input.notes !== undefined) current.notes = input.notes
      if (input.lines) {
        const totals = computeApInvoiceTotals(input.lines)
        if (isZeroDecimal(totals.grandTotalGrossAmount)) return raiseFinancialError(400, 'invalid_amount')
        current.subtotalNetAmount = totals.subtotalNetAmount
        current.taxTotalAmount = totals.taxTotalAmount
        current.grandTotalGrossAmount = totals.grandTotalGrossAmount
        await trx.nativeDelete(ApVendorInvoiceLine, { invoiceId: current.id })
        input.lines.forEach((_line, index) => {
          const computed = totals.lines[index]
          trx.persist(trx.create(ApVendorInvoiceLine, {
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            invoiceId: current.id,
            lineNumber: index + 1,
            description: computed.description,
            expenseAccountId: computed.expenseAccountId,
            quantity: computed.quantity,
            unitPriceNet: computed.unitPriceNet,
            totalNetAmount: computed.totalNetAmount,
            taxRate: computed.taxRate,
            taxAmount: computed.taxAmount,
            totalGrossAmount: computed.totalGrossAmount,
            taxCode: computed.taxCode,
          }))
        })
      }
      current.updatedAt = new Date()
      current.updatedBy = actorUserId
      await trx.flush()
      return current
    })
    await emitInvoiceSideEffects(ctx, scope, 'updated', invoice, actorUserId)
    return { id: invoice.id }
  },
}

const deleteVendorInvoiceCommand: CommandHandler<Record<string, unknown>, { id: string }> = {
  id: 'financial.ap_vendor_invoices.delete',
  async execute(raw, ctx) {
    const input = z.object({ id: z.string().uuid() }).parse(raw)
    const scope = resolveScope(ctx)
    const actorUserId = ctx.auth?.sub ?? null
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const invoice = await em.transactional(async (trx) => {
      const current = await trx.findOne(ApVendorInvoice, {
        id: input.id,
        ...scope,
        deletedAt: null,
      }, { lockMode: LockMode.PESSIMISTIC_WRITE })
      if (!current) return raiseFinancialError(404, 'vendor_invoice_not_found')
      if (current.status !== 'draft') return raiseFinancialError(409, 'vendor_invoice_not_draft')
      const allocations = await trx.count(ApPaymentAllocation, { invoiceId: current.id })
      if (allocations > 0) return raiseFinancialError(409, 'vendor_invoice_has_payments')
      current.deletedAt = new Date()
      current.updatedAt = new Date()
      current.updatedBy = actorUserId
      await trx.flush()
      return current
    })
    await emitInvoiceSideEffects(ctx, scope, 'deleted', invoice, actorUserId)
    return { id: invoice.id }
  },
}

const postVendorInvoiceCommand: CommandHandler<Record<string, unknown>, { id: string; entryId: string }> = {
  id: 'financial.ap_vendor_invoices.post',
  async execute(raw, ctx) {
    const input = z.object({ id: z.string().uuid() }).parse(raw)
    const scope = resolveScope(ctx)
    const actorUserId = ctx.auth?.sub ?? null
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const result = await em.transactional(async (trx) => {
      const invoice = await trx.findOne(ApVendorInvoice, {
        id: input.id,
        ...scope,
        deletedAt: null,
      }, { lockMode: LockMode.PESSIMISTIC_WRITE })
      if (!invoice) return raiseFinancialError(404, 'vendor_invoice_not_found')
      if (invoice.status !== 'draft') return raiseFinancialError(409, 'vendor_invoice_not_draft')
      const lines = await trx.find(ApVendorInvoiceLine, { invoiceId: invoice.id }, { orderBy: { lineNumber: 'asc' } })
      if (lines.length === 0) return raiseFinancialError(400, 'vendor_invoice_not_draft')

      const { accounts } = await loadApAccounts(ctx, trx, scope)
      const drafts = invoiceLinesOf(lines)
      if (!isZeroDecimal(invoice.taxTotalAmount)) {
        drafts.push({
          accountId: accounts.inputVat.id,
          debitAmount: invoice.taxTotalAmount,
          creditAmount: '0',
          description: `Input VAT — ${invoice.internalNumber}`,
          taxCode: null,
        })
      }
      drafts.push({
        accountId: accounts.payable.id,
        debitAmount: '0',
        creditAmount: invoice.grandTotalGrossAmount,
        description: `Vendor invoice ${invoice.internalNumber}`,
        taxCode: null,
      })
      const source: PostingSource = {
        kind: 'ap_invoice',
        currencyCode: invoice.currencyCode,
        postingDate: invoice.issueDate,
        description: `Vendor invoice ${invoice.internalNumber}`,
        lines: drafts,
      }
      const now = new Date()
      const entry = await createPostedEntry(
        trx, scope, source, 'ap_vendor_invoice', invoice.id, actorUserId, now,
      )
      invoice.status = 'posted'
      invoice.postedEntryId = entry.id
      invoice.postedAt = now
      invoice.updatedAt = now
      invoice.updatedBy = actorUserId
      await trx.flush()
      return { invoice, entry }
    })
    await emitInvoiceSideEffects(ctx, scope, 'updated', result.invoice, actorUserId)
    await emitEntrySideEffects(ctx, scope, actorUserId, 'posted', result.entry)
    return { id: result.invoice.id, entryId: result.entry.id }
  },
}

const voidVendorInvoiceCommand: CommandHandler<Record<string, unknown>, { id: string }> = {
  id: 'financial.ap_vendor_invoices.void',
  async execute(raw, ctx) {
    const input = z.object({ id: z.string().uuid() }).parse(raw)
    const scope = resolveScope(ctx)
    const actorUserId = ctx.auth?.sub ?? null
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const result = await em.transactional(async (trx) => {
      const invoice = await trx.findOne(ApVendorInvoice, {
        id: input.id,
        ...scope,
        deletedAt: null,
      }, { lockMode: LockMode.PESSIMISTIC_WRITE })
      if (!invoice) return raiseFinancialError(404, 'vendor_invoice_not_found')
      if (invoice.status !== 'posted') return raiseFinancialError(409, 'vendor_invoice_not_posted')
      const entry = invoice.postedEntryId
        ? await trx.findOne(GlJournalEntry, { id: invoice.postedEntryId, ...scope }, { populate: ['lines'], lockMode: LockMode.PESSIMISTIC_WRITE })
        : null
      const now = new Date()
      const reversal = entry ? await reversePostedEntry(trx, scope, entry, actorUserId, now) : null
      invoice.status = 'void'
      invoice.updatedAt = now
      invoice.updatedBy = actorUserId
      await trx.flush()
      return { invoice, entry, reversal }
    })
    await emitInvoiceSideEffects(ctx, scope, 'updated', result.invoice, actorUserId)
    if (result.entry && result.reversal) {
      await emitEntrySideEffects(ctx, scope, actorUserId, 'reversed', result.reversal, result.entry)
    }
    return { id: result.invoice.id }
  },
}

const createApPaymentCommand: CommandHandler<Record<string, unknown>, { id: string; entryId: string }> = {
  id: 'financial.ap_payments.create',
  async execute(raw, ctx) {
    const input = createApPaymentSchema.parse(raw)
    const scope = resolveScope(ctx)
    const actorUserId = ctx.auth?.sub ?? null
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const result = await em.transactional(async (trx) => {
      const vendor = await trx.findOne(ApVendor, { id: input.vendorId, ...scope, deletedAt: null })
      if (!vendor) return raiseFinancialError(404, 'vendor_not_found')
      const gross = roundDecimalHalfUp(input.grossAmount, 2)
      if (isZeroDecimal(gross) || gross.startsWith('-')) return raiseFinancialError(400, 'payment_amount_not_positive')

      const { accounts, byCode } = await loadApAccounts(ctx, trx, scope)
      const configService = readConfigService(ctx)
      const jurisdiction = configService ? await readFinancialJurisdiction(configService, scope) : null
      const plugin = resolveFinancialCountryPlugin(jurisdiction)
      let withholdingAmount = '0.00'
      let withholdingAccountId: string | null = null
      if (input.withholdingCode) {
        if (!plugin.withholding) return raiseFinancialError(409, 'withholding_not_available')
        const category = plugin.withholding.findCategory(input.withholdingCode)
        if (!category) return raiseFinancialError(400, 'withholding_category_not_found')
        const computation = computeWithholding(gross, category.rate)
        withholdingAmount = computation.withholding
        const account = byCode.get(category.payableAccountCode)
        if (!account) return raiseFinancialError(409, 'posting_accounts_missing')
        withholdingAccountId = account.id
      }
      const net = roundDecimalHalfUp(subtractDecimalStrings(gross, withholdingAmount), 2)

      const allocations = input.allocations ?? []
      const allocatedTotal = roundDecimalHalfUp(
        sumDecimalStrings(allocations.map((allocation) => allocation.amount)),
        2,
      )
      if (Number(allocatedTotal) > Number(gross)) {
        return raiseFinancialError(400, 'allocation_exceeds_payment')
      }
      for (const allocation of allocations) {
        const invoice = await trx.findOne(ApVendorInvoice, {
          id: allocation.invoiceId,
          vendorId: input.vendorId,
          ...scope,
          deletedAt: null,
        }, { lockMode: LockMode.PESSIMISTIC_WRITE })
        if (!invoice) return raiseFinancialError(404, 'vendor_invoice_not_found')
        if (invoice.status !== 'posted' && invoice.status !== 'paid') {
          return raiseFinancialError(409, 'vendor_invoice_not_posted')
        }
        const outstanding = roundDecimalHalfUp(
          subtractDecimalStrings(invoice.grandTotalGrossAmount, await allocatedAmount(trx, invoice.id)),
          2,
        )
        if (Number(allocation.amount) > Number(outstanding)) {
          return raiseFinancialError(409, 'payment_exceeds_invoice')
        }
      }

      const now = new Date()
      const payment = trx.create(ApPayment, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        vendorId: input.vendorId,
        paymentNumber: `AP-PAY-${Date.now().toString(36).toUpperCase()}`,
        paymentDate: new Date(input.paymentDate),
        currencyCode: input.currencyCode.toUpperCase(),
        grossAmount: gross,
        withholdingCode: input.withholdingCode ?? null,
        withholdingAmount,
        netAmount: net,
        method: input.method ?? 'bank_transfer',
        reference: input.reference ?? null,
        status: 'posted',
        notes: input.notes ?? null,
        createdBy: actorUserId,
        updatedBy: actorUserId,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })
      trx.persist(payment)
      await trx.flush()

      for (const allocation of allocations) {
        trx.persist(trx.create(ApPaymentAllocation, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          paymentId: payment.id,
          invoiceId: allocation.invoiceId,
          amount: roundDecimalHalfUp(allocation.amount, 2),
        }))
      }

      const drafts: JournalLineDraft[] = [{
        accountId: accounts.payable.id,
        debitAmount: gross,
        creditAmount: '0',
        description: `Payment ${payment.paymentNumber}`,
        taxCode: null,
      }]
      if (withholdingAccountId && !isZeroDecimal(withholdingAmount)) {
        drafts.push({
          accountId: withholdingAccountId,
          debitAmount: '0',
          creditAmount: withholdingAmount,
          description: `Withholding tax ${input.withholdingCode}`,
          taxCode: input.withholdingCode ?? null,
        })
      }
      const moneyAccount = payment.method === 'cash' ? accounts.cash : accounts.bank
      drafts.push({
        accountId: moneyAccount.id,
        debitAmount: '0',
        creditAmount: net,
        description: `Payment ${payment.paymentNumber}`,
        taxCode: null,
      })
      const source: PostingSource = {
        kind: 'ap_payment',
        currencyCode: payment.currencyCode,
        postingDate: payment.paymentDate,
        description: `Vendor payment ${payment.paymentNumber}`,
        lines: drafts,
      }
      const entry = await createPostedEntry(
        trx, scope, source, 'ap_vendor_payment', payment.id, actorUserId, now,
      )
      payment.postedEntryId = entry.id
      payment.updatedAt = now
      await trx.flush()
      for (const invoiceId of new Set(allocations.map((allocation) => allocation.invoiceId))) {
        await recomputeInvoiceStatus(trx, scope, invoiceId)
      }
      return { payment, entry }
    })
    await emitPaymentSideEffects(ctx, scope, 'created', result.payment, actorUserId)
    await emitEntrySideEffects(ctx, scope, actorUserId, 'posted', result.entry)
    return { id: result.payment.id, entryId: result.entry.id }
  },
}

async function allocatedAmount(em: EntityManager, invoiceId: string): Promise<string> {
  const rows = await em.getConnection().execute<Array<{ paid: string | null }>>(
    `select coalesce(sum(a.amount), 0) as paid
     from ap_payment_allocations a
     join ap_payments p on p.id = a.payment_id
     where a.invoice_id = ? and p.status = 'posted' and p.deleted_at is null`,
    [invoiceId],
  )
  return roundDecimalHalfUp(rows[0]?.paid ?? '0', 2)
}

const voidApPaymentCommand: CommandHandler<Record<string, unknown>, { id: string }> = {
  id: 'financial.ap_payments.void',
  async execute(raw, ctx) {
    const input = z.object({ id: z.string().uuid() }).parse(raw)
    const scope = resolveScope(ctx)
    const actorUserId = ctx.auth?.sub ?? null
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const result = await em.transactional(async (trx) => {
      const payment = await trx.findOne(ApPayment, {
        id: input.id,
        ...scope,
        deletedAt: null,
      }, { lockMode: LockMode.PESSIMISTIC_WRITE })
      if (!payment) return raiseFinancialError(404, 'payment_not_found')
      if (payment.status !== 'posted') return raiseFinancialError(409, 'payment_not_found')
      const invoices = await trx.find(ApPaymentAllocation, { paymentId: payment.id })
      const entry = payment.postedEntryId
        ? await trx.findOne(GlJournalEntry, { id: payment.postedEntryId, ...scope }, { populate: ['lines'], lockMode: LockMode.PESSIMISTIC_WRITE })
        : null
      const now = new Date()
      const reversal = entry ? await reversePostedEntry(trx, scope, entry, actorUserId, now) : null
      payment.status = 'void'
      payment.updatedAt = now
      payment.updatedBy = actorUserId
      await trx.flush()
      for (const invoiceId of new Set(invoices.map((invoice) => invoice.invoiceId))) {
        await recomputeInvoiceStatus(trx, scope, invoiceId)
      }
      return { payment, entry, reversal }
    })
    await emitPaymentSideEffects(ctx, scope, 'updated', result.payment, actorUserId)
    if (result.entry && result.reversal) {
      await emitEntrySideEffects(ctx, scope, actorUserId, 'reversed', result.reversal, result.entry)
    }
    return { id: result.payment.id }
  },
}

registerCommand(createVendorInvoiceCommand)
registerCommand(updateVendorInvoiceCommand)
registerCommand(deleteVendorInvoiceCommand)
registerCommand(postVendorInvoiceCommand)
registerCommand(voidVendorInvoiceCommand)
registerCommand(createApPaymentCommand)
registerCommand(voidApPaymentCommand)
