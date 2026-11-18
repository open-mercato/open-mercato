import { NextResponse } from 'next/server'
import { IsolationLevel } from '@mikro-orm/core'
import { z } from 'zod'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { LeaseProposal, LeaseVersion, SalesOperation, type Lease, type LeaseBillingRefusal } from '../../../data/entities'
import { notFoundError } from '../../../lib/errors'
import { loadPermittedLease } from '../../../lib/leaseRecords'
import { summarizeLeases } from '../../../lib/leaseView'
import { hasCreditPermission, resolveSalesAccess } from '../../../lib/creditPermission'
import { resolveCrmAccess } from '../../../lib/crmAccess'
import { defaultCancelSettlement, isRecurrenceCancelAvailable, readRecurrences, type RecurrenceRead } from '../../../lib/salesRecurrence'
import { loadDocumentNumbers, loadSalesDocuments } from '../../../lib/salesLookups'
import { loadSettings } from '../../../lib/settings'
import { describeBillingRefusal, describeSalesError } from '../../../lib/salesErrorText'
import { isLeaseEnding } from '../../../lib/floorStatus'
import { handleRouteError, readRouteParam, resolveStaffContext } from '../../routeContext'
import { crmAccessSchema } from '../../crudShared'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['property_management.view'] },
}

type RouteContext = { params: Promise<{ id?: string }> }

type StoredOperationError = NonNullable<SalesOperation['lastError']>

async function describedLastError(error: StoredOperationError | null | undefined): Promise<StoredOperationError | null> {
  if (!error) return null
  return {
    code: error.code ?? null,
    status: error.status ?? null,
    ...(error.compensation ? { compensation: true } : {}),
    message: await describeSalesError({ status: error.status ?? null, code: error.code ?? null, message: error.message ?? null }),
  }
}

async function describedRefusal(refusal: LeaseBillingRefusal | null | undefined): Promise<LeaseBillingRefusal | null> {
  if (!refusal) return null
  return { ...refusal, message: await describeBillingRefusal({ code: refusal.code ?? null, message: refusal.message ?? null }) }
}

function invoiceRows(recurrence: RecurrenceRead | null, invoiceNumbers: Map<string, string>, creditNumbers: Map<string, string>) {
  if (!recurrence) return []
  return recurrence.periods
    .filter((period) => period.invoiceId || period.creditMemoId)
    .map((period) => ({
      periodIndex: period.periodIndex,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      invoiceId: period.invoiceId,
      invoiceNumber: period.invoiceId ? invoiceNumbers.get(period.invoiceId) ?? null : null,
      creditMemoId: period.creditMemoId,
      creditMemoNumber: period.creditMemoId ? creditNumbers.get(period.creditMemoId) ?? null : null,
      billedFactor: period.billedFactor,
      creditedFactor: period.creditedFactor,
    }))
}

function isSettlingDeletedLease(lease: Lease): boolean {
  return Boolean(lease.pendingChange) || lease.billingAttention === true
}

function withoutKey(record: object, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([name]) => name !== key))
}

