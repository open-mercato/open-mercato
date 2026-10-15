'use client'

import * as React from 'react'
import { z } from 'zod'
import {
  ArrowRight,
  Download,
  RotateCcw,
  FileCheck2,
  Link2,
} from 'lucide-react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { CrudField } from '@open-mercato/ui/backend/CrudForm'
import { FinanceCrudForm as CrudForm } from './FinanceCrudForm'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@open-mercato/ui/primitives/card'
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@open-mercato/ui/primitives/segmented-control'
import { FinanceStatusBadge } from './FinanceStatusBadge'
import copy from '../data/tax-spec-copy.json'

const valuesSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean()]),
)
type Values = z.infer<typeof valuesSchema>
const recordSchema = z.object({
  id: z.string(),
  kind: z.string(),
  period: z.string(),
  amount: z.number(),
  status: z.enum(['calculated', 'superseded', 'posted', 'paid']),
  output: z.number(),
  input: z.number(),
  debitAccount: z.string(),
  inputAccount: z.string(),
  payableAccount: z.string(),
  paidAt: z.string().optional(),
  reference: z.string().optional(),
})
const stateSchema = z.object({
  version: z.literal(1),
  form: valuesSchema.default({}),
  records: z.array(recordSchema).default([]),
  selected: z.string().default(''),
  status: z.string().default('draft'),
  result: valuesSchema.default({}),
  previousReference: z.string().default(''),
})
type State = z.infer<typeof stateSchema>
type TaxRecord = z.infer<typeof recordSchema>
const initialState: State = {
  version: 1,
  form: {},
  records: [],
  selected: '',
  status: 'draft',
  result: {},
  previousReference: '',
}
const money = (minor: number) =>
  new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(
    minor / 100,
  )
const textValue = (values: Values, key: string) =>
  String(values[key] ?? '').trim()
function cents(value: unknown): number {
  const text = String(value ?? '')
    .replace(/\s/g, '')
    .replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(text))
    throw createCrudFormError(copy.common.amountError)
  const [whole, fraction = ''] = text.split('.')
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (!Number.isSafeInteger(amount))
    throw createCrudFormError(copy.common.amountError)
  return amount
}
function validNip(value: string): boolean {
  return (
    /^\d{10}$/.test(value) &&
    [6, 5, 7, 2, 3, 4, 5, 6, 7].reduce(
      (total, weight, index) => total + Number(value[index]) * weight,
      0,
    ) %
      11 ===
      Number(value[9])
  )
}
function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  )
}

function field(
  id: string,
  label: string,
  type: 'text' | 'select' | 'checkbox' = 'text',
  options?: Array<{ value: string; label: string }>,
  required = true,
): CrudField {
  return { id, label, type, required, layout: 'half', options }
}
const accountOptions = copy.common.accounts

function downloadSample(name: string, rows: string[][]) {
  const csv = [
    copy.common.sampleFile,
    ...rows.map((row) =>
      row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(';'),
    ),
  ].join('\n')
  const url = URL.createObjectURL(
    new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }),
  )
  const link = document.createElement('a')
  link.href = url
  link.download = `${name}-przyklad.csv`
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function useStored(screenId: string) {
  const [state, setState] = React.useState<State>(initialState)
  const [ready, setReady] = React.useState(false)
  const [storageError, setStorageError] = React.useState(false)
  const storageKey = `finance-preview-tax-spec-${screenId}-v1`
  React.useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storageKey)
      const parsed = raw ? stateSchema.safeParse(JSON.parse(raw)) : null
      setState(parsed?.success ? parsed.data : initialState)
    } catch {
      setState(initialState)
    }
    setReady(true)
  }, [storageKey])
  function update(next: State) {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(next))
      setState(next)
      setStorageError(false)
    } catch {
      setStorageError(true)
    }
  }
  return {
    state,
    update,
    ready,
    storageError,
    reset: () => update(initialState),
  }
}
function Panel({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <Card className="min-w-0 gap-0 py-0">
      <CardHeader className="p-6 pb-4">
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="space-y-6 p-6 pt-0">{children}</CardContent>
    </Card>
  )
}
type DisplayRow = { id: string; label: string; values: string[] }
function ResultTable({
  labels,
  rows,
}: {
  labels: string[]
  rows: DisplayRow[]
}) {
  const columns: ColumnDef<DisplayRow, unknown>[] = [
    {
      id: 'label',
      header: labels[0],
      accessorKey: 'label',
      cell: ({ row }) => (
        <span className="block max-w-64 whitespace-normal">
          {row.original.label}
        </span>
      ),
      meta: { truncate: false },
    },
    ...labels.slice(1).map(
      (label, index): ColumnDef<DisplayRow, unknown> => ({
        id: `value-${index}`,
        header: label,
        cell: ({ row }) => (
          <span className="tabular-nums whitespace-nowrap">
            {row.original.values[index]}
          </span>
        ),
        meta: { truncate: false },
      }),
    ),
  ]
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground sm:hidden">
        {copy.common.tableScroll}
      </p>
      <DataTable columns={columns} data={rows} emptyState={<EmptyState title={copy.common.empty} />} />
    </div>
  )
}
function Form({
  id,
  fields,
  initialValues,
  label,
  onSubmit,
}: {
  id: string
  fields: CrudField[]
  initialValues: Values
  label: string
  onSubmit: (values: Values) => void
}) {
  return (
    <CrudForm<Record<string, unknown>>
      formId={id}
      fields={fields}
      initialValues={initialValues}
      embedded
      submitLabel={label}
      onSubmit={async (raw) => {
        const parsed = valuesSchema.safeParse(raw)
        if (!parsed.success) throw createCrudFormError(copy.common.required)
        onSubmit(parsed.data)
      }}
    />
  )
}

