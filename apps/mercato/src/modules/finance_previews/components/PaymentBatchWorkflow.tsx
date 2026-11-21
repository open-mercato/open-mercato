'use client'

import * as React from 'react'
import { z } from 'zod'
import { pl } from 'date-fns/locale'
import { ArrowRight, CheckCircle2, ShieldCheck } from 'lucide-react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { CrudField } from '@open-mercato/ui/backend/CrudForm'
import { FinanceCrudForm as CrudForm } from './FinanceCrudForm'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '@open-mercato/ui/primitives/card'
import { FinanceStatusBadge } from './FinanceStatusBadge'
import copy from '../data/payment-batch-copy.json'

export const paymentBatchSchema = z.object({
  selected: z.array(z.string()),
  accountsVerified: z.boolean(),
  status: z.enum(['draft', 'prepared', 'approved', 'sent']),
  postedInvoiceIds: z.array(z.string()).optional(),
  scheduledDate: z.string().optional(),
  sentOn: z.string().optional(),
  verification: z.enum(['pass', 'notListed', 'unavailable']).optional(),
  verificationDate: z.string().optional(),
  verificationReference: z.string().optional(),
  invoicePosting: z
    .object({
      invoiceId: z.string(),
      expenseAccount: z.string(),
      vatAccount: z.string(),
      payableAccount: z.string(),
      net: z.number(),
      vat: z.number(),
      gross: z.number(),
    })
    .optional(),
})
export type PaymentBatchState = z.infer<typeof paymentBatchSchema>

type Invoice = {
  id: string
  supplier: string
  amount: number
  account: string
  net?: number
  vat?: number
}
const money = (value: number) =>
  new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(
    value,
  )
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(value + 'T12:00:00Z')
    return (
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    )
  })
const settingsSchema = z.object({
  scheduledDate: dateSchema,
  sentOn: dateSchema,
  verification: z.enum(['pass', 'notListed', 'unavailable']),
})
const fields: CrudField[] = [
  {
    id: 'scheduledDate',
    label: copy.scheduledDate,
    type: 'date',
    locale: pl,
    required: true,
  },
  {
    id: 'sentOn',
    label: copy.sentOn,
    type: 'date',
    locale: pl,
    required: true,
  },
  {
    id: 'verification',
    label: copy.verification,
    type: 'select',
    required: true,
    options: ['pass', 'notListed', 'unavailable'].map((value) => ({
      value,
      label: copy[value as 'pass' | 'notListed' | 'unavailable'],
    })),
  },
]
const postingFields: CrudField[] = [
  {
    id: 'expenseAccount',
    label: copy.expenseAccount,
    type: 'select',
    layout: 'half',
    required: true,
    options: copy.expenseAccounts,
  },
  {
    id: 'vatAccount',
    label: copy.vatAccount,
    type: 'select',
    layout: 'half',
    required: true,
    options: copy.vatAccounts,
  },
  {
    id: 'payableAccount',
    label: copy.payableAccount,
    type: 'select',
    layout: 'half',
    required: true,
    options: copy.payableAccounts,
  },
  {
    id: 'period',
    label: copy.postingPeriod,
    type: 'select',
    layout: 'half',
    required: true,
    options: copy.postingPeriods,
  },
]

