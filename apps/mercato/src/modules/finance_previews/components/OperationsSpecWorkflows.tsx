'use client'

import * as React from 'react'
import { z } from 'zod'
import { pl } from 'date-fns/locale'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import {
  ArrowRight,
  BookOpen,
  CalendarClock,
  Check,
  RotateCcw,
} from 'lucide-react'
import type { CrudField } from '@open-mercato/ui/backend/CrudForm'
import { FinanceCrudForm as CrudForm } from './FinanceCrudForm'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '@open-mercato/ui/primitives/card'
import { Progress } from '@open-mercato/ui/primitives/progress'
import { FinanceStatusBadge } from './FinanceStatusBadge'
import copy from '../data/operations-spec-copy.json'
import {
  addMonths,
  balancedEntry,
  invertEntry,
  isDate,
  journalSchema,
  money,
  monthlySchedule,
  numeric,
  rounded,
  scheduleRowSchema,
  serviceSchedule,
  valueSchema,
  type FormValues,
  type JournalLine,
  type ScheduleRow,
} from '../lib/operations-spec'

const common = copy.common
const assetEventSchema = z.object({
  id: z.string(),
  kind: z.enum(['revision', 'impairment', 'reversal', 'disposal']),
  date: z.string(),
  reason: z.string(),
  amount: z.number(),
  original: z.string().nullable(),
  details: valueSchema,
})
type AssetEvent = z.infer<typeof assetEventSchema>
const workflowSchema = z.object({
  values: valueSchema.nullable(),
  stage: z.enum([
    'draft',
    'preview',
    'active',
    'completed',
    'stopped',
    'cancelled',
    'disposed',
  ]),
  schedule: z.array(scheduleRowSchema),
  journal: z.array(journalSchema),
  asOf: z.string(),
  correction: z.boolean(),
  assetEvents: z.array(assetEventSchema).default([]),
  capitalizationId: z.string().default('OT'),
})
type WorkflowState = z.infer<typeof workflowSchema>
const initialWorkflow: WorkflowState = {
  values: null,
  stage: 'draft',
  schedule: [],
  journal: [],
  asOf: '2026-09-30',
  correction: false,
  assetEvents: [],
  capitalizationId: 'OT',
}

function useStoredState<State>(
  key: string,
  schema: z.ZodType<State>,
  initial: State,
) {
  const [state, setState] = React.useState<State>(initial)
  const [ready, setReady] = React.useState(false)
  const reference = React.useRef(initial)
  React.useEffect(() => {
    try {
      const stored = window.sessionStorage.getItem(key)
      if (stored) {
        const result = schema.safeParse(JSON.parse(stored))
        if (result.success) {
          reference.current = result.data
          setState(result.data)
        }
      }
    } catch {
      reference.current = initial
      setState(initial)
    }
    setReady(true)
  }, [key, schema, initial])
  const save = (next: State) => {
    try {
      window.sessionStorage.setItem(key, JSON.stringify(next))
    } catch {
      throw createCrudFormError(common.storage)
    }
    reference.current = next
    setState(next)
  }
  return { state, ready, save }
}

function field(
  id: string,
  label: string,
  type: 'text' | 'number' | 'date' | 'checkbox' = 'text',
): CrudField {
  return {
    id,
    label,
    type,
    layout: type === 'checkbox' ? 'full' : 'half',
    required: type !== 'checkbox',
    ...(type === 'date' ? { locale: pl } : {}),
  }
}
function choice(
  id: string,
  label: string,
  options: [string, string][],
): CrudField {
  return {
    id,
    label,
    type: 'select',
    required: true,
    layout: 'half',
    options: options.map(([value, optionLabel]) => ({
      value,
      label: optionLabel,
    })),
  }
}
function valuesFrom(raw: Record<string, unknown>): FormValues {
  const result = valueSchema.safeParse(raw)
  if (!result.success) throw createCrudFormError(common.invalid)
  return result.data
}
function requireFields(values: FormValues, keys: string[]) {
  if (keys.some((key) => !String(values[key] ?? '').trim()))
    throw createCrudFormError(common.invalid)
}
function positive(values: FormValues, key: string) {
  const amount = numeric(values[key])
  if (!Number.isFinite(amount) || amount <= 0)
    throw createCrudFormError(common.invalid, { [key]: common.invalid })
  return amount
}
function nonnegative(values: FormValues, key: string) {
  const amount = numeric(values[key])
  if (!Number.isFinite(amount) || amount < 0)
    throw createCrudFormError(common.invalid, { [key]: common.invalid })
  return amount
}