function TaxLiabilities({
  state,
  update,
}: {
  state: State
  update: (next: State) => void
}) {
  const [kind, setKind] = React.useState(textValue(state.form, 'kind') || 'VAT')
  const current = state.records.find((record) => record.id === state.selected)
  const statusNames = {
    calculated: copy.tax.calculated,
    superseded: copy.tax.superseded,
    posted: copy.common.posted,
    paid: copy.tax.paid,
  }
  const fields = [
    field('period', copy.common.period, 'select', [
      { value: '2026-09', label: copy.tax.september },
      { value: '2026-08', label: copy.tax.august },
    ]),
    ...(kind === 'VAT'
      ? [
          field('output', copy.tax.output),
          field('input', copy.tax.input),
          field(
            'debitAccount',
            copy.tax.outputAccount,
            'select',
            accountOptions,
          ),
          field(
            'inputAccount',
            copy.tax.inputAccount,
            'select',
            accountOptions,
          ),
          field(
            'payableAccount',
            copy.tax.payableAccount,
            'select',
            accountOptions,
          ),
        ]
      : kind === 'CIT'
        ? [
            field('base', copy.tax.base),
            field('rate', copy.tax.rate),
            field(
              'debitAccount',
              copy.tax.expenseAccount,
              'select',
              accountOptions,
            ),
            field(
              'payableAccount',
              copy.tax.payableAccount,
              'select',
              accountOptions,
            ),
          ]
        : [field('withheld', copy.tax.withheld)]),
  ]
  const lines: DisplayRow[] =
    current && current.kind !== 'PIT'
      ? [
          {
            id: 'debit',
            label: current.debitAccount,
            values: [money(current.output), money(0)],
          },
          ...(current.kind === 'VAT'
            ? [
                {
                  id: 'input',
                  label: current.inputAccount,
                  values: [money(0), money(current.input)],
                },
              ]
            : []),
          {
            id: 'payable',
            label: current.payableAccount,
            values: [money(0), money(current.amount)],
          },
        ]
      : []
  return (
    <div className="space-y-6">
      <Panel title={copy.tax.title} description={copy.tax.description}>
        <SegmentedControl
          value={kind}
          onValueChange={setKind}
          aria-label={copy.tax.kind}
        >
          <SegmentedControlItem value="VAT">
            {copy.tax.vat}
          </SegmentedControlItem>
          <SegmentedControlItem value="CIT">
            {copy.tax.cit}
          </SegmentedControlItem>
          <SegmentedControlItem value="PIT">
            {copy.tax.pit}
          </SegmentedControlItem>
        </SegmentedControl>
        <p className="text-sm text-muted-foreground">{copy.tax.source}</p>
        <Form
          key={kind}
          id="tax-liability-form"
          fields={fields}
          initialValues={{
            period: '2026-09',
            output: '5000',
            input: '2000',
            base: '20000',
            rate: '19',
            withheld: '1200',
            debitAccount: '',
            inputAccount: '',
            payableAccount: '',
            ...state.form,
          }}
          label={copy.tax.calculate}
          onSubmit={(values) => {
            const period = textValue(values, 'period')
            if (
              state.records.some(
                (record) =>
                  record.kind === kind &&
                  record.period === period &&
                  ['posted', 'paid'].includes(record.status),
              )
            )
              throw createCrudFormError(copy.tax.existing)
            if (
              kind !== 'PIT' &&
              (!values.debitAccount ||
                !values.payableAccount ||
                (kind === 'VAT' && !values.inputAccount))
            )
              throw createCrudFormError(copy.tax.accountMissing)
            const rate = cents(values.rate ?? '0')
            if (rate > 10000) throw createCrudFormError(copy.common.amountError)
            const output =
              kind === 'VAT'
                ? cents(values.output)
                : kind === 'CIT'
                  ? Math.round((cents(values.base) * rate) / 10000)
                  : cents(values.withheld)
            const input = kind === 'VAT' ? cents(values.input) : 0
            const record: TaxRecord = {
              id: String(state.records.length + 1),
              kind,
              period,
              amount: output - input,
              output,
              input,
              status: 'calculated',
              debitAccount: textValue(values, 'debitAccount'),
              inputAccount: textValue(values, 'inputAccount'),
              payableAccount: textValue(values, 'payableAccount'),
            }
            update({
              ...state,
              form: { ...values, kind },
              selected: record.id,
              records: [
                ...state.records.map((previous) =>
                  previous.kind === kind &&
                  previous.period === period &&
                  previous.status === 'calculated'
                    ? { ...previous, status: 'superseded' as const }
                    : previous,
                ),
                record,
              ],
            })
          }}
        />
      </Panel>
      <Panel title={copy.tax.preview} description={copy.tax.review}>
        {current ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-sm text-muted-foreground">
                  {current.kind} — {current.period}
                </p>
                <p className="text-3xl font-semibold tabular-nums">
                  {money(current.amount)}
                </p>
              </div>
              <FinanceStatusBadge>
                {statusNames[current.status]}
              </FinanceStatusBadge>
            </div>
            {current.kind === 'PIT' ? (
              <Alert status="information" style="stroke">
                {copy.tax.pitNote}
              </Alert>
            ) : current.amount >= 0 ? (
              <ResultTable
                labels={[
                  copy.common.account,
                  copy.common.debit,
                  copy.common.credit,
                ]}
                rows={lines}
              />
            ) : null}
            {current.amount < 0 ? (
              <Alert status="warning" style="stroke">
                {copy.tax.refund}
              </Alert>
            ) : null}
            {current.period === '2026-08' ? (
              <Alert status="warning" style="stroke">
                {copy.tax.lockedError}
              </Alert>
            ) : null}
            <Button
              type="button"
              variant="primary-filled"
              disabled={
                current.status !== 'calculated' ||
                current.amount < 0 ||
                current.period === '2026-08'
              }
              onClick={() =>
                update({
                  ...state,
                  records: state.records.map((record) =>
                    record.id === current.id
                      ? { ...record, status: 'posted' }
                      : record,
                  ),
                })
              }
            >
              <FileCheck2 aria-hidden="true" />
              {copy.tax.post}
            </Button>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{copy.tax.noResult}</p>
        )}
      </Panel>
      {current && ['posted', 'paid'].includes(current.status) ? (
        <Panel
          title={copy.tax.instruction}
          description={copy.tax.instructionNote}
        >
          <ResultTable
            labels={[copy.common.account, copy.common.amount]}
            rows={[
              {
                id: 'iban',
                label: copy.tax.iban,
                values: ['80 1010 0071 2222 1000 0010 6700'],
              },
              {
                id: 'amount',
                label: copy.common.amount,
                values: [money(current.amount)],
              },
              {
                id: 'title',
                label: copy.tax.paymentTitle,
                values: [`${current.kind} ${current.period} — DEMO`],
              },
            ]}
          />
          {current.status === 'posted' ? (
            <Form
              id="tax-payment-form"
              fields={[
                field('paidAt', copy.tax.paidAt),
                field('reference', copy.tax.reference),
              ]}
              initialValues={{ paidAt: '2026-10-15', reference: '' }}
              label={copy.tax.markPaid}
              onSubmit={(values) => {
                const paidAt = textValue(values, 'paidAt')
                const reference = textValue(values, 'reference')
                if (
                  !validDate(paidAt) ||
                  paidAt > new Date().toISOString().slice(0, 10) ||
                  !reference
                )
                  throw createCrudFormError(copy.tax.paymentError)
                update({
                  ...state,
                  records: state.records.map((record) =>
                    record.id === current.id
                      ? { ...record, status: 'paid', paidAt, reference }
                      : record,
                  ),
                })
              }}
            />
          ) : (
            <Alert status="information" style="stroke">
              {copy.tax.confirmed} {current.paidAt} — {current.reference}
            </Alert>
          )}
        </Panel>
      ) : null}
      {state.records.length ? (
        <Panel title={copy.tax.history}>
          <DataTable
            columns={[
              { id: 'version', header: copy.tax.version, accessorKey: 'id' },
              { id: 'kind', header: copy.tax.kind, accessorKey: 'kind' },
              {
                id: 'period',
                header: copy.common.period,
                accessorKey: 'period',
              },
              {
                id: 'amount',
                header: copy.common.amount,
                cell: ({ row }) => money(row.original.amount),
              },
              {
                id: 'status',
                header: copy.common.status,
                meta: { truncate: false },
                cell: ({ row }) => (
                  <FinanceStatusBadge>
                    {statusNames[row.original.status]}
                  </FinanceStatusBadge>
                ),
              },
              {
                id: 'open',
                header: copy.common.details,
                cell: ({ row }) => (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      update({ ...state, selected: row.original.id })
                    }
                  >
                    {copy.common.details}
                  </Button>
                ),
              },
            ]}
            data={state.records}
          />
        </Panel>
      ) : null}
    </div>
  )
}