export function PaymentBatchWorkflow({
  state,
  onChange,
  reviewedInvoice,
  invoices,
  goTo,
}: {
  state: PaymentBatchState
  onChange: (state: PaymentBatchState) => void
  reviewedInvoice: Invoice | null
  invoices: Invoice[]
  goTo: (id: string) => void
}) {
  const [error, setError] = React.useState('')
  const [notice, setNotice] = React.useState('')
  const available = reviewedInvoice
    ? [
        reviewedInvoice,
        ...invoices.filter((invoice) => invoice.id !== reviewedInvoice.id),
      ]
    : invoices
  const selected = available.filter((invoice) =>
    state.selected.includes(invoice.id),
  )
  const total =
    selected.reduce(
      (sum, invoice) => sum + Math.round(invoice.amount * 100),
      0,
    ) / 100
  const invoiceIsPosted = (invoice: Invoice) =>
    invoice.id !== reviewedInvoice?.id ||
    state.postedInvoiceIds?.includes(invoice.id) === true
  const allPosted = selected.every(invoiceIsPosted)
  const oneVendor =
    new Set(selected.map((invoice) => invoice.supplier)).size <= 1
  const scheduledDate = state.scheduledDate ?? '2026-09-30'
  const sentOn = state.sentOn ?? '2026-09-30'
  const verification = state.verification ?? 'pass'
  const checked =
    state.accountsVerified &&
    state.verificationDate === scheduledDate &&
    verification === 'pass'
  const setBatch = (patch: Partial<PaymentBatchState>) => {
    setError('')
    setNotice('')
    onChange({ ...state, ...patch })
  }
  const validate = () => {
    if (!selected.length) return copy.empty
    if (!oneVendor) return copy.oneVendor
    if (!allPosted) return copy.notPosted
    if (!checked) return copy.verificationRequired
    return ''
  }
  const advance = (status: PaymentBatchState['status']) => {
    const issue = validate()
    if (issue) {
      setError(issue)
      return
    }
    if (status === 'sent' && new Date(sentOn + 'T00:00:00') > new Date()) {
      setError(copy.dateError)
      return
    }
    if (state.status === 'sent') return
    setBatch({ status })
  }
  const columns: ColumnDef<Invoice, unknown>[] = [
    {
      id: 'select',
      header: '',
      cell: ({ row }) => (
        <Checkbox
          aria-label={`${copy.select}: ${row.original.id}`}
          checked={state.selected.includes(row.original.id)}
          disabled={state.status !== 'draft'}
          onCheckedChange={(checkedValue) =>
            setBatch({
              selected:
                checkedValue === true
                  ? [...new Set([...state.selected, row.original.id])]
                  : state.selected.filter((id) => id !== row.original.id),
              accountsVerified: false,
              verificationDate: undefined,
            })
          }
        />
      ),
    },
    {
      accessorKey: 'id',
      header: copy.number,
      meta: { truncate: false },
      cell: ({ row }) => (
        <div className="space-y-1 py-1">
          <p className="font-medium">{row.original.id}</p>
          <p className="text-xs text-muted-foreground">
            {row.original.supplier}
          </p>
        </div>
      ),
    },
    {
      id: 'status',
      header: copy.status,
      cell: ({ row }) => (
        <FinanceStatusBadge
          variant={invoiceIsPosted(row.original) ? 'success' : 'warning'}
        >
          {invoiceIsPosted(row.original) ? copy.posted : copy.reviewed}
        </FinanceStatusBadge>
      ),
    },
    {
      accessorKey: 'amount',
      header: copy.amount,
      cell: ({ row }) => (
        <span className="block text-right font-medium tabular-nums">
          {money(row.original.amount)}
        </span>
      ),
    },
  ]
  const journal = [
    { id: 'debit', account: copy.liability, debit: total, credit: 0 },
    { id: 'credit', account: copy.bank, debit: 0, credit: total },
  ]
  const journalColumns: ColumnDef<(typeof journal)[number], unknown>[] = [
    { accessorKey: 'account', header: copy.accountColumn },
    {
      accessorKey: 'debit',
      header: copy.debit,
      cell: ({ row }) => (
        <span className="block text-right tabular-nums">
          {money(row.original.debit)}
        </span>
      ),
    },
    {
      accessorKey: 'credit',
      header: copy.credit,
      cell: ({ row }) => (
        <span className="block text-right tabular-nums">
          {money(row.original.credit)}
        </span>
      ),
    },
  ]
  return (
    <div className="space-y-6" data-testid="payment-batch-workflow">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <p className="font-medium">{copy.batchNumber}</p>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {copy.description}
          </p>
        </div>
        <FinanceStatusBadge
          variant={
            state.status === 'sent'
              ? 'success'
              : state.status === 'draft'
                ? 'neutral'
                : 'info'
          }
        >
          {copy[state.status]}
        </FinanceStatusBadge>
      </div>
      {reviewedInvoice &&
      !invoiceIsPosted(reviewedInvoice) &&
      state.status === 'draft' ? (
        <Card>
          <CardHeader>
            <CardTitle>{reviewedInvoice.id}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{copy.postHint}</p>
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">{copy.supplier}</p>
                <p className="font-medium">{reviewedInvoice.supplier}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{copy.amount}</p>
                <p className="font-medium tabular-nums">
                  {money(reviewedInvoice.amount)}
                </p>
              </div>
            </div>
            <CrudForm
              embedded
              fields={postingFields}
              initialValues={{
                expenseAccount: '402',
                vatAccount: '223',
                payableAccount: '202',
                period: '2026-09',
              }}
              submitLabel={copy.post}
              onSubmit={async (values) => {
                const expenseAccount = String(values.expenseAccount)
                const vatAccount = String(values.vatAccount)
                const payableAccount = String(values.payableAccount)
                if (values.period !== '2026-09')
                  throw createCrudFormError(copy.periodClosed)
                if (
                  !copy.expenseAccounts.some(
                    (option) => option.value === expenseAccount,
                  ) ||
                  !copy.vatAccounts.some(
                    (option) => option.value === vatAccount,
                  ) ||
                  !copy.payableAccounts.some(
                    (option) => option.value === payableAccount,
                  )
                )
                  throw createCrudFormError(copy.accountRequired)
                const net = reviewedInvoice.net ?? 10000
                const vat = reviewedInvoice.vat ?? 2300
                if (
                  Math.round((net + vat) * 100) !==
                  Math.round(reviewedInvoice.amount * 100)
                )
                  throw createCrudFormError(copy.amountMismatch)
                setBatch({
                  postedInvoiceIds: [
                    ...new Set([
                      ...(state.postedInvoiceIds ?? []),
                      reviewedInvoice.id,
                    ]),
                  ],
                  invoicePosting: {
                    invoiceId: reviewedInvoice.id,
                    expenseAccount,
                    vatAccount,
                    payableAccount,
                    net,
                    vat,
                    gross: reviewedInvoice.amount,
                  },
                })
                setNotice(copy.invoicePosted)
              }}
            />
          </CardContent>
        </Card>
      ) : null}
      {state.invoicePosting ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <CheckCircle2 className="mr-2 inline size-4" />
              {copy.invoiceJournal}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-muted-foreground">
              {state.invoicePosting.invoiceId}
            </p>
            <div
              tabIndex={0}
              aria-label={copy.scrollTable}
              className="min-w-0 max-w-full overflow-x-auto"
            >
              <p className="mb-3 text-xs text-muted-foreground sm:hidden">
                {copy.scrollTable}
              </p>
              <DataTable
                embedded
                columns={journalColumns}
                data={[
                  {
                    id: 'expense',
                    account: state.invoicePosting.expenseAccount,
                    debit: state.invoicePosting.net,
                    credit: 0,
                  },
                  {
                    id: 'vat',
                    account: state.invoicePosting.vatAccount,
                    debit: state.invoicePosting.vat,
                    credit: 0,
                  },
                  {
                    id: 'payable',
                    account: state.invoicePosting.payableAccount,
                    debit: 0,
                    credit: state.invoicePosting.gross,
                  },
                ]}
                emptyState={copy.noInvoices}
              />
            </div>
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>{copy.invoices}</CardTitle>
        </CardHeader>
        <CardContent>
          <div
            tabIndex={0}
            aria-label={copy.scrollTable}
            className="min-w-0 max-w-full overflow-x-auto"
          >
            <p className="mb-3 text-xs text-muted-foreground sm:hidden">
              {copy.scrollTable}
            </p>
            <DataTable
              embedded
              columns={columns}
              data={available}
              emptyState={copy.noInvoices}
            />
          </div>
          {!oneVendor ? (
            <Alert status="warning" style="stroke" className="mt-4">
              {copy.oneVendor}
            </Alert>
          ) : null}
          <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
            <span className="text-sm text-muted-foreground">{copy.total}</span>
            <strong className="text-xl tabular-nums">{money(total)}</strong>
          </div>
        </CardContent>
      </Card>
      {state.status === 'draft' ? (
        <Card>
          <CardHeader>
            <CardTitle>{copy.configuration}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <CrudForm
              key={`${scheduledDate}-${sentOn}-${verification}`}
              embedded
              fields={fields}
              initialValues={{ scheduledDate, sentOn, verification }}
              submitLabel={copy.save}
              onSubmit={async (values) => {
                const result = settingsSchema.safeParse(values)
                if (
                  !result.success ||
                  new Date(String(values.sentOn) + 'T00:00:00') > new Date()
                )
                  throw createCrudFormError(copy.dateError)
                setBatch({
                  ...result.data,
                  accountsVerified: false,
                  verificationDate: undefined,
                  verificationReference: undefined,
                })
                setNotice(copy.saved)
              }}
            />
            <p className="text-xs text-muted-foreground">{copy.simulation}</p>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (!selected.length) {
                  setError(copy.empty)
                  return
                }
                if (!oneVendor) {
                  setError(copy.oneVendor)
                  return
                }
                if (verification !== 'pass') {
                  setBatch({
                    accountsVerified: false,
                    verificationDate: scheduledDate,
                    verificationReference: undefined,
                  })
                  setError(copy.blocked)
                  return
                }
                setBatch({
                  accountsVerified: true,
                  verificationDate: scheduledDate,
                  verificationReference: `DEMO-${scheduledDate}-${state.selected.length}`,
                })
              }}
            >
              <ShieldCheck className="size-4" />
              {copy.verify}
            </Button>
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>{copy.account}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="break-all text-sm font-medium">
            {selected[0]?.account ?? '—'}
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <FinanceStatusBadge variant={checked ? 'success' : 'warning'}>
              {checked ? copy.verified : copy.pending}
            </FinanceStatusBadge>
            {checked ? (
              <span className="text-sm text-muted-foreground">
                {scheduledDate} / {state.verificationReference}
              </span>
            ) : null}
          </div>
          {notice ? (
            <Alert status="information" style="stroke">
              {notice}
            </Alert>
          ) : null}
          {error ? (
            <Alert status="error" style="stroke">
              {error}
            </Alert>
          ) : null}
          {state.status === 'sent' ? (
            <Alert status="information" style="stroke">
              {copy.sentHint}
            </Alert>
          ) : null}
          <div className="flex flex-wrap gap-3">
            {state.status === 'draft' ? (
              <Button
                type="button"
                variant="primary-filled"
                onClick={() => advance('prepared')}
              >
                {copy.prepare}
              </Button>
            ) : null}
            {state.status === 'prepared' ? (
              <Button
                type="button"
                variant="primary-filled"
                onClick={() => advance('approved')}
              >
                {copy.approve}
              </Button>
            ) : null}
            {state.status === 'approved' ? (
              <Button
                type="button"
                variant="primary-filled"
                onClick={() => advance('sent')}
              >
                {copy.send}
              </Button>
            ) : null}
            {state.status === 'prepared' || state.status === 'approved' ? (
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setBatch({ status: 'draft', accountsVerified: false })
                }
              >
                {copy.edit}
              </Button>
            ) : null}
            {state.status === 'sent' ? (
              <>
                <Button
                  type="button"
                  variant="primary-filled"
                  onClick={() => goTo('s52')}
                >
                  {copy.match}
                  <ArrowRight className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => goTo('s16')}
                >
                  {copy.importStatement}
                </Button>
              </>
            ) : null}
            <Button type="button" variant="outline" onClick={() => goTo('s7')}>
              {copy.back}
            </Button>
          </div>
        </CardContent>
      </Card>
      {state.status === 'sent' ? (
        <Card>
          <CardHeader>
            <CardTitle>{copy.journal}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-muted-foreground">
              PK/PŁ/{sentOn} —{' '}
              {selected.map((invoice) => invoice.id).join(', ')}
            </p>
            <div
              tabIndex={0}
              aria-label={copy.scrollTable}
              className="min-w-0 max-w-full overflow-x-auto"
            >
              <p className="mb-3 text-xs text-muted-foreground sm:hidden">
                {copy.scrollTable}
              </p>
              <DataTable
                embedded
                columns={journalColumns}
                data={journal}
                emptyState={copy.noInvoices}
              />
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