function Panel({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <Card className="min-w-0 gap-0 py-0">
      <CardHeader className="p-6 pb-4">
        <CardTitle className="text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent className="min-w-0 space-y-6 p-6 pt-0">
        {children}
      </CardContent>
    </Card>
  )
}
function Feedback({
  children,
  error = false,
}: {
  children: React.ReactNode
  error?: boolean
}) {
  return (
    <Alert status={error ? 'error' : 'information'} style="stroke" size="sm">
      {children}
    </Alert>
  )
}
function Summary({ items }: { items: [string, string][] }) {
  return (
    <dl className="grid gap-6 rounded-lg border border-border bg-background p-6 sm:grid-cols-3">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt className="text-sm text-muted-foreground">{label}</dt>
          <dd className="mt-2 text-xl font-semibold tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  )
}
function Reset({ onReset }: { onReset: () => void }) {
  return (
    <Button type="button" variant="outline" onClick={onReset}>
      <RotateCcw className="size-4" />
      {common.reset}
    </Button>
  )
}
const journalColumns: ColumnDef<JournalLine, unknown>[] = [
  { id: 'date', header: common.date, accessorKey: 'date' },
  {
    id: 'description',
    header: common.description,
    accessorKey: 'description',
    meta: { truncate: false },
  },
  { id: 'account', header: common.account, accessorKey: 'account' },
  {
    id: 'debit',
    header: common.debit,
    accessorKey: 'debit',
    cell: ({ row }) => (
      <span className="tabular-nums">{money(row.original.debit)}</span>
    ),
  },
  {
    id: 'credit',
    header: common.credit,
    accessorKey: 'credit',
    cell: ({ row }) => (
      <span className="tabular-nums">{money(row.original.credit)}</span>
    ),
  },
]
function Journal({ rows }: { rows: JournalLine[] }) {
  return (
    <Panel title={common.journalTitle}>
      <div
        tabIndex={0}
        aria-label={common.scrollTable}
        className="min-w-0 max-w-full overflow-x-auto"
      >
        <p className="mb-3 text-xs text-muted-foreground sm:hidden">
          {common.scrollTable}
        </p>
        <DataTable
          embedded
          columns={journalColumns}
          data={rows}
          emptyState={<EmptyState title={common.empty} size="sm" />}
        />
      </div>
      <div className="flex flex-wrap justify-end gap-6 border-t border-border pt-4 text-sm font-semibold tabular-nums">
        <span>
          {common.debit}: {money(rows.reduce((sum, row) => sum + row.debit, 0))}
        </span>
        <span>
          {common.credit}:{' '}
          {money(rows.reduce((sum, row) => sum + row.credit, 0))}
        </span>
      </div>
    </Panel>
  )
}
const scheduleColumns: ColumnDef<ScheduleRow, unknown>[] = [
  {
    id: 'period',
    header: common.period,
    accessorFn: (row) => `${row.start} — ${row.end}`,
    meta: { truncate: false },
  },
  {
    id: 'amount',
    header: common.amount,
    accessorKey: 'amount',
    cell: ({ row }) => (
      <span className="tabular-nums">{money(row.original.amount)}</span>
    ),
  },
  {
    id: 'status',
    header: common.status,
    cell: ({ row }) => (
      <FinanceStatusBadge
        variant={row.original.accrued ? 'success' : 'neutral'}
        icon={row.original.accrued ? 'completed' : 'pending'}
      >
        {row.original.accrued ? common.posted : common.planned}
      </FinanceStatusBadge>
    ),
  },
  {
    id: 'journal',
    header: common.journal,
    accessorFn: (row) => row.journal ?? '—',
  },
]
function Schedule({ title, rows }: { title: string; rows: ScheduleRow[] }) {
  const [page, setPage] = React.useState(1)
  return (
    <Panel title={title}>
      <div
        tabIndex={0}
        aria-label={common.scrollTable}
        className="min-w-0 max-w-full overflow-x-auto"
      >
        <p className="mb-3 text-xs text-muted-foreground sm:hidden">
          {common.scrollTable}
        </p>
        <DataTable
          embedded
          columns={scheduleColumns}
          data={rows.slice((page - 1) * 12, page * 12)}
          pagination={{
            page,
            pageSize: 12,
            total: rows.length,
            totalPages: Math.max(1, Math.ceil(rows.length / 12)),
            onPageChange: setPage,
          }}
          emptyState={<EmptyState title={common.empty} size="sm" />}
        />
      </div>
    </Panel>
  )
}

const assetDefaults: FormValues = {
  name: copy.asset.name,
  acquisition: '2026-09-01',
  value: 60000,
  salvage: 0,
  months: 60,
  start: '2026-09-01',
  source: 'ap',
  reference: copy.asset.apReference,
  assetAccount: '010',
  accumulatedAccount: '070',
  expenseAccount: '400',
  offsetAccount: '300',
  impairmentAccount: '075',
  otherExpenseAccount: '761',
  otherIncomeAccount: '760',
  proceedsAccount: '201',
  threshold: 10000,
  otNumber: 'OT/2026/042',
  otDate: '2026-09-01',
  periodLocked: false,
}
const assetFields: CrudField[] = [
  field('name', common.name),
  field('acquisition', copy.asset.acquisition, 'date'),
  field('value', copy.asset.value, 'number'),
  field('salvage', copy.asset.salvage, 'number'),
  field('months', copy.asset.months, 'number'),
  field('start', copy.asset.start, 'date'),
  choice('source', copy.asset.source, [
    ['ap', copy.asset.ap],
    ['manual', copy.asset.manual],
    ['opening', copy.asset.opening],
    ['contribution', copy.asset.contribution],
  ]),
  {
    ...field('reference', copy.asset.reference),
    visibleWhen: { field: 'source', equals: 'ap' },
  },
  field('assetAccount', copy.asset.assetAccount),
  field('accumulatedAccount', copy.asset.accumulatedAccount),
  field('expenseAccount', copy.asset.expenseAccount),
  field('offsetAccount', copy.asset.offsetAccount),
  field('impairmentAccount', copy.assetLifecycle.impairmentAccount),
  field('otherExpenseAccount', copy.assetLifecycle.otherExpenseAccount),
  field('otherIncomeAccount', copy.assetLifecycle.otherIncomeAccount),
  field('proceedsAccount', copy.assetLifecycle.proceedsAccount),
  {
    ...field('threshold', copy.asset.threshold, 'number'),
    description: copy.asset.thresholdHint,
  },
  field('otNumber', copy.asset.otNumber),
  field('otDate', copy.asset.otDate, 'date'),
  field('periodLocked', common.periodLocked, 'checkbox'),
]

function AssetWorkflow() {
  const { state, save, ready } = useStoredState(
    'finance-preview-operations-asset-v1',
    workflowSchema,
    initialWorkflow,
  )
  const [feedback, setFeedback] = React.useState('')
  const [formVersion, setFormVersion] = React.useState(0)
  const values = { ...assetDefaults, ...state.values }
  const value = numeric(values.value)
  const oneTime = value <= numeric(values.threshold)
  const accrued = rounded(
    state.schedule
      .filter((row) => row.accrued)
      .reduce((sum, row) => sum + row.amount, 0),
  )
  if (!ready) return <LoadingMessage label={common.loading} />
  return (
    <div className="space-y-6" data-testid="operations-asset">
      <p className="text-sm text-muted-foreground">{copy.asset.hint}</p>
      {feedback && <Feedback>{feedback}</Feedback>}
      {state.stage === 'draft' && (
        <Panel title={copy.asset.formTitle}>
          <CrudForm<Record<string, unknown>>
            key={formVersion}
            formId="operations-asset-form"
            embedded
            fields={assetFields}
            initialValues={values}
            submitLabel={common.preview}
            onSubmit={(raw) => {
              const next = valuesFrom(raw)
              requireFields(next, [
                'name',
                'assetAccount',
                'accumulatedAccount',
                'expenseAccount',
                'offsetAccount',
                'otNumber',
              ])
              const cost = positive(next, 'value')
              const salvage = nonnegative(next, 'salvage')
              const months = positive(next, 'months')
              nonnegative(next, 'threshold')
              if (salvage >= cost)
                throw createCrudFormError(copy.asset.invalidSalvage, {
                  salvage: copy.asset.invalidSalvage,
                })
              if (
                !Number.isInteger(months) ||
                months > 120 ||
                !isDate(next.start) ||
                !isDate(next.acquisition) ||
                !isDate(next.otDate) ||
                next.otDate < next.acquisition ||
                next.start < next.acquisition
              )
                throw createCrudFormError(common.invalid)
              if (next.source === 'ap' && !next.reference)
                throw createCrudFormError(copy.asset.sourceRequired)
              const rows =
                cost <= numeric(next.threshold)
                  ? monthlySchedule(cost, next.start, 1)
                  : monthlySchedule(cost - salvage, next.start, months)
              save({
                ...state,
                stage: 'preview',
                values: next,
                schedule: rows,
              })
              setFeedback('')
            }}
          />
        </Panel>
      )}
      {state.values && (
        <>
          <Summary
            items={[
              [copy.asset.value, money(value)],
              [common.recognized, money(accrued)],
              [
                copy.asset.nbv,
                money(
                  state.stage === 'disposed'
                    ? 0
                    : value - accrued - netImpairment(state.assetEvents),
                ),
              ],
            ]}
          />
          <div className="flex flex-wrap items-center gap-4">
            <FinanceStatusBadge
              variant={state.stage === 'preview' ? 'neutral' : 'success'}
            >
              {state.stage === 'preview'
                ? common.previewStatus
                : state.stage === 'disposed'
                  ? copy.assetLifecycle.disposed
                  : state.stage === 'completed'
                    ? common.completed
                    : common.active}
            </FinanceStatusBadge>
            <span className="text-sm text-muted-foreground">
              {oneTime ? copy.asset.oneTime : copy.asset.linear}
            </span>
          </div>
          {state.stage === 'preview' && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                save({ ...state, stage: 'draft' })
                setFormVersion((current) => current + 1)
              }}
            >
              {common.edit}
            </Button>
          )}
          {state.stage === 'preview' && (
            <Button
              type="button"
              variant="primary-filled"
              onClick={() => {
                if (values.periodLocked) {
                  setFeedback(common.locked)
                  return
                }
                const capitalizationId = `OT-${state.journal.length + 1}`
                const acceptance = balancedEntry(
                  capitalizationId,
                  String(values.acquisition),
                  copy.asset.acquisitionJournal,
                  String(values.assetAccount),
                  String(values.offsetAccount),
                  value,
                )
                const depreciation = oneTime
                  ? balancedEntry(
                      'AM-1',
                      String(values.start),
                      copy.asset.depreciationJournal,
                      String(values.expenseAccount),
                      String(values.accumulatedAccount),
                      value,
                    )
                  : []
                save({
                  ...state,
                  stage: oneTime ? 'completed' : 'active',
                  capitalizationId,
                  schedule: state.schedule.map((row) =>
                    oneTime
                      ? { ...row, accrued: true, journal: 'AM/2026/001' }
                      : row,
                  ),
                  journal: [...state.journal, ...acceptance, ...depreciation],
                })
                setFeedback(copy.asset.accepted)
              }}
            >
              <Check className="size-4" />
              {copy.asset.accept}
            </Button>
          )}
          <Schedule
            title={copy.asset.schedule}
            rows={
              state.stage === 'disposed'
                ? state.schedule.filter((row) => row.accrued)
                : state.schedule
            }
          />
          {state.stage === 'active' && (
            <Panel title={common.accrue}>
              <AccrualForm
                asOf={state.asOf}
                onSubmit={(date, locked) => {
                  if (locked) {
                    setFeedback(common.skipped)
                    return
                  }
                  const due = state.schedule.filter(
                    (row) => !row.accrued && row.end <= date,
                  )
                  const ids = new Set(due.map((row) => row.id))
                  save({
                    ...state,
                    asOf: date,
                    stage: state.schedule.every(
                      (row) => row.accrued || ids.has(row.id),
                    )
                      ? 'completed'
                      : 'active',
                    schedule: state.schedule.map((row) =>
                      ids.has(row.id)
                        ? {
                            ...row,
                            accrued: true,
                            journal: `AM/2026/${row.id.padStart(3, '0')}`,
                          }
                        : row,
                    ),
                    journal: [
                      ...state.journal,
                      ...due.flatMap((row) =>
                        balancedEntry(
                          `AM-${row.id}`,
                          row.end,
                          copy.asset.depreciationJournal,
                          String(values.expenseAccount),
                          String(values.accumulatedAccount),
                          row.amount,
                        ),
                      ),
                    ],
                  })
                  setFeedback(due.length ? common.accrued : common.nothingDue)
                }}
              />
              {accrued === 0 && state.assetEvents.length === 0 && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    save({
                      ...state,
                      stage: 'draft',
                      schedule: [],
                      journal: [
                        ...state.journal,
                        ...invertEntry(
                          state.journal.filter(
                            (row) =>
                              row.id === `${state.capitalizationId}-d` ||
                              row.id === `${state.capitalizationId}-c`,
                          ),
                          `${state.capitalizationId}-REV`,
                          String(values.otDate),
                          copy.asset.reopened,
                        ),
                      ],
                    })
                    setFormVersion((current) => current + 1)
                    setFeedback(copy.asset.reopened)
                  }}
                >
                  {copy.asset.reopen}
                </Button>
              )}
            </Panel>
          )}
          {['active', 'completed', 'disposed'].includes(state.stage) && (
            <AssetLifecycle state={state} save={save} />
          )}
          {state.journal.length > 0 && <Journal rows={state.journal} />}
        </>
      )}
      <Reset
        onReset={() => {
          save(initialWorkflow)
          setFeedback('')
          setFormVersion((current) => current + 1)
        }}
      />
    </div>
  )
}