const sourceInvoices = [
  {
    id: 'new',
    number: 'FZ/10/2026/101',
    supplier: 'Cloudspace Poland',
    nip: '6342901762',
    net: 200000,
    vat: 46000,
    date: '2026-10-01',
  },
  {
    id: 'duplicate',
    number: 'FZ/09/2026/091',
    supplier: 'Polstar Logistyka',
    nip: '5223082211',
    net: 700000,
    vat: 161000,
    date: '2026-09-24',
  },
  {
    id: 'blocked',
    number: 'FV/10/2026/18',
    supplier: 'Nord GmbH',
    nip: 'DE123456789',
    net: 100000,
    vat: 0,
    date: '2026-10-02',
  },
]
function KsefDraft({
  state,
  update,
}: {
  state: State
  update: (next: State) => void
}) {
  const [duplicate, setDuplicate] = React.useState(false)
  const [opened, setOpened] = React.useState(false)
  const source = sourceInvoices.find((invoice) => invoice.id === state.selected)
  const linked = source ? textValue(state.result, `link-${source.id}`) : ''
  return (
    <div className="space-y-6">
      <Panel title={copy.ksef.title} description={copy.ksef.description}>
        <DataTable
          data={sourceInvoices}
          columns={[
            { id: 'number', header: copy.ksef.number, accessorKey: 'number' },
            {
              id: 'supplier',
              header: copy.ksef.supplier,
              accessorKey: 'supplier',
            },
            {
              id: 'gross',
              header: copy.ksef.gross,
              cell: ({ row }) => money(row.original.net + row.original.vat),
            },
            {
              id: 'status',
              header: copy.common.status,
              cell: ({ row }) => (
                <FinanceStatusBadge>
                  {state.result[`link-${row.original.id}`]
                    ? copy.ksef.linked
                    : row.original.id === 'blocked'
                      ? copy.ksef.needsVendor
                      : row.original.id === 'duplicate'
                        ? copy.ksef.knownDuplicate
                        : copy.ksef.received}
                </FinanceStatusBadge>
              ),
            },
            {
              id: 'open',
              header: copy.common.details,
              cell: ({ row }) => (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    update({ ...state, selected: row.original.id })
                    setDuplicate(false)
                    setOpened(false)
                  }}
                >
                  {copy.common.details}
                </Button>
              ),
            },
          ]}
        />
      </Panel>
      {source ? (
        <Panel title={source.number} description={source.supplier}>
          <ResultTable
            labels={[copy.ksef.source, copy.common.amount]}
            rows={[
              { id: 'nip', label: copy.ksef.nip, values: [source.nip] },
              {
                id: 'ksef',
                label: copy.ksef.ksef,
                values: [`DEMO-${source.id}-2026`],
              },
              { id: 'net', label: copy.ksef.net, values: [money(source.net)] },
              { id: 'vat', label: copy.ksef.vat, values: [money(source.vat)] },
              {
                id: 'gross',
                label: copy.ksef.gross,
                values: [money(source.net + source.vat)],
              },
            ]}
          />
          {source.id === 'blocked' ? (
            <Alert status="warning" style="stroke">
              {copy.ksef.blocked}
            </Alert>
          ) : linked ? (
            <div className="space-y-4">
              <FinanceStatusBadge>
                {copy.ksef.linked} — {linked}
              </FinanceStatusBadge>
              <div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpened(true)}
                >
                  <ArrowRight aria-hidden="true" />
                  {copy.ksef.open}
                </Button>
              </div>
            </div>
          ) : (
            <>
              {source.id === 'new' ? (
                <Alert status="information" style="stroke">
                  {copy.ksef.pending}
                </Alert>
              ) : null}
              <Form
                key={source.id}
                id="ksef-draft-form"
                fields={[
                  field('expense', copy.ksef.expense, 'select', accountOptions),
                  field('due', copy.ksef.due),
                ]}
                initialValues={{
                  expense: '',
                  due: '2026-10-31',
                  ...(state.form.source === source.id ? state.form : {}),
                }}
                label={copy.ksef.create}
                onSubmit={(values) => {
                  if (!values.expense)
                    throw createCrudFormError(copy.common.required)
                  const due = textValue(values, 'due')
                  if (!validDate(due) || due < source.date)
                    throw createCrudFormError(copy.ksef.dueError)
                  if (source.id === 'duplicate') {
                    setDuplicate(true)
                    update({
                      ...state,
                      form: { ...values, source: source.id },
                    })
                    return
                  }
                  update({
                    ...state,
                    form: { ...values, source: source.id },
                    result: {
                      ...state.result,
                      [`link-${source.id}`]: source.number,
                      [`expense-${source.id}`]: textValue(values, 'expense'),
                      [`due-${source.id}`]: due,
                    },
                  })
                  setOpened(true)
                }}
              />
              {duplicate ? (
                <Alert status="warning" style="stroke">
                  <div className="space-y-3">
                    <p>{copy.ksef.duplicate}</p>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        update({
                          ...state,
                          result: {
                            ...state.result,
                            [`link-${source.id}`]: source.number,
                            [`expense-${source.id}`]: '402',
                            [`due-${source.id}`]: '2026-10-24',
                          },
                        })
                        setDuplicate(false)
                        setOpened(true)
                      }}
                    >
                      <Link2 aria-hidden="true" />
                      {copy.ksef.link}
                    </Button>
                  </div>
                </Alert>
              ) : null}
            </>
          )}
        </Panel>
      ) : null}
      {opened && source && linked ? (
        <Panel
          title={`${copy.ksef.draftTitle} — ${linked}`}
          description={copy.ksef.draftNote}
        >
          <ResultTable
            labels={[copy.ksef.source, copy.common.amount]}
            rows={[
              {
                id: 'supplier',
                label: copy.ksef.supplier,
                values: [source.supplier],
              },
              { id: 'date', label: copy.ksef.date, values: [source.date] },
              {
                id: 'due',
                label: copy.ksef.due,
                values: [textValue(state.result, `due-${source.id}`)],
              },
              {
                id: 'account',
                label: copy.ksef.expense,
                values: [textValue(state.result, `expense-${source.id}`)],
              },
              {
                id: 'gross',
                label: copy.ksef.gross,
                values: [money(source.net + source.vat)],
              },
            ]}
          />
          <FinanceStatusBadge>{copy.common.draft}</FinanceStatusBadge>
        </Panel>
      ) : null}
    </div>
  )
}

