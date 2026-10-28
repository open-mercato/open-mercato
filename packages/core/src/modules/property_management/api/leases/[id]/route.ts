import { NextResponse } from 'next/server'
import { z } from 'zod'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { LeaseProposal, LeaseVersion, SalesOperation } from '../../../data/entities'
import { loadPermittedLease } from '../../../lib/leaseRecords'
import { summarizeLeases } from '../../../lib/leaseView'
import { hasCreditPermission } from '../../../lib/creditPermission'
import { defaultCancelSettlement, isRecurrenceCancelAvailable, readRecurrence, type RecurrenceRead } from '../../../lib/salesRecurrence'
import { loadDocumentNumbers, loadSalesDocuments } from '../../../lib/salesLookups'
import { handleRouteError, readRouteParam, resolveStaffContext } from '../../routeContext'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['property_management.view'] },
}

type RouteContext = { params: Promise<{ id?: string }> }

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

export async function GET(req: Request, routeCtx: RouteContext) {
  try {
    const context = await resolveStaffContext(req)
    const id = await readRouteParam(routeCtx.params, 'id')
    if (!id) {
      return NextResponse.json({ error: context.translate('property_management.errors.leaseNotFound', 'Lease not found.') }, { status: 404 })
    }
    const scope = { tenantId: context.tenantId, organizationId: context.organizationId }
    const lease = await loadPermittedLease(context.em, scope, context.permitted, id)
    const [summary] = await summarizeLeases(context.em, scope, [lease])
    const [versions, proposals, operations] = await Promise.all([
      findWithDecryption(context.em, LeaseVersion, { ...scope, leaseId: lease.id }, { orderBy: { versionNo: 'asc' } }, scope),
      findWithDecryption(context.em, LeaseProposal, { ...scope, leaseId: lease.id }, { orderBy: { createdAt: 'asc' } }, scope),
      findWithDecryption(
        context.em,
        SalesOperation,
        { ...scope, leaseId: lease.id, status: { $ne: 'done' } },
        { orderBy: { createdAt: 'asc' } },
        scope,
      ),
    ])
    const recurrences = new Map<string, RecurrenceRead | null>()
    for (const version of versions) {
      if (version.salesOrderId) recurrences.set(version.salesOrderId, await readRecurrence(context.em.fork(), scope, version.salesOrderId))
    }
    const periods = Array.from(recurrences.values()).flatMap((recurrence) => recurrence?.periods ?? [])
    const [orders, quotes, invoiceNumbers, creditNumbers, canCredit, settlement, cancelAvailable] = await Promise.all([
      loadSalesDocuments(context.em, scope, 'order', versions.map((version) => version.salesOrderId ?? '')),
      loadSalesDocuments(context.em, scope, 'quote', proposals.map((proposal) => proposal.salesQuoteId ?? '')),
      loadDocumentNumbers(context.em, scope, 'invoice', periods.map((period) => period.invoiceId ?? '')),
      loadDocumentNumbers(context.em, scope, 'credit_memo', periods.map((period) => period.creditMemoId ?? '')),
      hasCreditPermission(context.ctx.container, context.ctx.auth, scope),
      defaultCancelSettlement(context.em, scope),
      isRecurrenceCancelAvailable(),
    ])
    return NextResponse.json({
      lease: summary,
      pendingChange: lease.pendingChange ?? null,
      lastBillingRefusal: lease.lastBillingRefusal ?? null,
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
          salesOrderNumber: version.salesOrderId ? orders.get(version.salesOrderId)?.number ?? null : null,
          recurrence: recurrence
            ? {
                status: recurrence.status,
                nextInvoiceOn: recurrence.nextInvoiceOn,
                cancelEffectiveOn: recurrence.cancelEffectiveOn,
                invoicesAvailable: recurrence.invoicesAvailable,
              }
            : null,
          invoices: invoiceRows(recurrence, invoiceNumbers, creditNumbers),
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
        salesQuoteNumber: proposal.salesQuoteId ? quotes.get(proposal.salesQuoteId)?.number ?? null : null,
        answeredAt: proposal.answeredAt?.toISOString() ?? null,
        remindedAt: proposal.remindedAt?.toISOString() ?? null,
        createdAt: proposal.createdAt.toISOString(),
      })),
      operations: operations.map((operation) => ({
        id: operation.id,
        kind: operation.kind,
        status: operation.status,
        attempts: operation.attempts,
        lastError: operation.lastError ?? null,
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
      responses: [
        {
          status: 200,
          description: 'Lease detail',
          schema: z.object({
            lease: z.record(z.string(), z.unknown()),
            pendingChange: z.record(z.string(), z.unknown()).nullable(),
            lastBillingRefusal: z.record(z.string(), z.unknown()).nullable(),
            versions: z.array(z.object({ id: z.string().uuid(), versionNo: z.number().int(), invoices: z.array(invoiceSchema) }).passthrough()),
            proposals: z.array(z.object({ id: z.string().uuid(), kind: z.string(), status: z.string() }).passthrough()),
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