const lifecycle = copy.assetLifecycle
function netImpairment(events: AssetEvent[]) {
  return rounded(
    events.reduce(
      (sum, event) =>
        sum +
        (event.kind === 'impairment'
          ? event.amount
          : event.kind === 'reversal'
            ? -event.amount
            : 0),
      0,
    ),
  )
}
function impairmentRemainder(events: AssetEvent[], original: AssetEvent) {
  return rounded(
    original.amount -
      events
        .filter(
          (event) =>
            event.kind === 'reversal' && event.original === original.id,
        )
        .reduce((sum, event) => sum + event.amount, 0),
  )
}
function replaceAssetTail(
  rows: ScheduleRow[],
  base: number,
  months: number,
  revision: string,
) {
  const posted = rows.filter((row) => row.accrued)
  const future = rows.filter((row) => !row.accrued)
  if (!future.length) return rows
  return [
    ...posted,
    ...monthlySchedule(base, future[0].start, months).map((row) => ({
      ...row,
      id: `${revision}-${row.id}`,
    })),
  ]
}
function planAssetOperation(
  state: WorkflowState,
  kind: AssetEvent['kind'],
  input: FormValues,
): WorkflowState {
  if (!['active', 'completed'].includes(state.stage))
    throw createCrudFormError(common.invalid)
  const values = { ...assetDefaults, ...state.values }
  const date = input.date
  requireFields(input, ['reason'])
  if (
    !isDate(date) ||
    date < String(values.otDate) ||
    state.journal.some((row) => row.date > date)
  )
    throw createCrudFormError(lifecycle.dateError)
  if (kind !== 'revision' && input.periodLocked)
    throw createCrudFormError(common.locked)
  const id = `ST-${state.assetEvents.length + 1}`
  const cost = numeric(values.value)
  const salvage = numeric(values.salvage)
  const accrued = rounded(
    state.schedule
      .filter((row) => row.accrued)
      .reduce((sum, row) => sum + row.amount, 0),
  )
  const impairment = netImpairment(state.assetEvents)
  const carrying = rounded(cost - accrued - impairment)
  const future = state.schedule.filter((row) => !row.accrued)
  const event: AssetEvent = {
    id,
    kind,
    date,
    reason: String(input.reason).trim(),
    amount: 0,
    original: null,
    details: {},
  }
  let next: WorkflowState = {
    ...state,
    values,
    assetEvents: [...state.assetEvents, event],
  }
  if (kind === 'revision') {
    if (
      state.stage !== 'active' ||
      cost <= numeric(values.threshold) ||
      !future.length
    )
      throw createCrudFormError(lifecycle.noTail)
    const months = positive(input, 'months')
    const newSalvage = nonnegative(input, 'salvage')
    if (!Number.isInteger(months) || months > 120)
      throw createCrudFormError(common.invalid)
    const base = rounded(carrying - newSalvage)
    if (base < 0) throw createCrudFormError(lifecycle.negativeBase)
    event.details = {
      months,
      salvage: newSalvage,
      previousSalvage: salvage,
      previousRemainingMonths: future.length,
    }
    next = {
      ...next,
      values: {
        ...values,
        months: state.schedule.filter((row) => row.accrued).length + months,
        salvage: newSalvage,
      },
      schedule: replaceAssetTail(state.schedule, base, months, id),
    }
  } else if (kind === 'impairment' || kind === 'reversal') {
    requireFields(values, [
      'impairmentAccount',
      'otherExpenseAccount',
      'otherIncomeAccount',
    ])
    let delta = 0
    if (kind === 'impairment') {
      requireFields(input, ['trigger'])
      if (
        ![
          'WITHDRAWAL_FROM_USE',
          'PERMANENT_DAMAGE',
          'TECHNOLOGY_CHANGE',
          'FINANCIAL_DETERIORATION',
        ].includes(String(input.trigger))
      )
        throw createCrudFormError(common.invalid)
      const recoverable = nonnegative(input, 'recoverable')
      if (
        recoverable >= carrying ||
        (state.stage === 'active' && recoverable < salvage)
      )
        throw createCrudFormError(lifecycle.invalidLoss)
      event.amount = rounded(carrying - recoverable)
      event.details = {
        trigger: input.trigger,
        carryingBefore: carrying,
        recoverable,
      }
      delta = event.amount
    } else {
      const original = state.assetEvents.find(
        (record) =>
          record.id === input.original && record.kind === 'impairment',
      )
      const amount = positive(input, 'amount')
      if (
        !original ||
        amount > impairmentRemainder(state.assetEvents, original)
      )
        throw createCrudFormError(lifecycle.reversalLimit)
      event.amount = amount
      event.original = original.id
      delta = -amount
    }
    next = {
      ...next,
      schedule: replaceAssetTail(
        state.schedule,
        rounded(carrying - delta - salvage),
        future.length,
        id,
      ),
      journal: [
        ...state.journal,
        ...balancedEntry(
          id,
          date,
          lifecycle[kind],
          String(
            kind === 'impairment'
              ? values.otherExpenseAccount
              : values.impairmentAccount,
          ),
          String(
            kind === 'impairment'
              ? values.impairmentAccount
              : values.otherIncomeAccount,
          ),
          event.amount,
        ),
      ],
    }
  } else {
    requireFields(values, [
      'assetAccount',
      'accumulatedAccount',
      'impairmentAccount',
      'otherExpenseAccount',
      'otherIncomeAccount',
    ])
    if (
      !['SALE', 'LIQUIDATION', 'DONATION', 'SHORTAGE'].includes(
        String(input.type),
      )
    )
      throw createCrudFormError(common.invalid)
    const lockedPeriods = String(input.lockedBefore ?? '')
      .split(',')
      .map((period) => period.trim())
      .filter(Boolean)
    if (
      lockedPeriods.some(
        (period) =>
          !/^\d{4}-(0[1-9]|1[0-2])$/.test(period) || period >= date.slice(0, 7),
      )
    )
      throw createCrudFormError(lifecycle.invalidLocked)
    const due = future.filter((row) => row.end <= date)
    const skipped = due.filter((row) =>
      lockedPeriods.includes(row.end.slice(0, 7)),
    )
    const catchup = due.filter(
      (row) => !lockedPeriods.includes(row.end.slice(0, 7)),
    )
    const catchupAmount = rounded(
      catchup.reduce((sum, row) => sum + row.amount, 0),
    )
    const accumulated = rounded(accrued + catchupAmount)
    const nbv = rounded(cost - accumulated - impairment)
    const proceeds = input.type === 'SALE' ? nonnegative(input, 'proceeds') : 0
    if (input.type === 'SALE') requireFields(values, ['proceedsAccount'])
    const result = rounded(proceeds - nbv)
    const legs: JournalLine[] = []
    const leg = (account: unknown, debit: number, credit: number) => {
      if (debit || credit)
        legs.push({
          id: `${id}-${legs.length + 1}`,
          date,
          description: lifecycle.disposal,
          account: String(account),
          debit,
          credit,
        })
    }
    leg(values.accumulatedAccount, accumulated, 0)
    leg(values.impairmentAccount, impairment, 0)
    leg(values.assetAccount, 0, cost)
    leg(values.proceedsAccount, proceeds, 0)
    leg(values.otherExpenseAccount, Math.max(0, -result), 0)
    leg(values.otherIncomeAccount, 0, Math.max(0, result))
    event.amount = proceeds
    event.details = {
      type: input.type,
      nbv,
      gainLoss: result,
      catchup: catchupAmount,
      skipped: skipped.length,
      skippedPeriods: skipped.map((row) => row.end.slice(0, 7)).join(', '),
      accumulated,
      impairment,
    }
    next = {
      ...next,
      stage: 'disposed',
      schedule: state.schedule.map((row) =>
        catchup.some((record) => record.id === row.id)
          ? { ...row, accrued: true, journal: `${id}-AM-${row.id}` }
          : row,
      ),
      journal: [
        ...state.journal,
        ...catchup.flatMap((row) =>
          balancedEntry(
            `${id}-AM-${row.id}`,
            row.end,
            copy.asset.depreciationJournal,
            String(values.expenseAccount),
            String(values.accumulatedAccount),
            row.amount,
          ),
        ),
        ...legs,
      ],
    }
  }
  return next
}
function AssetLifecycle({
  state,
  save,
}: {
  state: WorkflowState
  save: (next: WorkflowState) => void
}) {
  const [action, setAction] = React.useState<AssetEvent['kind'] | null>(null)
  const [preview, setPreview] = React.useState<WorkflowState | null>(null)
  const [feedback, setFeedback] = React.useState('')
  React.useEffect(() => {
    setPreview(null)
  }, [state])
  const values = { ...assetDefaults, ...state.values }
  const remaining =
    state.stage === 'disposed'
      ? 0
      : state.schedule.filter((row) => !row.accrued).length
  const originals = state.assetEvents.filter(
    (event) =>
      event.kind === 'impairment' &&
      impairmentRemainder(state.assetEvents, event) > 0,
  )
  const event = preview?.assetEvents.at(-1)
  const newJournal = preview?.journal.slice(state.journal.length) ?? []
  const fields: CrudField[] = [
    field('date', lifecycle.date, 'date'),
    field('reason', lifecycle.reason),
  ]
  if (action === 'revision')
    fields.push(
      field('months', lifecycle.months, 'number'),
      field('salvage', lifecycle.salvage, 'number'),
    )
  if (action === 'impairment')
    fields.push(
      choice('trigger', lifecycle.trigger, [
        ['WITHDRAWAL_FROM_USE', lifecycle.withdrawal],
        ['PERMANENT_DAMAGE', lifecycle.damage],
        ['TECHNOLOGY_CHANGE', lifecycle.technology],
        ['FINANCIAL_DETERIORATION', lifecycle.financial],
      ]),
      field('recoverable', lifecycle.recoverable, 'number'),
    )
  if (action === 'reversal')
    fields.push(
      choice(
        'original',
        lifecycle.original,
        originals.map((original) => [
          original.id,
          `${original.date} · ${original.reason} · ${lifecycle.remaining}: ${money(impairmentRemainder(state.assetEvents, original))}`,
        ]),
      ),
      field('amount', lifecycle.amount, 'number'),
    )
  if (action === 'disposal')
    fields.push(
      choice('type', lifecycle.type, [
        ['SALE', lifecycle.sale],
        ['LIQUIDATION', lifecycle.liquidation],
        ['DONATION', lifecycle.donation],
        ['SHORTAGE', lifecycle.shortage],
      ]),
      {
        ...field('proceeds', lifecycle.proceeds, 'number'),
        visibleWhen: { field: 'type', equals: 'SALE' },
      },
      {
        ...field('lockedBefore', lifecycle.lockedBefore),
        required: false,
        description: lifecycle.lockedHint,
      },
    )
  if (action && action !== 'revision')
    fields.push(field('periodLocked', common.periodLocked, 'checkbox'))
  const columns: ColumnDef<AssetEvent>[] = [
    { accessorKey: 'date', header: lifecycle.date },
    {
      accessorKey: 'kind',
      header: lifecycle.operation,
      cell: ({ row }) => (
        <FinanceStatusBadge variant="neutral">
          {lifecycle[row.original.kind]}
        </FinanceStatusBadge>
      ),
    },
    { accessorKey: 'reason', header: lifecycle.reason },
    {
      accessorKey: 'amount',
      header: common.amount,
      cell: ({ row }) =>
        row.original.kind === 'revision' ? '—' : money(row.original.amount),
    },
  ]
  return (
    <Panel title={lifecycle.title}>
      {feedback && <Feedback>{feedback}</Feedback>}
      <Summary
        items={[
          [lifecycle.netImpairment, money(netImpairment(state.assetEvents))],
          [lifecycle.months, String(remaining)],
        ]}
      />
      {state.stage !== 'disposed' && !action && (
        <div className="flex flex-wrap gap-3">
          {(['revision', 'impairment', 'reversal', 'disposal'] as const).map(
            (kind) => (
              <Button
                key={kind}
                variant="outline"
                disabled={
                  (kind === 'revision' &&
                    (!remaining || state.stage !== 'active')) ||
                  (kind === 'reversal' && !originals.length)
                }
                onClick={() => {
                  setAction(kind)
                  setFeedback('')
                }}
              >
                {kind === 'reversal' ? (
                  <RotateCcw className="size-4" />
                ) : (
                  <BookOpen className="size-4" />
                )}
                {lifecycle[kind]}
              </Button>
            ),
          )}
        </div>
      )}
      {action && !preview && (
        <>
          <p className="text-sm text-muted-foreground">
            {lifecycle[`${action}Hint`]}
          </p>
          <CrudForm<Record<string, unknown>>
            key={action}
            embedded
            formId="operations-asset-lifecycle"
            fields={fields}
            initialValues={{
              date: '2026-09-30',
              reason: '',
              months: remaining,
              salvage: values.salvage,
              recoverable: 50000,
              trigger: 'PERMANENT_DAMAGE',
              original: originals[0]?.id ?? '',
              amount: 1000,
              type: 'SALE',
              proceeds: 45000,
              lockedBefore: '',
              periodLocked: false,
            }}
            submitLabel={common.preview}
            onSubmit={(raw) => {
              setPreview(planAssetOperation(state, action, valuesFrom(raw)))
            }}
          />
        </>
      )}
      {preview && event && (
        <div className="space-y-6" data-testid="asset-lifecycle-preview">
          <h3 className="font-semibold">
            {lifecycle.preview} · {lifecycle[event.kind]}
          </h3>
          {event.kind === 'disposal' ? (
            <Summary
              items={[
                [copy.asset.nbv, money(numeric(event.details.nbv))],
                [lifecycle.gainLoss, money(numeric(event.details.gainLoss))],
                [lifecycle.catchup, money(numeric(event.details.catchup))],
              ]}
            />
          ) : (
            <Summary
              items={[
                [
                  lifecycle.nbv,
                  money(
                    numeric(values.value) -
                      preview.schedule
                        .filter((row) => row.accrued)
                        .reduce((sum, row) => sum + row.amount, 0) -
                      netImpairment(preview.assetEvents),
                  ),
                ],
                [
                  lifecycle.months,
                  String(preview.schedule.filter((row) => !row.accrued).length),
                ],
              ]}
            />
          )}
          {numeric(event.details.skipped) > 0 && (
            <Feedback>
              {lifecycle.skipped}: {String(event.details.skipped)} ·{' '}
              {String(event.details.skippedPeriods)}
            </Feedback>
          )}
          {newJournal.length > 0 && <Journal rows={newJournal} />}
          <div className="flex flex-wrap gap-3">
            <Button
              variant="primary-filled"
              onClick={() => {
                save(preview)
                setPreview(null)
                setAction(null)
                setFeedback(lifecycle.confirmed)
              }}
            >
              <Check className="size-4" />
              {lifecycle.confirm}
            </Button>
            <Button variant="outline" onClick={() => setPreview(null)}>
              {common.edit}
            </Button>
          </div>
        </div>
      )}
      {action && (
        <Button
          variant="outline"
          onClick={() => {
            setAction(null)
            setPreview(null)
          }}
        >
          {lifecycle.cancel}
        </Button>
      )}
      {state.assetEvents.length > 0 && (
        <div
          tabIndex={0}
          aria-label={common.scrollTable}
          className="min-w-0 max-w-full overflow-x-auto"
        >
          <p className="mb-3 text-xs text-muted-foreground sm:hidden">
            {common.scrollTable}
          </p>
          <DataTable<AssetEvent>
            title={lifecycle.history}
            columns={columns}
            data={state.assetEvents}
          />
        </div>
      )}
    </Panel>
  )
}