function VatReconciliation({
  state,
  update,
  goTo,
}: {
  state: State
  update: (next: State) => void
  goTo: (screenId: string) => void
}) {
  const rows: DisplayRow[] = [
    {
      id: 'input',
      label: copy.reconcile.input,
      values: [money(23000000), money(22977000), money(23000)],
    },
    {
      id: 'output',
      label: copy.reconcile.output,
      values: [money(30200000), money(30200000), money(0)],
    },
  ]
  return (
    <div className="space-y-6">
      <Panel
        title={copy.reconcile.title}
        description={copy.reconcile.description}
      >
        <Form
          id="vat-reconciliation-form"
          fields={[
            field('period', copy.common.period, 'select', [
              { value: '2026-09', label: copy.tax.september },
              { value: '2026-Q3', label: copy.reconcile.quarter },
            ]),
            field(
              'inputAccount',
              copy.reconcile.inputAccount,
              'select',
              accountOptions,
            ),
            field(
              'outputAccount',
              copy.reconcile.outputAccount,
              'select',
              accountOptions,
            ),
          ]}
          initialValues={{
            period: '2026-09',
            inputAccount: '',
            outputAccount: '',
            ...state.form,
          }}
          label={copy.reconcile.run}
          onSubmit={(values) => {
            if (
              values.period !== '2026-09' ||
              !values.inputAccount ||
              !values.outputAccount ||
              values.inputAccount === values.outputAccount
            )
              throw createCrudFormError(copy.reconcile.error)
            update({ ...state, form: values, status: 'generated' })
          }}
        />
      </Panel>
      {state.status === 'generated' ? (
        <Panel
          title={copy.reconcile.settings}
          description={String(state.form.period)}
        >
          <ResultTable
            labels={[
              copy.reconcile.side,
              copy.reconcile.register,
              copy.reconcile.ledger,
              copy.reconcile.difference,
            ]}
            rows={rows}
          />
          <Alert status="information" style="stroke">
            {copy.reconcile.inputHint} {copy.reconcile.notes}
          </Alert>
          <Button type="button" variant="outline" onClick={() => goTo('s37')}>
            {copy.reconcile.jpk}
            <ArrowRight aria-hidden="true" />
          </Button>
        </Panel>
      ) : (
        <p className="text-sm text-muted-foreground">
          {copy.reconcile.missing}
        </p>
      )}
    </div>
  )
}