export async function GET(req: Request, routeCtx: RouteContext) {
  try {
    const context = await resolveStaffContext(req)
    const id = await readRouteParam(routeCtx.params, 'id')
    if (!id) {
      return NextResponse.json({ error: context.translate('property_management.errors.leaseNotFound', 'Lease not found.') }, { status: 404 })
    }
    const scope = { tenantId: context.tenantId, organizationId: context.organizationId }
    const { lease, versions, proposals, operations } = await context.em.transactional(
      async (snapshot) => {
        const lease = await loadPermittedLease(snapshot, scope, context.permitted, id, { includeDeleted: true })
        if (lease.deletedAt && !isSettlingDeletedLease(lease)) {
          throw await notFoundError('property_management.errors.leaseNotFound', 'Lease not found.')
        }
        const versions = await findWithDecryption(snapshot, LeaseVersion, { ...scope, leaseId: lease.id }, { orderBy: { versionNo: 'asc' } }, scope)
        const proposals = await findWithDecryption(snapshot, LeaseProposal, { ...scope, leaseId: lease.id }, { orderBy: { createdAt: 'asc' } }, scope)
        const operations = await findWithDecryption(
          snapshot,
          SalesOperation,
          { ...scope, leaseId: lease.id, status: { $ne: 'done' } },
          { orderBy: { createdAt: 'asc' } },
          scope,
        )
        return { lease, versions, proposals, operations }
      },
      { isolationLevel: IsolationLevel.REPEATABLE_READ, readOnly: true },
    )
    const crmAccess = await resolveCrmAccess(context.ctx.container, context.ctx.auth ?? null, scope)
    const [summary] = await summarizeLeases(context.em, scope, [lease], { crmAccess })
    const lastBillingRefusal = await describedRefusal(lease.lastBillingRefusal)
    const operationErrors = await Promise.all(operations.map((operation) => describedLastError(operation.lastError)))
    const recurrences = await readRecurrences(context.em.fork(), scope, versions.map((version) => version.salesOrderId ?? ''))
    const salesAccess = await resolveSalesAccess(context.ctx.container, context.ctx.auth, scope)
    const periods = salesAccess.invoices ? Array.from(recurrences.values()).flatMap((recurrence) => recurrence.periods) : []
    const [orders, quotes, invoiceNumbers, creditNumbers, canCredit, settlement, cancelAvailable, settings] = await Promise.all([
      loadSalesDocuments(context.em, scope, 'order', salesAccess.orders ? versions.map((version) => version.salesOrderId ?? '') : []),
      loadSalesDocuments(context.em, scope, 'quote', salesAccess.quotes ? proposals.map((proposal) => proposal.salesQuoteId ?? '') : []),
      loadDocumentNumbers(context.em, scope, 'invoice', periods.map((period) => period.invoiceId ?? '')),
      loadDocumentNumbers(context.em, scope, 'credit_memo', periods.map((period) => period.creditMemoId ?? '')),
      hasCreditPermission(context.ctx.container, context.ctx.auth, scope),
      defaultCancelSettlement(context.em, scope),
      isRecurrenceCancelAvailable(),
      loadSettings(context.em, scope),
    ])
    return NextResponse.json({
      lease: salesAccess.orders ? summary : withoutKey(summary, 'salesOrderNumber'),
      deleted: Boolean(lease.deletedAt),
      salesAccess,
      crmAccess,
      leaseEnding: summary.status === 'active' && isLeaseEnding(summary.daysLeft, settings.leaseEndingThresholdDays),
      leaseEndingThresholdDays: settings.leaseEndingThresholdDays,
      salesCancelAvailable: cancelAvailable,
      pendingChange: lease.pendingChange ?? null,
      lastBillingRefusal,
      versions: versions.map((version) => {
        const recurrence = version.salesOrderId ? recurrences.get(version.salesOrderId) ?? null : null
        return {
          id: version.id,
          versionNo: version.versionNo,
          event: version.event,
          state: version.state,
          catalogProductId: version.catalogProductId,
          productName: version.productName,
          monthlyRate: version.monthlyRate,
          currencyCode: version.currencyCode ?? null,
          startsOn: version.startsOn,
          endsOn: version.endsOn,
          months: version.months,
          salesOrderId: version.salesOrderId ?? null,
          ...(salesAccess.orders ? { salesOrderNumber: version.salesOrderId ? orders.get(version.salesOrderId)?.number ?? null : null } : {}),
          recurrence: recurrence
            ? {
                status: recurrence.status,
                nextInvoiceOn: recurrence.nextInvoiceOn,
                cancelEffectiveOn: recurrence.cancelEffectiveOn,
                invoicesAvailable: recurrence.invoicesAvailable,
              }
            : null,
          ...(salesAccess.invoices ? { invoices: invoiceRows(recurrence, invoiceNumbers, creditNumbers) } : {}),
          createdAt: version.createdAt.toISOString(),
        }
      }),
      proposals: proposals.map((proposal) => ({
        id: proposal.id,
        kind: proposal.kind,
        status: proposal.status,
        startsOn: proposal.startsOn,
        endsOn: proposal.endsOn,
        months: proposal.months,
        monthlyRate: proposal.monthlyRate,
        currencyCode: proposal.currencyCode ?? null,
        message: proposal.message ?? null,
        expiresInDays: proposal.expiresInDays,
        respondBy: proposal.respondBy,
        salesQuoteId: proposal.salesQuoteId ?? null,
        ...(salesAccess.quotes ? { salesQuoteNumber: proposal.salesQuoteId ? quotes.get(proposal.salesQuoteId)?.number ?? null : null } : {}),
        answeredAt: proposal.answeredAt?.toISOString() ?? null,
        remindedAt: proposal.remindedAt?.toISOString() ?? null,
        createdAt: proposal.createdAt.toISOString(),
      })),
      operations: operations.map((operation, index) => ({
        id: operation.id,
        kind: operation.kind,
        status: operation.status,
        attempts: operation.attempts,
        lastError: operationErrors[index],
        salesDocumentId: operation.salesDocumentId ?? null,
        createdAt: operation.createdAt.toISOString(),
      })),
      billing: { canCredit, defaultSettlement: settlement, cancelAvailable },
    })
  } catch (err) {
    return handleRouteError(err, 'property_management.lease_detail_failed')
  }
}