function AccrualForm({
  asOf,
  onSubmit,
  correction = false,
}: {
  asOf: string
  onSubmit: (date: string, locked: boolean, correction: boolean) => void
  correction?: boolean
}) {
  const fields = [
    field('asOf', common.asOf, 'date'),
    field('periodLocked', common.periodLocked, 'checkbox'),
    ...(correction
      ? [field('correction', copy.schedule.correction, 'checkbox')]
      : []),
  ]
  return (
    <CrudForm<Record<string, unknown>>
      formId="operations-accrual-form"
      embedded
      fields={fields}
      initialValues={{ asOf, periodLocked: false, correction: false }}
      submitLabel={common.accrue}
      onSubmit={(raw) => {
        if (!isDate(raw.asOf)) throw createCrudFormError(common.invalid)
        onSubmit(raw.asOf, Boolean(raw.periodLocked), Boolean(raw.correction))
      }}
    />
  )
}

function ScheduledWorkflow({ kind }: { kind: 'cost' | 'revenue' }) {
  const revenue = kind === 'revenue'
  const { state, save, ready } = useStoredState(
    `finance-preview-operations-${kind}-v1`,
    workflowSchema,
    initialWorkflow,
  )
  const [feedback, setFeedback] = React.useState('')
  const [formVersion, setFormVersion] = React.useState(0)
  const defaults: FormValues = {
    name: revenue ? copy.schedule.revenueName : copy.schedule.costName,
    invoice: revenue ? copy.schedule.invoiceRevenue : copy.schedule.invoiceCost,
    amount: 12000,
    start: '2026-09-01',
    end: '2027-08-31',
    original: revenue ? '700' : '409',
    deferred: revenue ? '840' : '640',
    currency: 'PLN',
    sourcePosted: true,
    periodLocked: false,
  }
  const values = state.values ?? defaults
  const amount = numeric(values.amount)
  const recognized = rounded(
    state.schedule
      .filter((row) => row.accrued)
      .reduce((sum, row) => sum + row.amount, 0),
  )
  const remaining =
    state.stage === 'stopped' || state.stage === 'cancelled'
      ? 0
      : rounded(amount - recognized)
  const fields: CrudField[] = [
    field('name', common.name),
    field('invoice', copy.schedule.invoice),
    field('amount', copy.schedule.net, 'number'),
    choice('currency', common.currency, [
      ['PLN', 'PLN'],
      ['EUR', 'EUR'],
    ]),
    field('start', copy.schedule.start, 'date'),
    field('end', copy.schedule.end, 'date'),
    field('original', copy.schedule.original),
    field('deferred', copy.schedule.deferred),
    field('sourcePosted', copy.schedule.sourcePosted, 'checkbox'),
    field('periodLocked', common.periodLocked, 'checkbox'),
  ]
  if (!ready) return <LoadingMessage label={common.loading} />
  return (
    <div className="space-y-6" data-testid={`operations-${kind}`}>
      <p className="text-sm text-muted-foreground">
        {revenue ? copy.schedule.revenueHint : copy.schedule.costHint}
      </p>
      {!revenue && (
        <p className="text-xs text-muted-foreground">
          {copy.schedule.costAssumption}
        </p>
      )}
      {feedback && <Feedback error={state.correction}>{feedback}</Feedback>}
      {state.stage === 'draft' && (
        <Panel
          title={revenue ? copy.schedule.revenueTitle : copy.schedule.costTitle}
        >
          <CrudForm<Record<string, unknown>>
            key={formVersion}
            formId={`operations-${kind}-form`}
            embedded
            fields={fields}
            initialValues={values}
            submitLabel={common.preview}
            onSubmit={(raw) => {
              const next = valuesFrom(raw)
              requireFields(next, ['name', 'invoice', 'original', 'deferred'])
              const total = positive(next, 'amount')
              if (next.currency !== 'PLN')
                throw createCrudFormError(copy.schedule.currencyError)
              if (!next.sourcePosted)
                throw createCrudFormError(copy.schedule.sourceError)
              if (
                !isDate(next.start) ||
                !isDate(next.end) ||
                next.end < next.start ||
                next.end >= addMonths(next.start, 120)
              )
                throw createCrudFormError(copy.schedule.periodError)
              save({
                ...state,
                values: next,
                stage: 'preview',
                schedule: serviceSchedule(total, next.start, next.end),
              })
              setFeedback('')
            }}
          />
        </Panel>
      )}
      {state.values && (
        <>
          <Summary
            items={[
              [common.total, money(amount)],
              [
                common.recognized,
                money(state.stage === 'stopped' ? amount : recognized),
              ],
              [common.remaining, money(remaining)],
            ]}
          />
          <Progress
            value={amount ? ((amount - remaining) / amount) * 100 : 0}
            tone="accent"
            label={common.recognized}
            showValue
          />
          <div className="flex flex-wrap items-center gap-4">
            <FinanceStatusBadge
              variant={
                state.stage === 'preview' || state.stage === 'cancelled'
                  ? 'neutral'
                  : 'info'
              }
            >
              {state.stage === 'preview'
                ? common.previewStatus
                : state.stage === 'stopped'
                  ? common.stopped
                  : state.stage === 'cancelled'
                    ? common.cancelled
                    : state.stage === 'completed'
                      ? common.completed
                      : common.active}
            </FinanceStatusBadge>
            <span className="text-sm text-muted-foreground">
              {copy.schedule.note}
            </span>
          </div>
          {state.stage === 'preview' && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                save({ ...state, stage: 'draft' })
                setFormVersion((current) => current + 1)
              }}
            >
              {common.edit}
            </Button>
          )}
          {state.stage === 'preview' && (
            <Button
              type="button"
              variant="primary-filled"
              onClick={() => {
                if (values.periodLocked) {
                  setFeedback(common.locked)
                  return
                }
                save({
                  ...state,
                  stage: 'active',
                  journal: revenue
                    ? balancedEntry(
                        'RMP-RECLASS',
                        String(values.start),
                        copy.schedule.reclassification,
                        String(values.original),
                        String(values.deferred),
                        amount,
                      )
                    : [],
                })
                setFeedback(copy.schedule.activated)
              }}
            >
              <Check className="size-4" />
              {copy.schedule.activate}
            </Button>
          )}
          <Schedule title={copy.schedule.title} rows={state.schedule} />
          {state.stage === 'active' && (
            <>
              <Panel title={common.accrue}>
                <AccrualForm
                  asOf={state.asOf}
                  correction={revenue}
                  onSubmit={(date, locked, correction) => {
                    if (correction || state.correction) {
                      save({ ...state, correction: true })
                      setFeedback(copy.schedule.correctionError)
                      return
                    }
                    if (locked) {
                      setFeedback(common.skipped)
                      return
                    }
                    const due = state.schedule.filter(
                      (row) => !row.accrued && row.end <= date,
                    )
                    const ids = new Set(due.map((row) => row.id))
                    save({
                      ...state,
                      asOf: date,
                      stage: state.schedule.every(
                        (row) => row.accrued || ids.has(row.id),
                      )
                        ? 'completed'
                        : 'active',
                      schedule: state.schedule.map((row) =>
                        ids.has(row.id)
                          ? {
                              ...row,
                              accrued: true,
                              journal: `${revenue ? 'RMP' : 'RMK'}/2026/${row.id.padStart(3, '0')}`,
                            }
                          : row,
                      ),
                      journal: [
                        ...state.journal,
                        ...due.flatMap((row) =>
                          balancedEntry(
                            `${kind}-${row.id}`,
                            row.end,
                            copy.schedule.recognition,
                            String(revenue ? values.deferred : values.original),
                            String(revenue ? values.original : values.deferred),
                            row.amount,
                          ),
                        ),
                      ],
                    })
                    setFeedback(due.length ? common.accrued : common.nothingDue)
                  }}
                />
              </Panel>
              {revenue && (
                <Panel title={copy.schedule.stop}>
                  <p className="text-sm text-muted-foreground">
                    {copy.schedule.policyHint}
                  </p>
                  <CrudForm<Record<string, unknown>>
                    formId="operations-revenue-stop"
                    embedded
                    fields={[
                      field('stopDate', copy.schedule.stopDate, 'date'),
                      field('policy', copy.schedule.policy, 'checkbox'),
                      field('periodLocked', common.periodLocked, 'checkbox'),
                    ]}
                    initialValues={{
                      stopDate: '2026-10-15',
                      policy: false,
                      periodLocked: false,
                    }}
                    submitLabel={copy.schedule.stop}
                    onSubmit={(raw) => {
                      if (!raw.policy)
                        throw createCrudFormError(copy.schedule.policyRequired)
                      if (raw.periodLocked)
                        throw createCrudFormError(copy.schedule.stopBlocked)
                      if (state.correction)
                        throw createCrudFormError(copy.schedule.correctionError)
                      const stop = raw.stopDate
                      const last =
                        state.schedule.filter((row) => row.accrued).at(-1)
                          ?.end ?? String(values.start)
                      if (
                        !isDate(stop) ||
                        stop < String(values.start) ||
                        stop >= String(values.end) ||
                        stop < last
                      )
                        throw createCrudFormError(copy.schedule.stopInvalid)
                      const due = state.schedule.filter(
                        (row) => !row.accrued && row.end <= stop,
                      )
                      const dueIds = new Set(due.map((row) => row.id))
                      const afterDue = rounded(
                        remaining -
                          due.reduce((sum, row) => sum + row.amount, 0),
                      )
                      save({
                        ...state,
                        stage: 'stopped',
                        schedule: state.schedule
                          .filter((row) => row.accrued || dueIds.has(row.id))
                          .map((row) =>
                            dueIds.has(row.id)
                              ? {
                                  ...row,
                                  accrued: true,
                                  journal: `RMP/2026/${row.id}`,
                                }
                              : row,
                          ),
                        journal: [
                          ...state.journal,
                          ...due.flatMap((row) =>
                            balancedEntry(
                              `RMP-${row.id}`,
                              row.end,
                              copy.schedule.recognition,
                              String(values.deferred),
                              String(values.original),
                              row.amount,
                            ),
                          ),
                          ...balancedEntry(
                            'RMP-STOP',
                            stop,
                            copy.schedule.stopping,
                            String(values.deferred),
                            String(values.original),
                            afterDue,
                          ),
                        ],
                      })
                      setFeedback(copy.schedule.stopped)
                    }}
                  />
                </Panel>
              )}
              {recognized === 0 && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    save({
                      ...state,
                      stage: 'cancelled',
                      schedule: [],
                      journal: revenue
                        ? [
                            ...state.journal,
                            ...invertEntry(
                              state.journal,
                              'CANCEL',
                              String(values.start),
                              copy.schedule.reversal,
                            ),
                          ]
                        : state.journal,
                    })
                    setFeedback(copy.schedule.cancelled)
                  }}
                >
                  {copy.schedule.cancelDeferral}
                </Button>
              )}
            </>
          )}
          {state.journal.length > 0 && <Journal rows={state.journal} />}
        </>
      )}
      <Reset
        onReset={() => {
          save(initialWorkflow)
          setFeedback('')
          setFormVersion((current) => current + 1)
        }}
      />
    </div>
  )
}