function JpkBooks({
  state,
  update,
}: {
  state: State
  update: (next: State) => void
}) {
  const [outcome, setOutcome] = React.useState('success')
  const [sending, setSending] = React.useState(false)
  const [error, setError] = React.useState(false)
  const [deliveryOpen, setDeliveryOpen] = React.useState(false)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
  const fields = [
    field('year', copy.jpk.year, 'select', [
      { value: '2025', label: '2025' },
      { value: '2026', label: '2026' },
    ]),
    field('purpose', copy.jpk.purpose, 'select', [
      { value: 'initial', label: copy.jpk.initial },
      { value: 'correction', label: copy.jpk.correction },
    ]),
    field('nip', copy.jpk.nip),
    field('office', copy.jpk.office),
    field('marker', copy.jpk.mapping, 'select', [
      { value: '', label: copy.statements.unmapped },
      { value: 'result', label: copy.jpk.marker },
    ]),
    ...copy.jpk.rpd.map((label, index) => field(`rpd${index + 1}`, label)),
  ]
  const rows = copy.jpk.sections.map((label, index) => ({
    id: String(index),
    label,
    values: [String([5, 4, 8, 8][index])],
  }))
  const rpdRows = copy.jpk.rpd.map((label, index) => [
    label,
    String(state.form[`rpd${index + 1}`] ?? '0'),
  ])
  return (
    <div className="space-y-6">
      <Panel title={copy.jpk.title} description={copy.jpk.description}>
        <p className="text-sm text-muted-foreground">
          {copy.jpk.mappingHint} {copy.jpk.rpdHint}
        </p>
        {state.status === 'submitted' ? (
          <Alert status="information" style="stroke">
            {copy.jpk.immutable}
          </Alert>
        ) : (
          <Form
            id="jpk-books-form"
            fields={fields}
            initialValues={{
              year: '2025',
              purpose: 'initial',
              nip: '1000001069',
              office: '1471',
              marker: '',
              ...Object.fromEntries(
                copy.jpk.rpd.map((_, index) => [`rpd${index + 1}`, '0']),
              ),
              ...state.form,
            }}
            label={copy.jpk.generate}
            onSubmit={(values) => {
              if (
                !['2025', '2026'].includes(textValue(values, 'year')) ||
                !validNip(textValue(values, 'nip')) ||
                !/^\d{4}$/.test(textValue(values, 'office'))
              )
                throw createCrudFormError(copy.jpk.invalid)
              if (values.marker !== 'result')
                throw createCrudFormError(copy.jpk.mappingMissing)
              const amounts = copy.jpk.rpd.map((_, index) =>
                cents(values[`rpd${index + 1}`]),
              )
              update({
                ...state,
                form: values,
                status: 'generated',
                result: { zero: amounts.every((amount) => amount === 0) },
              })
              setError(false)
              setDeliveryOpen(false)
            }}
          />
        )}
      </Panel>
      {['generated', 'submitted'].includes(state.status) ? (
        <Panel
          title={copy.jpk.control}
          description={`${state.form.year} — ${state.form.purpose === 'correction' ? copy.jpk.correction : copy.jpk.initial}`}
        >
          <FinanceStatusBadge>
            {state.status === 'submitted'
              ? copy.jpk.submitted
              : copy.jpk.generated}
          </FinanceStatusBadge>
          {state.result.zero ? (
            <Alert status="warning" style="stroke">
              {copy.jpk.zeroWarning}
            </Alert>
          ) : null}
          <ResultTable
            labels={[copy.jpk.section, copy.jpk.count]}
            rows={rows}
          />
          <p className="text-sm text-muted-foreground">{copy.jpk.sample}</p>
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                downloadSample(`JPK-KR-PD-${state.form.year}`, [
                  [copy.jpk.year, String(state.form.year)],
                  [copy.jpk.purpose, String(state.form.purpose)],
                  ...rpdRows,
                ])
              }
            >
              <Download aria-hidden="true" />
              {copy.common.download}
            </Button>
            {state.status !== 'submitted' ? (
              <Button
                type="button"
                variant="primary-filled"
                onClick={() => setDeliveryOpen(true)}
              >
                {copy.jpk.simulate}
              </Button>
            ) : null}
          </div>
          {deliveryOpen && state.status !== 'submitted' ? (
            <div className="space-y-4 border-t border-border pt-6">
              <SegmentedControl
                className="h-auto w-full flex-col rounded-lg p-1 sm:w-fit sm:flex-row sm:rounded-full"
                value={outcome}
                onValueChange={setOutcome}
                aria-label={copy.jpk.outcome}
              >
                <SegmentedControlItem
                  className="h-auto min-h-7 rounded-md py-1 sm:rounded-full"
                  value="success"
                >
                  {copy.jpk.success}
                </SegmentedControlItem>
                <SegmentedControlItem
                  className="h-auto min-h-7 rounded-md py-1 sm:rounded-full"
                  value="failure"
                >
                  {copy.jpk.failure}
                </SegmentedControlItem>
              </SegmentedControl>
              <Button
                type="button"
                variant="primary-filled"
                disabled={sending}
                onClick={() => {
                  if (sending) return
                  setSending(true)
                  setError(false)
                  timer.current = setTimeout(() => {
                    setSending(false)
                    if (outcome === 'failure') {
                      setError(true)
                      return
                    }
                    update({
                      ...state,
                      status: 'submitted',
                      result: {
                        ...state.result,
                        reference: `DEMO-KR-${state.form.year}-${state.form.purpose === 'correction' ? '02' : '01'}`,
                      },
                    })
                  }, 350)
                }}
              >
                {sending ? copy.jpk.working : copy.jpk.send}
              </Button>
              {error ? (
                <Alert status="warning" style="stroke">
                  {copy.jpk.rejected}
                </Alert>
              ) : null}
            </div>
          ) : null}
          {state.status === 'submitted' ? (
            <>
              <Alert status="information" style="stroke">
                {copy.jpk.accepted}
              </Alert>
              <p className="text-sm">
                {copy.jpk.reference}: {state.result.reference}
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  update({
                    ...state,
                    form: { ...state.form, purpose: 'correction' },
                    status: 'draft',
                    previousReference: textValue(state.result, 'reference'),
                    result: {},
                  })
                  setDeliveryOpen(false)
                }}
              >
                {copy.jpk.newCorrection}
              </Button>
            </>
          ) : null}
          {state.previousReference ? (
            <p className="text-sm text-muted-foreground">
              {copy.jpk.prior}: {state.previousReference}
            </p>
          ) : null}
        </Panel>
      ) : null}
    </div>
  )
}