const invoiceSchema = z.object({
  periodIndex: z.number().int(),
  periodStart: z.string(),
  periodEnd: z.string(),
  invoiceId: z.string().nullable(),
  invoiceNumber: z.string().nullable(),
  creditMemoId: z.string().nullable(),
  creditMemoNumber: z.string().nullable(),
  billedFactor: z.string().nullable(),
  creditedFactor: z.string().nullable(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Property Management',
  summary: 'Lease detail',
  methods: {
    GET: {
      summary: 'Lease with versions, proposals, open billing operations and invoices per version',
      description:
        '`leaseEnding` is true for an active lease whose `daysLeft` is at most the organization\'s `leaseEndingThresholdDays` (also returned). `salesCancelAvailable` is false while sales cannot cancel recurring orders; ending or deleting a lease that would need a cancellation is then refused with `409 lease_billing_cancel_unavailable`. Sales document details are returned only to callers with the matching sales feature, reported in `salesAccess`: `lease.salesOrderNumber` and `versions[].salesOrderNumber` need `sales.orders.view`, `proposals[].salesQuoteNumber` needs `sales.quotes.view`, and `versions[].invoices` needs `sales.invoices.manage`. Without the feature the field is omitted; the document ids and `versions[].recurrence` are always returned. CRM names are gated the same way, reported in `crmAccess`: `lease.contactName` needs `customers.people.view` and `lease.companyName` needs `customers.companies.view`; without the feature the key is omitted (`lease.primaryContactPersonId` and `lease.customerCompanyId` stay) and no CRM record is read. A deleted lease stays readable, with `deleted: true`, while its billing is still settling (a pending change or the billing-attention flag); otherwise it is 404.',
      responses: [
        {
          status: 200,
          description: 'Lease detail',
          schema: z.object({
            lease: z.record(z.string(), z.unknown()),
            deleted: z.boolean(),
            leaseEnding: z.boolean(),
            leaseEndingThresholdDays: z.number().int(),
            salesCancelAvailable: z.boolean(),
            pendingChange: z.record(z.string(), z.unknown()).nullable(),
            lastBillingRefusal: z.record(z.string(), z.unknown()).nullable(),
            salesAccess: z.object({ orders: z.boolean(), quotes: z.boolean(), invoices: z.boolean() }),
            crmAccess: crmAccessSchema,
            versions: z.array(
              z
                .object({
                  id: z.string().uuid(),
                  versionNo: z.number().int(),
                  salesOrderId: z.string().nullable(),
                  salesOrderNumber: z.string().nullable().optional(),
                  invoices: z.array(invoiceSchema).optional(),
                })
                .passthrough(),
            ),
            proposals: z.array(
              z
                .object({
                  id: z.string().uuid(),
                  kind: z.string(),
                  status: z.string(),
                  salesQuoteId: z.string().nullable(),
                  salesQuoteNumber: z.string().nullable().optional(),
                })
                .passthrough(),
            ),
            operations: z.array(z.object({ id: z.string().uuid(), kind: z.string(), status: z.string() }).passthrough()),
            billing: z.object({
              canCredit: z.boolean(),
              defaultSettlement: z.enum(['prorate', 'credit_full', 'keep']),
              cancelAvailable: z.boolean(),
            }),
          }),
        },
      ],
      errors: [{ status: 404, description: 'Lease not found or its building is not assigned to the caller' }],
    },
  },
}