const fxRunSchema = z.object({
  id: z.string(),
  values: valueSchema,
  gain: z.number(),
  loss: z.number(),
  superseded: z.boolean(),
  journal: z.array(journalSchema),
})
const fxSchema = z.object({
  values: valueSchema.nullable(),
  preview: z.boolean(),
  runs: z.array(fxRunSchema),
})
const initialFx: z.infer<typeof fxSchema> = {
  values: null,
  preview: false,
  runs: [],
}
const fxDefaults: FormValues = {
  date: '2026-09-30',
  arOpen: 5000,
  apOpen: 3000,
  arBooked: 4.28,
  apBooked: 4.3,
  rate: 4.34,
  currentOpen: true,
  nextOpen: true,
  sourceAvailable: true,
}
const fxFields: CrudField[] = [
  field('date', copy.fx.date, 'date'),
  field('rate', copy.fx.rate, 'number'),
  field('arOpen', copy.fx.arOpen, 'number'),
  field('arBooked', copy.fx.arBooked, 'number'),
  field('apOpen', copy.fx.apOpen, 'number'),
  field('apBooked', copy.fx.apBooked, 'number'),
  field('currentOpen', copy.fx.currentOpen, 'checkbox'),
  field('nextOpen', copy.fx.nextOpen, 'checkbox'),
  field('sourceAvailable', copy.fx.sourceAvailable, 'checkbox'),
]
type FxRow = {
  id: string
  document: string
  open: number
  booked: number
  valued: number
  delta: number
  control: string
}
const fxColumns: ColumnDef<FxRow, unknown>[] = [
  {
    id: 'document',
    header: common.document,
    accessorKey: 'document',
    meta: { truncate: false },
  },
  {
    id: 'open',
    header: copy.fx.currencyAmount,
    cell: ({ row }) => money(row.original.open, 'EUR'),
  },
  {
    id: 'booked',
    header: copy.fx.booked,
    cell: ({ row }) => money(row.original.booked),
  },
  {
    id: 'valued',
    header: copy.fx.valued,
    cell: ({ row }) => money(row.original.valued),
  },
  {
    id: 'delta',
    header: copy.fx.delta,
    cell: ({ row }) => money(row.original.delta),
  },
  { id: 'control', header: copy.fx.control, accessorKey: 'control' },
]
function fxRows(values: FormValues): FxRow[] {
  return [
    {
      id: 'ar',
      document: copy.fx.ar,
      open: numeric(values.arOpen),
      booked: rounded(numeric(values.arOpen) * numeric(values.arBooked)),
      valued: rounded(numeric(values.arOpen) * numeric(values.rate)),
      delta: rounded(
        numeric(values.arOpen) *
          (numeric(values.rate) - numeric(values.arBooked)),
      ),
      control: '201',
    },
    {
      id: 'ap',
      document: copy.fx.ap,
      open: numeric(values.apOpen),
      booked: rounded(numeric(values.apOpen) * numeric(values.apBooked)),
      valued: rounded(numeric(values.apOpen) * numeric(values.rate)),
      delta: rounded(
        numeric(values.apOpen) *
          (numeric(values.apBooked) - numeric(values.rate)),
      ),
      control: '202',
    },
  ].filter((row) => row.open > 0)
}
function FxWorkflow() {
  const { state, save, ready } = useStoredState(
    'finance-preview-operations-fx-v1',
    fxSchema,
    initialFx,
  )
  const [feedback, setFeedback] = React.useState('')
  const [formVersion, setFormVersion] = React.useState(0)
  const values = state.values ?? fxDefaults
  const rows = fxRows(values)
  const gain = rounded(
    rows
      .filter((row) => row.delta > 0)
      .reduce((sum, row) => sum + row.delta, 0),
  )
  const loss = rounded(
    -rows
      .filter((row) => row.delta < 0)
      .reduce((sum, row) => sum + row.delta, 0),
  )
  const [selectedRun, setSelectedRun] = React.useState<string | null>(null)
  const run =
    state.runs.find((item) => item.id === selectedRun) ?? state.runs.at(-1)
  if (!ready) return <LoadingMessage label={common.loading} />
  const historyColumns: ColumnDef<z.infer<typeof fxRunSchema>, unknown>[] = [
    { id: 'id', header: common.document, accessorKey: 'id' },
    {
      id: 'date',
      header: common.date,
      accessorFn: (item) => String(item.values.date),
    },
    {
      id: 'net',
      header: copy.fx.net,
      cell: ({ row }) => money(row.original.gain - row.original.loss),
    },
    {
      id: 'status',
      header: common.status,
      cell: ({ row }) => (
        <FinanceStatusBadge
          variant={row.original.superseded ? 'neutral' : 'success'}
        >
          {row.original.superseded ? copy.fx.superseded : copy.fx.activeRun}
        </FinanceStatusBadge>
      ),
    },
    {
      id: 'action',
      header: common.journal,
      cell: ({ row }) => (
        <Button
          type="button"
          variant="outline"
          onClick={() => setSelectedRun(row.original.id)}
        >
          <BookOpen className="size-4" />
          {common.journal}
        </Button>
      ),
    },
  ]
  return (
    <div className="space-y-6" data-testid="operations-fx">
      <p className="text-sm text-muted-foreground">{copy.fx.hint}</p>
      {!state.preview && (
        <Panel title={copy.fx.title}>
          <CrudForm<Record<string, unknown>>
            key={formVersion}
            formId="operations-fx-form"
            fields={fxFields}
            initialValues={values}
            embedded
            submitLabel={common.preview}
            onSubmit={(raw) => {
              const next = valuesFrom(raw)
              if (next.date !== '2026-09-30')
                throw createCrudFormError(copy.fx.dateError)
              if (!next.currentOpen) throw createCrudFormError(common.locked)
              if (!next.nextOpen) throw createCrudFormError(copy.fx.nextMissing)
              if (!next.sourceAvailable)
                throw createCrudFormError(copy.fx.sourceMissing)
              positive(next, 'rate')
              nonnegative(next, 'arOpen')
              nonnegative(next, 'apOpen')
              if (numeric(next.arBooked) <= 0 || numeric(next.apBooked) <= 0)
                throw createCrudFormError(copy.fx.missingRate)
              positive(next, 'arBooked')
              positive(next, 'apBooked')
              save({ ...state, values: next, preview: true })
              setFeedback('')
            }}
          />
        </Panel>
      )}
      {feedback && <Feedback>{feedback}</Feedback>}
      {state.preview && (
        <>
          <Summary
            items={[
              [copy.fx.gain, money(gain)],
              [copy.fx.loss, money(loss)],
              [copy.fx.net, money(gain - loss)],
            ]}
          />
          <Panel title={common.previewStatus}>
            <p className="text-sm text-muted-foreground">
              {copy.fx.rateSource} · {String(values.date)}
            </p>
            <div
              tabIndex={0}
              aria-label={common.scrollTable}
              className="min-w-0 max-w-full overflow-x-auto"
            >
              <p className="mb-3 text-xs text-muted-foreground sm:hidden">
                {common.scrollTable}
              </p>
              <DataTable
                embedded
                columns={fxColumns}
                data={rows}
                emptyState={<EmptyState title={copy.fx.noItems} size="sm" />}
              />
            </div>
            {state.runs.length > 0 && <Feedback>{copy.fx.rerunHint}</Feedback>}
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                save({ ...state, preview: false })
                setFormVersion((current) => current + 1)
              }}
            >
              {common.edit}
            </Button>
            <Button
              type="button"
              variant="primary-filled"
              onClick={() => {
                const id = `FX/2026/09/${state.runs.length + 1}`
                const valuation = rows
                  .filter((row) => row.delta !== 0)
                  .flatMap((row) => {
                    const gainAccount = '750'
                    const lossAccount = '751'
                    if (row.id === 'ar')
                      return balancedEntry(
                        `${id}-${row.id}`,
                        String(values.date),
                        copy.fx.valuation,
                        row.delta > 0 ? row.control : lossAccount,
                        row.delta > 0 ? gainAccount : row.control,
                        Math.abs(row.delta),
                      )
                    return balancedEntry(
                      `${id}-${row.id}`,
                      String(values.date),
                      copy.fx.valuation,
                      row.delta > 0 ? row.control : lossAccount,
                      row.delta > 0 ? gainAccount : row.control,
                      Math.abs(row.delta),
                    )
                  })
                const reversal = invertEntry(
                  valuation,
                  `${id}-NEXT`,
                  '2026-10-01',
                  copy.fx.reversal,
                )
                const prior = state.runs.at(-1)
                const cancellations = prior
                  ? prior.journal
                      .filter((row) => !row.id.includes('-CANCEL-'))
                      .map((row) => ({
                        ...row,
                        id: `${id}-CANCEL-${row.id}`,
                        description: copy.fx.superseded,
                        debit: row.credit,
                        credit: row.debit,
                      }))
                  : []
                save({
                  values,
                  preview: false,
                  runs: [
                    ...state.runs.map((item) => ({
                      ...item,
                      superseded: true,
                    })),
                    {
                      id,
                      values,
                      gain,
                      loss,
                      superseded: false,
                      journal: [...cancellations, ...valuation, ...reversal],
                    },
                  ],
                })
                setSelectedRun(id)
                setFeedback(copy.fx.posted)
              }}
            >
              <Check className="size-4" />
              {copy.fx.post}
            </Button>
          </Panel>
        </>
      )}
      {state.runs.length > 0 && (
        <Panel title={copy.fx.history}>
          <div
            tabIndex={0}
            aria-label={common.scrollTable}
            className="min-w-0 max-w-full overflow-x-auto"
          >
            <p className="mb-3 text-xs text-muted-foreground sm:hidden">
              {common.scrollTable}
            </p>
            <DataTable
              embedded
              columns={historyColumns}
              data={state.runs}
              emptyState={<EmptyState title={common.empty} size="sm" />}
            />
          </div>
        </Panel>
      )}
      {run && <Journal rows={run.journal} />}
      <Reset
        onReset={() => {
          save(initialFx)
          setFeedback('')
          setSelectedRun(null)
          setFormVersion((current) => current + 1)
        }}
      />
    </div>
  )
}