function AnnualStatements({
  state,
  update,
}: {
  state: State
  update: (next: State) => void
}) {
  const [view, setView] = React.useState('bilans')
  const [resolutionOpen, setResolutionOpen] = React.useState(false)
  const generated = state.status === 'generated'
  const year = textValue(state.form, 'year') || '2025'
  const isProfit = year === '2025'
  const result = isProfit ? 25000000 : -4000000
  const resolutionTitle = isProfit
    ? copy.statements.resolution
    : copy.statements.lossResolution
  const retainedLabel = isProfit
    ? copy.statements.retained
    : copy.statements.carriedLoss
  const dividendLabel = isProfit
    ? copy.statements.dividend
    : copy.statements.coveredReserve
  const invalid = state.form.mapping === 'assets'
  const comparative = state.form.comparative === true && isProfit
  const assets = isProfit ? 130000000 : 96000000
  const liabilities = assets
  const rows: DisplayRow[] =
    view === 'bilans'
      ? [
          {
            id: 'cash',
            label: copy.statements.cash,
            values: [
              money(isProfit ? 70000000 : 96000000),
              comparative ? money(96000000) : '—',
            ],
          },
          {
            id: 'receivable',
            label: copy.statements.receivable,
            values: [
              money(isProfit ? 60000000 : 0),
              comparative ? money(0) : '—',
            ],
          },
          ...(invalid
            ? [
                {
                  id: 'wrong',
                  label: copy.statements.wrongLine,
                  values: [money(result), '—'],
                },
              ]
            : []),
          {
            id: 'assets',
            label: copy.statements.assets,
            values: [
              money(assets + (invalid ? result : 0)),
              comparative ? money(96000000) : '—',
            ],
          },
          {
            id: 'capital',
            label: copy.statements.capital,
            values: [money(100000000), comparative ? money(100000000) : '—'],
          },
          {
            id: 'profit',
            label: copy.statements.profit,
            values: [
              money(invalid ? 0 : result),
              comparative ? money(-4000000) : '—',
            ],
          },
          {
            id: 'payables',
            label: copy.statements.payables,
            values: [
              money(isProfit ? 5000000 : 0),
              comparative ? money(0) : '—',
            ],
          },
          {
            id: 'liabilities',
            label: copy.statements.liabilities,
            values: [
              money(liabilities - (invalid ? result : 0)),
              comparative ? money(96000000) : '—',
            ],
          },
        ]
      : [
          {
            id: 'revenue',
            label: copy.statements.revenue,
            values: [
              money(isProfit ? 60000000 : 6000000),
              comparative ? money(6000000) : '—',
            ],
          },
          {
            id: 'cost',
            label:
              view === 'nature'
                ? copy.statements.cost
                : copy.statements.costFunction,
            values: [
              money(isProfit ? 35000000 : 10000000),
              comparative ? money(10000000) : '—',
            ],
          },
          {
            id: 'net',
            label: copy.statements.profit,
            values: [money(result), comparative ? money(-4000000) : '—'],
          },
        ]
  return (
    <div className="space-y-6">
      <Panel
        title={copy.statements.title}
        description={copy.statements.description}
      >
        <p className="text-sm text-muted-foreground">
          {copy.statements.conditions}
        </p>
        <Form
          id="annual-statement-form"
          fields={[
            field('year', copy.statements.year, 'select', [
              { value: '2024', label: '2024' },
              { value: '2025', label: '2025' },
              { value: '2026', label: '2026' },
            ]),
            field(
              'comparative',
              copy.statements.comparative,
              'checkbox',
              undefined,
              false,
            ),
            field('mapping', copy.statements.mapping, 'select', [
              { value: '', label: copy.statements.unmapped },
              { value: 'result', label: copy.statements.resultLine },
              { value: 'assets', label: copy.statements.wrongLine },
            ]),
          ]}
          initialValues={{
            year: '2025',
            comparative: true,
            mapping: '',
            ...state.form,
          }}
          label={copy.statements.generate}
          onSubmit={(values) => {
            if (values.year === '2026')
              throw createCrudFormError(copy.statements.locked)
            if (!values.mapping)
              throw createCrudFormError(copy.statements.missing)
            update({
              ...state,
              form: values,
              status: 'generated',
              result: state.form.year === values.year ? state.result : {},
            })
          }}
        />
      </Panel>
      <Panel title={copy.statements.mappingTitle}>
        <ResultTable
          labels={[copy.statements.account, copy.statements.line]}
          rows={[
            { id: '130', label: '130 — Wn', values: [copy.statements.cash] },
            {
              id: '200A',
              label: '200-A — Wn',
              values: [copy.statements.receivable],
            },
            {
              id: '200B',
              label: '200-B — Ma',
              values: [copy.statements.payables],
            },
            { id: '801', label: '801 — Ma', values: [copy.statements.capital] },
            {
              id: '860',
              label: '860 — Ma / Wn',
              values: [
                !state.form.mapping
                  ? copy.statements.unmapped
                  : invalid
                    ? copy.statements.wrongLine
                    : copy.statements.resultLine,
              ],
            },
          ]}
        />
      </Panel>
      {generated ? (
        <Panel
          title={`${year} — ${copy.statements.title}`}
          description={copy.statements.basis}
        >
          <Alert status={invalid ? 'warning' : 'information'} style="stroke">
            {invalid ? copy.statements.invalid : copy.statements.valid}
          </Alert>
          {!comparative ? (
            <p className="text-sm text-muted-foreground">
              {isProfit
                ? copy.statements.noComparative
                : copy.statements.firstYear}
            </p>
          ) : null}
          <SegmentedControl
            className="h-auto w-full flex-col rounded-lg p-1 sm:w-fit sm:flex-row sm:rounded-full"
            value={view}
            onValueChange={setView}
            aria-label={copy.statements.title}
          >
            <SegmentedControlItem
              className="h-auto min-h-7 rounded-md py-1 sm:rounded-full"
              value="bilans"
            >
              {copy.statements.bilans}
            </SegmentedControlItem>
            <SegmentedControlItem
              className="h-auto min-h-7 rounded-md py-1 sm:rounded-full"
              value="nature"
            >
              {copy.statements.nature}
            </SegmentedControlItem>
            <SegmentedControlItem
              className="h-auto min-h-7 rounded-md py-1 sm:rounded-full"
              value="function"
            >
              {copy.statements.function}
            </SegmentedControlItem>
          </SegmentedControl>
          <ResultTable
            labels={[
              copy.statements.line,
              `${copy.statements.current} ${year}`,
              `${copy.statements.previous} ${Number(year) - 1}`,
            ]}
            rows={rows}
          />
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={invalid}
              onClick={() =>
                downloadSample(`sprawozdanie-${year}-${view}`, [
                  [copy.statements.line, year, String(Number(year) - 1)],
                  ...rows.map((row) => [row.label, ...row.values]),
                ])
              }
            >
              <Download aria-hidden="true" />
              {copy.common.download}
            </Button>
            {!invalid && !state.result.recorded ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => setResolutionOpen(true)}
              >
                {resolutionTitle}
              </Button>
            ) : null}
          </div>
          {!isProfit ? (
            <p className="text-sm text-muted-foreground">
              {copy.statements.loss}
            </p>
          ) : null}
        </Panel>
      ) : (
        <p className="text-sm text-muted-foreground">{copy.statements.empty}</p>
      )}
      {generated && !invalid && (resolutionOpen || state.result.recorded) ? (
        <Panel
          title={resolutionTitle}
          description={copy.statements.resolutionHint}
        >
          {state.result.recorded ? (
            <>
              <Alert status="information" style="stroke">
                {copy.statements.recorded}
              </Alert>
              <ResultTable
                labels={[copy.statements.line, copy.common.amount]}
                rows={[
                  {
                    id: 'retained',
                    label: retainedLabel,
                    values: [money(Number(state.result.retained))],
                  },
                  {
                    id: 'dividend',
                    label: dividendLabel,
                    values: [money(Number(state.result.dividend))],
                  },
                  {
                    id: 'note',
                    label: copy.statements.note,
                    values: [textValue(state.result, 'note')],
                  },
                  {
                    id: 'attachment',
                    label: copy.statements.attachment,
                    values: [textValue(state.result, 'attachment') || '—'],
                  },
                ]}
              />
            </>
          ) : (
            <Form
              id="closing-resolution-form"
              fields={[
                field('retained', retainedLabel),
                field('dividend', dividendLabel),
                field('note', copy.statements.note),
                field(
                  'attachment',
                  copy.statements.attachment,
                  'text',
                  undefined,
                  false,
                ),
              ]}
              initialValues={{
                retained: String(Math.abs(result) / 100),
                dividend: '0',
                note: '',
                attachment: '',
              }}
              label={copy.statements.record}
              onSubmit={(values) => {
                const retained = cents(values.retained)
                const dividend = cents(values.dividend)
                if (
                  retained + dividend !== Math.abs(result) ||
                  !textValue(values, 'note')
                )
                  throw createCrudFormError(copy.statements.sumError)
                update({
                  ...state,
                  result: {
                    recorded: true,
                    retained,
                    dividend,
                    note: textValue(values, 'note'),
                    attachment: textValue(values, 'attachment'),
                  },
                })
              }}
            />
          )}
        </Panel>
      ) : null}
    </div>
  )
}