const batchSnapshotSchema = z.object({
  reference: z.string(),
  amount: z.number(),
  invoices: z.array(z.string()),
  sentOn: z.string(),
})
type BatchSnapshot = z.infer<typeof batchSnapshotSchema>
const matchSchema = z.object({
  id: z.string(),
  amount: z.number(),
  settled: z.number(),
  overpayment: z.number(),
  gainLoss: z.number(),
  remaining: z.number(),
  mismatch: z.boolean(),
  journal: z.array(journalSchema),
  reference: z.string(),
})
type BankMatch = z.infer<typeof matchSchema>
const bankSchema = z.object({
  confirmed: z.boolean(),
  opening: z.number(),
  closing: z.number(),
  date: z.string(),
  batchAmount: z.number(),
  batch: batchSnapshotSchema.nullable(),
  matches: z.array(matchSchema),
})
const initialBank: z.infer<typeof bankSchema> = {
  confirmed: false,
  opening: 100000,
  closing: 120478,
  date: '2026-09-30',
  batchAmount: 0,
  batch: null,
  matches: [],
}
const sharedBatchSchema = z.object({
  batch: z.object({
    status: z.string(),
    selected: z.array(z.string()),
    sentOn: z.string().optional(),
    invoicePosting: z
      .object({ invoiceId: z.string(), gross: z.number() })
      .optional(),
  }),
  entry: z.object({
    number: z.string(),
    quantity: z.string(),
    unitPrice: z.string(),
    vatRate: z.string(),
    saved: z.boolean(),
  }),
})
function readSentBatch(): BatchSnapshot | null {
  try {
    const raw = window.sessionStorage.getItem(
      'open-mercato-finance-preview-accountant-scenarios-v2',
    )
    if (!raw) return null
    const result = sharedBatchSchema.safeParse(JSON.parse(raw))
    if (!result.success || result.data.batch.status !== 'sent') return null
    const { batch, entry } = result.data
    const fixed: Record<string, number> = {
      'FZ/09/2026/076': 18900,
      'FZ/09/2026/071': 2460,
    }
    const amount = rounded(
      batch.selected.reduce(
        (sum, id) =>
          sum +
          (id === batch.invoicePosting?.invoiceId
            ? batch.invoicePosting.gross
            : id === entry.number
              ? numeric(entry.quantity) *
                numeric(entry.unitPrice) *
                (1 + numeric(entry.vatRate) / 100)
              : (fixed[id] ?? 0)),
        0,
      ),
    )
    if (amount <= 0) return null
    return {
      reference: 'PP/2026/009',
      amount,
      invoices: batch.selected,
      sentOn: batch.sentOn ?? '2026-09-30',
    }
  } catch {
    return null
  }
}
type BankLine = {
  id: string
  description: string
  amount: number
  kind: 'invoice' | 'batch' | 'manual' | 'transfer'
  reference: string
  remaining: number
  currency: string
}
function statementLines(state: z.infer<typeof bankSchema>): BankLine[] {
  const rows: BankLine[] = [
    {
      id: 'eur',
      description: copy.bank.eurDescription,
      amount: 13020,
      kind: 'invoice',
      reference: copy.bank.refEUR,
      remaining: 8000,
      currency: 'EUR',
    },
    {
      id: 'pln',
      description: copy.bank.plnDescription,
      amount: 12500,
      kind: 'invoice',
      reference: copy.bank.refPLN,
      remaining: 12300,
      currency: 'PLN',
    },
    {
      id: 'fee',
      description: copy.bank.feeDescription,
      amount: -42,
      kind: 'manual',
      reference: '292630102',
      remaining: 0,
      currency: 'PLN',
    },
    {
      id: 'transfer',
      description: copy.bank.transferDescription,
      amount: -5000,
      kind: 'transfer',
      reference: '292630103',
      remaining: 0,
      currency: 'PLN',
    },
  ]
  if (state.batch)
    rows.splice(2, 0, {
      id: 'batch',
      description: `${copy.bank.batchDescription} · ${state.batch.invoices.join(', ')}`,
      amount: -state.batchAmount,
      kind: 'batch',
      reference: state.batch.reference,
      remaining: 0,
      currency: 'PLN',
    })
  return rows
}
function bankPreview(
  line: BankLine,
  values: FormValues,
  date: string,
  batch: BatchSnapshot | null,
): BankMatch {
  if (values.type !== line.kind) throw createCrudFormError(copy.bank.typeError)
  if (line.kind === 'invoice' && values.target !== line.reference)
    throw createCrudFormError(copy.bank.typeError)
  const result: BankMatch = {
    id: line.id,
    amount: line.amount,
    settled: 0,
    overpayment: 0,
    gainLoss: 0,
    remaining: line.remaining,
    mismatch: false,
    journal: [],
    reference: line.reference,
  }
  if (line.kind === 'batch') {
    if (!batch) throw createCrudFormError(copy.bank.matchRequired)
    result.mismatch = rounded(Math.abs(line.amount) - batch.amount) !== 0
    return result
  }
  if (line.kind === 'invoice') {
    if (!values.sourcePosted) throw createCrudFormError(copy.bank.postedError)
    const settled = positive(values, 'settled')
    if (settled > line.remaining)
      throw createCrudFormError(copy.bank.settledError)
    const rate = line.currency === 'PLN' ? 1 : numeric(values.rate)
    if (!Number.isFinite(rate) || rate <= 0)
      throw createCrudFormError(copy.bank.rateError)
    const overpayment =
      line.currency === 'PLN'
        ? rounded(line.amount - settled)
        : nonnegative(values, 'overpayment')
    if (overpayment < 0 || overpayment > line.amount)
      throw createCrudFormError(copy.bank.overpaymentError)
    if (overpayment > 0 && !values.overpaymentConfigured)
      throw createCrudFormError(copy.bank.overpaymentError)
    const booked = rounded(settled * rate)
    const gainLoss =
      line.currency === 'PLN' ? 0 : rounded(line.amount - booked - overpayment)
    const journal: JournalLine[] = [
      {
        id: `${line.id}-bank`,
        date,
        description: line.description,
        account: '130-01',
        debit: line.amount,
        credit: 0,
      },
      {
        id: `${line.id}-ar`,
        date,
        description: line.reference,
        account: '201',
        debit: 0,
        credit: booked,
      },
    ]
    if (overpayment > 0)
      journal.push({
        id: `${line.id}-overpay`,
        date,
        description: copy.bank.overpaymentTitle,
        account: '249',
        debit: 0,
        credit: overpayment,
      })
    if (gainLoss !== 0)
      journal.push({
        id: `${line.id}-fx`,
        date,
        description: copy.bank.gainLoss,
        account: gainLoss > 0 ? '750' : '751',
        debit: gainLoss < 0 ? -gainLoss : 0,
        credit: gainLoss > 0 ? gainLoss : 0,
      })
    return {
      ...result,
      settled,
      overpayment,
      gainLoss,
      remaining: rounded(line.remaining - settled),
      journal,
    }
  }
  requireFields(values, ['offset'])
  return {
    ...result,
    journal: balancedEntry(
      line.id,
      date,
      line.description,
      String(values.offset),
      '130-01',
      Math.abs(line.amount),
    ),
  }
}
function BankWorkflow({ goTo }: { goTo: (id: string) => void }) {
  const { state, save, ready } = useStoredState(
    'finance-preview-operations-bank-v1',
    bankSchema,
    initialBank,
  )
  const [sentBatch, setSentBatch] = React.useState<BatchSnapshot | null>(null)
  const [selected, setSelected] = React.useState<string | null>(null)
  const [preview, setPreview] = React.useState<BankMatch | null>(null)
  const [feedback, setFeedback] = React.useState('')
  const [formVersion, setFormVersion] = React.useState(0)
  React.useEffect(() => {
    setSentBatch(readSentBatch())
  }, [])
  const effectiveBatch = state.confirmed ? state.batch : sentBatch
  const pending = state.confirmed
    ? state
    : {
        ...state,
        batch: effectiveBatch,
        batchAmount: effectiveBatch?.amount ?? 0,
      }
  const lines = statementLines(pending)
  const selectedLine = lines.find((line) => line.id === selected)
  const match = state.matches.find((item) => item.id === selected)
  const result = match ?? preview
  const total = rounded(lines.reduce((sum, line) => sum + line.amount, 0))
  const columns: ColumnDef<BankLine, unknown>[] = [
    { id: 'reference', header: common.document, accessorKey: 'reference' },
    {
      id: 'description',
      header: common.description,
      accessorKey: 'description',
      meta: { truncate: false },
    },
    {
      id: 'amount',
      header: common.amount,
      cell: ({ row }) => (
        <span className="tabular-nums">{money(row.original.amount)}</span>
      ),
    },
    {
      id: 'status',
      header: common.status,
      cell: ({ row }) => {
        const item = state.matches.find(
          (matched) => matched.id === row.original.id,
        )
        return (
          <FinanceStatusBadge
            variant={item?.mismatch ? 'warning' : item ? 'success' : 'neutral'}
          >
            {item?.mismatch
              ? copy.bank.mismatch
              : item
                ? copy.bank.matched
                : copy.bank.unmatched}
          </FinanceStatusBadge>
        )
      },
    },
    {
      id: 'action',
      header: common.document,
      cell: ({ row }) => (
        <Button
          type="button"
          variant="outline"
          disabled={!state.confirmed}
          onClick={() => {
            setSelected(row.original.id)
            setPreview(null)
            setFeedback('')
          }}
        >
          <ArrowRight className="size-4" />
          {state.matches.some((item) => item.id === row.original.id)
            ? copy.bank.inspect
            : copy.bank.match}
        </Button>
      ),
    },
  ]
  if (!ready) return <LoadingMessage label={common.loading} />
  const defaults: FormValues = selectedLine
    ? {
        type: selectedLine.kind,
        target: selectedLine.reference,
        settled:
          selectedLine.currency === 'EUR'
            ? 3000
            : Math.min(selectedLine.amount, selectedLine.remaining),
        rate: 4.28,
        overpayment: 0,
        offset: selectedLine.kind === 'transfer' ? '149' : '402-01',
        sourcePosted: true,
        overpaymentConfigured: true,
      }
    : {}
  const matchFields: CrudField[] = [
    choice('type', copy.bank.type, [
      ['invoice', copy.bank.invoice],
      ['batch', copy.bank.batch],
      ['manual', copy.bank.manual],
      ['transfer', copy.bank.transfer],
    ]),
    ...(selectedLine?.kind === 'invoice'
      ? [
          field('target', copy.bank.target),
          field(
            'settled',
            `${copy.bank.settled} (${selectedLine.currency})`,
            'number',
          ),
          ...(selectedLine.currency !== 'PLN'
            ? [
                field('rate', copy.bank.rate, 'number'),
                field('overpayment', copy.bank.overpayment, 'number'),
              ]
            : []),
          field('sourcePosted', copy.bank.sourcePosted, 'checkbox'),
          field(
            'overpaymentConfigured',
            copy.bank.overpaymentConfigured,
            'checkbox',
          ),
        ]
      : selectedLine?.kind === 'batch'
        ? []
        : [field('offset', copy.bank.offset)]),
  ]
  return (
    <div className="space-y-6" data-testid="operations-bank">
      <p className="text-sm text-muted-foreground">{copy.bank.hint}</p>
      {!state.confirmed && (
        <Panel title={copy.bank.header}>
          <CrudForm<Record<string, unknown>>
            key={`${formVersion}-${effectiveBatch?.amount ?? 0}`}
            formId="operations-bank-statement"
            embedded
            fields={[
              field('date', copy.bank.statementDate, 'date'),
              field('opening', copy.bank.opening, 'number'),
              field('closing', copy.bank.closing, 'number'),
              ...(effectiveBatch
                ? [field('batchAmount', copy.bank.batch, 'number')]
                : []),
            ]}
            initialValues={{
              date: state.date,
              opening: state.opening,
              closing: rounded(state.opening + total),
              batchAmount: effectiveBatch?.amount ?? 0,
            }}
            submitLabel={copy.bank.saveStatement}
            onSubmit={(raw) => {
              const next = valuesFrom(raw)
              const opening = numeric(next.opening)
              const closing = numeric(next.closing)
              const batchAmount = effectiveBatch
                ? positive(next, 'batchAmount')
                : 0
              if (
                !isDate(next.date) ||
                !Number.isFinite(opening) ||
                !Number.isFinite(closing)
              )
                throw createCrudFormError(common.invalid)
              const actualTotal = 13020 + 12500 - 42 - 5000 - batchAmount
              if (rounded(opening + actualTotal) !== rounded(closing))
                throw createCrudFormError(copy.bank.balanceError)
              save({
                ...state,
                confirmed: true,
                opening,
                closing,
                date: next.date,
                batch: effectiveBatch,
                batchAmount,
              })
              setFeedback('')
            }}
          />
        </Panel>
      )}
      {state.confirmed && !state.batch && sentBatch ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            save({ ...state, confirmed: false })
            setSelected(null)
            setPreview(null)
          }}
        >
          {copy.bank.attachBatch}
        </Button>
      ) : null}
      {!effectiveBatch && (
        <div className="flex flex-wrap items-center gap-4">
          <Button type="button" variant="outline" onClick={() => goTo('s10')}>
            <ArrowRight className="size-4" />
            {copy.bank.batch}
          </Button>
          <p className="text-sm text-muted-foreground">{copy.bank.batchNote}</p>
        </div>
      )}
      {feedback && <Feedback>{feedback}</Feedback>}
      <Summary
        items={[
          [copy.bank.opening, money(state.opening)],
          [common.total, money(total)],
          [
            copy.bank.closing,
            money(state.confirmed ? state.closing : state.opening + total),
          ],
        ]}
      />
      <Panel title={copy.bank.entries}>
        <p className="text-sm text-muted-foreground">{copy.bank.bankAccount}</p>
        <div
          tabIndex={0}
          aria-label={common.scrollTable}
          className="min-w-0 max-w-full overflow-x-auto"
        >
          <p className="mb-3 text-xs text-muted-foreground sm:hidden">
            {common.scrollTable}
          </p>
          <DataTable
            embedded
            columns={columns}
            data={lines}
            emptyState={<EmptyState title={common.empty} size="sm" />}
          />
        </div>
      </Panel>
      {selectedLine && (
        <Panel title={`${copy.bank.titleMatch} · ${selectedLine.reference}`}>
          <p className="text-sm text-muted-foreground">
            {selectedLine.description} · {money(selectedLine.amount)}
          </p>
          {selectedLine.kind === 'batch' && (
            <Feedback>{copy.bank.batchNote}</Feedback>
          )}
          {selectedLine.currency === 'EUR' && (
            <p className="text-sm text-muted-foreground">
              {copy.bank.bankOnlyPLN}
            </p>
          )}
          {!match && !preview && (
            <CrudForm<Record<string, unknown>>
              key={selectedLine.id}
              formId="operations-bank-match"
              embedded
              fields={matchFields}
              initialValues={defaults}
              submitLabel={copy.bank.preview}
              onSubmit={(raw) => {
                setPreview(
                  bankPreview(
                    selectedLine,
                    valuesFrom(raw),
                    state.date,
                    state.batch,
                  ),
                )
              }}
            />
          )}
          {preview && !match && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setPreview(null)}
            >
              {common.edit}
            </Button>
          )}
          {result && (
            <>
              {selectedLine.kind === 'invoice' && (
                <Summary
                  items={[
                    [
                      copy.bank.remaining,
                      money(result.remaining, selectedLine.currency),
                    ],
                    [copy.bank.gainLoss, money(result.gainLoss)],
                    [copy.bank.overpaymentTitle, money(result.overpayment)],
                  ]}
                />
              )}
              {result.mismatch && (
                <Feedback>
                  {copy.bank.mismatch}:{' '}
                  {money(
                    Math.abs(selectedLine.amount) - (state.batch?.amount ?? 0),
                  )}
                </Feedback>
              )}
              {result.journal.length > 0 && <Journal rows={result.journal} />}
              {match ? (
                <Feedback>{copy.bank.matchedHint}</Feedback>
              ) : (
                <Button
                  type="button"
                  variant="primary-filled"
                  onClick={() => {
                    if (
                      !preview ||
                      state.matches.some((item) => item.id === selectedLine.id)
                    )
                      return
                    save({ ...state, matches: [...state.matches, preview] })
                    setPreview(null)
                    setFeedback(copy.bank.matchedHint)
                  }}
                >
                  <Check className="size-4" />
                  {copy.bank.confirm}
                </Button>
              )}
            </>
          )}
        </Panel>
      )}
      {state.matches.length > 0 && (
        <Panel title={copy.bank.summary}>
          <Summary
            items={[
              [
                copy.bank.matchedCount,
                `${state.matches.length} / ${lines.length}`,
              ],
              [
                copy.bank.warnings,
                String(state.matches.filter((item) => item.mismatch).length),
              ],
              [
                common.journal,
                String(
                  state.matches.filter((item) => item.journal.length > 0)
                    .length,
                ),
              ],
            ]}
          />
          <Progress
            tone="accent"
            value={(state.matches.length / lines.length) * 100}
            label={copy.bank.matchedCount}
            showValue
          />
        </Panel>
      )}
      <Reset
        onReset={() => {
          save(initialBank)
          setSentBatch(readSentBatch())
          setSelected(null)
          setPreview(null)
          setFeedback('')
          setFormVersion((current) => current + 1)
        }}
      />
    </div>
  )
}

export function OperationsSpecWorkflows({
  screenId,
  goTo,
}: {
  screenId: string
  goTo: (id: string) => void
}) {
  return (
    <div className="space-y-6">
      {screenId === 's48' && <AssetWorkflow />}
      {screenId === 's49' && <ScheduledWorkflow key="cost" kind="cost" />}
      {screenId === 's50' && <ScheduledWorkflow key="revenue" kind="revenue" />}
      {screenId === 's51' && <FxWorkflow />}
      {screenId === 's52' && <BankWorkflow goTo={goTo} />}
      <Button type="button" variant="outline" onClick={() => goTo('s6')}>
        <CalendarClock className="size-4" />
        {common.returnClose}
      </Button>
    </div>
  )
}