export function TaxSpecWorkflows({
  screenId,
  goTo,
}: {
  screenId: string
  goTo: (screenId: string) => void
}) {
  return <TaxSpecWorkflow key={screenId} screenId={screenId} goTo={goTo} />
}
function TaxSpecWorkflow({
  screenId,
  goTo,
}: {
  screenId: string
  goTo: (screenId: string) => void
}) {
  const { state, update, ready, storageError, reset } = useStored(screenId)
  const [generation, setGeneration] = React.useState(0)
  if (!ready) return <LoadingMessage label={copy.common.loading} />
  return (
    <div className="space-y-6" data-testid={`tax-spec-${screenId}`}>
      <div key={generation}>
        {screenId === 's53' ? (
          <TaxLiabilities state={state} update={update} />
        ) : screenId === 's54' ? (
          <KsefDraft state={state} update={update} />
        ) : screenId === 's55' ? (
          <VatReconciliation state={state} update={update} goTo={goTo} />
        ) : screenId === 's56' ? (
          <JpkBooks state={state} update={update} />
        ) : (
          <AnnualStatements state={state} update={update} />
        )}
      </div>
      {storageError ? (
        <Alert status="error" style="stroke">
          {copy.common.storage}
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6">
        <p className="text-xs text-muted-foreground">{copy.common.local}</p>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            reset()
            setGeneration((value) => value + 1)
          }}
        >
          <RotateCcw aria-hidden="true" />
          {copy.common.reset}
        </Button>
      </div>
    </div>
  )
}
