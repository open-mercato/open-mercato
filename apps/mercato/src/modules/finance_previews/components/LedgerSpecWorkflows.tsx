'use client'

import * as React from 'react'
import styles from './finance-preview.module.css'
import { z } from 'zod'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import {
  BookOpen,
  CalendarDays,
  Download,
  Eye,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import type { CrudField } from '@open-mercato/ui/backend/CrudForm'
import { FinanceCrudForm as CrudForm } from './FinanceCrudForm'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Card } from '@open-mercato/ui/primitives/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@open-mercato/ui/primitives/segmented-control'
import { FinanceStatusBadge } from './FinanceStatusBadge'
import copy from '../data/ledger-spec-copy.json'
import {
  initialLedgerState,
  ledgerStateSchema,
  ledgerStorageKey,
  starterChart,
  generatePeriods,
  journalEntries,
  reconcile,
  trialBalance,
  validBank,
  validNip,
  isDate,
  money,
  type LedgerState,
  type Contractor,
} from '../lib/ledger-spec'

type Values = Record<string, unknown>
type SharedProps = {
  state: LedgerState
  save: (state: LedgerState) => void
  goTo: (id: string) => void
  notify: (message: string, error?: boolean) => void
}
type FormConfig = {
  title: string
  fields: CrudField[]
  values: Values
  submit?: string
  save: (values: Values) => void
}
const required = z.string().trim().min(1, copy.required)
const str = (values: Values, key: string) => String(values[key] ?? '').trim()
const field = (
  id: string,
  label: string,
  type: CrudField['type'] = 'text',
  extra: Partial<CrudField> = {},
): CrudField => ({ id, label, type, required: true, ...extra }) as CrudField
const opts = (values: { number: string; name: string }[]) =>
  values.map((value) => ({
    value: value.number,
    label: `${value.number} — ${value.name}`,
  }))
const formError = (message: string, id?: string): never => {
  throw createCrudFormError(message, id ? { [id]: message } : undefined)
}

function Panel({
  title,
  children,
  action,
}: {
  title: string
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <Card className={`min-w-0 p-6 ${styles.panel}`}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </Card>
  )
}
function GridTable<Row extends object>({
  rows,
  columns,
  empty = copy.empty,
}: {
  rows: Row[]
  columns: {
    key: keyof Row | string
    label: string
    render?: (row: Row) => React.ReactNode
  }[]
  empty?: string
}) {
  const [page, setPage] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const paged = rows.length > 20
  const filtered = search
    ? rows.filter((row) =>
        Object.values(row).some((value) =>
          String(value)
            .toLocaleLowerCase('pl')
            .includes(search.toLocaleLowerCase('pl')),
        ),
      )
    : rows
  const totalPages = Math.max(1, Math.ceil(filtered.length / 12))
  const currentPage = Math.min(page, totalPages)
  const visibleRows = paged
    ? filtered.slice((currentPage - 1) * 12, currentPage * 12)
    : filtered
  const definitions: ColumnDef<Row, unknown>[] = columns.map((column) => ({
    id: String(column.key),
    header: column.label,
    accessorFn: (row) => row[column.key as keyof Row],
    meta: { truncate: false },
    cell: ({ row }) =>
      column.render ? (
        column.render(row.original)
      ) : (
        <span className="whitespace-normal break-words">
          {String(row.original[column.key as keyof Row] ?? '')}
        </span>
      ),
  }))
  return (
    <div
      tabIndex={0}
      aria-label={copy.scrollTable}
      className={`min-w-0 overflow-x-auto ${styles.table}`}
    >
      <p className="mb-3 text-xs text-muted-foreground sm:hidden">
        {copy.scrollTable}
      </p>
      <DataTable
        columns={definitions}
        data={visibleRows}
        searchValue={paged ? search : undefined}
        onSearchChange={
          paged
            ? (value) => {
                setSearch(value)
                setPage(1)
              }
            : undefined
        }
        searchPlaceholder={copy.search}
        pagination={
          paged
            ? {
                page: currentPage,
                pageSize: 12,
                total: filtered.length,
                totalPages,
                onPageChange: setPage,
              }
            : undefined
        }
        embedded
        emptyState={<EmptyState title={empty} size="sm" />}
      />
    </div>
  )
}
function EditDialog({
  config,
  close,
}: {
  config: FormConfig | null
  close: () => void
}) {
  const formId = React.useId()
  return (
    <Dialog
      open={!!config}
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <DialogContent
        className="max-h-screen overflow-y-auto sm:max-w-2xl"
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault()
            document
              .getElementById(formId)
              ?.dispatchEvent(
                new Event('submit', { bubbles: true, cancelable: true }),
              )
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{config?.title}</DialogTitle>
        </DialogHeader>
        {config ? (
          <CrudForm<Values>
            formId={formId}
            embedded
            fields={config.fields}
            initialValues={config.values}
            submitLabel={config.submit ?? copy.save}
            extraActions={
              <Button type="button" variant="outline" onClick={close}>
                {copy.cancel}
              </Button>
            }
            onSubmit={async (values) => {
              config.save(values)
              close()
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function ChartPeriods({ state, save, goTo, notify }: SharedProps) {
  const [view, setView] = React.useState('accounts')
  const [form, setForm] = React.useState<FormConfig | null>(null)
  const used = (number: string) =>
    journalEntries(state).some((entry) =>
      entry.lines.some((line) => line.account === number),
    )
  function accountForm(number?: string) {
    const existing = state.accounts.find((account) => account.number === number)
    setForm({
      title: existing ? copy.editAccount : copy.addAccount,
      values: existing ?? {
        type: state.types[0]?.number ?? '',
        number: '',
        name: '',
      },
      fields: [
        field('type', copy.accountType, 'select', {
          options: opts(state.types),
          disabled: !!number && used(number),
          description: number && used(number) ? copy.immutable : undefined,
        }),
        field('number', copy.number, 'text', {
          disabled: !!number && used(number),
        }),
        field('name', copy.name),
      ],
      save(values) {
        const accountNumber = str(values, 'number')
        const type = state.types.find(
          (candidate) => candidate.number === str(values, 'type'),
        )
        if (!type) throw createCrudFormError(copy.required)
        if (!required.safeParse(str(values, 'name')).success)
          formError(copy.required)
        if (
          !accountNumber.startsWith(type.number) ||
          accountNumber.length <= type.number.length
        )
          formError(copy.prefix, 'number')
        if (
          state.accounts.some(
            (account) =>
              account.number === accountNumber && account.number !== number,
          )
        )
          formError(copy.duplicate, 'number')
        const account = {
          number: accountNumber,
          name: str(values, 'name'),
          type: type.number,
          normal: type.normal,
          used: false,
        }
        save({
          ...state,
          accounts: existing
            ? state.accounts.map((candidate) =>
                candidate.number === number ? account : candidate,
              )
            : [...state.accounts, account],
        })
        notify(copy.saved)
      },
    })
  }
  function typeForm() {
    setForm({
      title: copy.addType,
      values: { group: '4', number: '', name: '', normal: 'DEBIT' },
      fields: [
        field('group', copy.group, 'select', {
          options: Array.from({ length: 9 }, (_, index) => ({
            value: String(index),
            label: String(index),
          })),
        }),
        field('number', copy.number),
        field('name', copy.name),
        field('normal', copy.normal, 'select', {
          options: [
            { value: 'DEBIT', label: copy.debit },
            { value: 'CREDIT', label: copy.credit },
          ],
        }),
      ],
      save(values) {
        const number = str(values, 'number')
        if (
          !/^\d{3,}$/.test(number) ||
          !number.startsWith(str(values, 'group'))
        )
          formError(copy.typePrefix, 'number')
        if (state.types.some((type) => type.number === number))
          formError(copy.duplicate, 'number')
        if (!required.safeParse(str(values, 'name')).success)
          formError(copy.required, 'name')
        save({
          ...state,
          types: [
            ...state.types,
            {
              number,
              name: str(values, 'name'),
              normal: str(values, 'normal') === 'CREDIT' ? 'CREDIT' : 'DEBIT',
            },
          ],
        })
        notify(copy.saved)
      },
    })
  }
  const generate = () =>
    setForm({
      title: copy.generate,
      values: { start: '2026-01-01' },
      fields: [field('start', copy.start, 'date')],
      submit: copy.generate,
      save(values) {
        try {
          save({
            ...state,
            periods: generatePeriods(str(values, 'start'), state.periods),
          })
          notify(copy.periodGenerated)
        } catch (error) {
          formError(
            error instanceof Error ? error.message : copy.required,
            'start',
          )
        }
      },
    })
  return (
    <div className="space-y-6">
      <Panel
        title={copy.chart}
        action={
          <Button
            type="button"
            variant="primary-filled"
            onClick={() => {
              if (state.accounts.length || state.types.length)
                return notify(copy.notEmpty, true)
              save({
                ...state,
                accounts: starterChart.accounts,
                types: starterChart.types,
              })
              notify(copy.imported)
            }}
          >
            <Download className="size-4" />
            {copy.import}
          </Button>
        }
      >
        <p className="text-sm text-muted-foreground">{copy.chartHint}</p>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <SegmentedControl
            value={view}
            onValueChange={setView}
            aria-label={copy.chart}
          >
            <SegmentedControlItem value="accounts">
              {copy.accounts} ({state.accounts.length})
            </SegmentedControlItem>
            <SegmentedControlItem value="types">
              {copy.types} ({state.types.length})
            </SegmentedControlItem>
          </SegmentedControl>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={typeForm}>
              <Plus className="size-4" />
              {copy.addType}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!state.types.length}
              onClick={() => accountForm()}
            >
              <Plus className="size-4" />
              {copy.addAccount}
            </Button>
          </div>
        </div>
        {view === 'accounts' ? (
          <GridTable
            rows={state.accounts}
            empty={copy.noAccounts}
            columns={[
              { key: 'number', label: copy.number },
              { key: 'name', label: copy.name },
              { key: 'type', label: copy.accountType },
              {
                key: 'normal',
                label: copy.normal,
                render: (row) =>
                  row.normal === 'DEBIT' ? copy.debit : copy.credit,
              },
              {
                key: 'used',
                label: copy.status,
                render: (row) => (
                  <FinanceStatusBadge>
                    {used(row.number) ? copy.used : copy.unused}
                  </FinanceStatusBadge>
                ),
              },
              {
                key: 'actions',
                label: copy.edit,
                render: (row) => (
                  <IconButton
                    type="button"
                    variant="outline"
                    aria-label={`${copy.edit} ${row.number}`}
                    onClick={() => accountForm(row.number)}
                  >
                    <Pencil className="size-4" />
                  </IconButton>
                ),
              },
            ]}
          />
        ) : (
          <GridTable
            rows={state.types}
            columns={[
              { key: 'number', label: copy.number },
              { key: 'name', label: copy.name },
              {
                key: 'normal',
                label: copy.normal,
                render: (row) =>
                  row.normal === 'DEBIT' ? copy.debit : copy.credit,
              },
            ]}
          />
        )}
      </Panel>
      <Panel
        title={copy.periods}
        action={
          <Button type="button" variant="outline" onClick={generate}>
            <CalendarDays className="size-4" />
            {copy.generate}
          </Button>
        }
      >
        <GridTable
          rows={state.periods}
          empty={copy.noPeriods}
          columns={[
            { key: 'start', label: copy.start },
            { key: 'end', label: copy.end },
            {
              key: 'locked',
              label: copy.status,
              render: (row) => (
                <FinanceStatusBadge icon={row.locked ? 'completed' : 'draft'}>
                  {row.locked ? copy.locked : copy.openPeriod}
                </FinanceStatusBadge>
              ),
            },
            {
              key: 'actions',
              label: copy.lock,
              render: (row) => (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    if (
                      !row.locked &&
                      row.start <= '2026-09-25' &&
                      row.end >= '2026-09-25' &&
                      !state.reclassification
                    )
                      return notify(copy.closeBlocked, true)
                    save({
                      ...state,
                      periods: state.periods.map((period) =>
                        period.start === row.start
                          ? { ...period, locked: !row.locked }
                          : period,
                      ),
                    })
                    notify(row.locked ? copy.periodUnlocked : copy.periodLocked)
                  }}
                >
                  {row.locked ? copy.unlock : copy.lock}
                </Button>
              ),
            },
          ]}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => goTo('s45')}>
            {copy.goRules}
          </Button>
          <Button type="button" variant="outline" onClick={() => goTo('s47')}>
            {copy.goBalances}
          </Button>
        </div>
      </Panel>
      <EditDialog config={form} close={() => setForm(null)} />
    </div>
  )
}

function PostingRules({ state, save, goTo, notify }: SharedProps) {
  const [form, setForm] = React.useState<FormConfig | null>(null)
  const fourth = React.useMemo(
    () => state.accounts.filter((account) => account.type.startsWith('4')),
    [state.accounts],
  )
  const fifth = React.useMemo(
    () => state.accounts.filter((account) => account.type.startsWith('5')),
    [state.accounts],
  )
  const settingsFields = React.useMemo(
    () => [
      field('clearing', copy.clearing, 'select', { options: opts(fourth) }),
      field('unallocatedAccount', copy.unallocatedAccount, 'select', {
        options: opts(fifth),
      }),
    ],
    [fourth, fifth],
  )
  const ruleFields = React.useMemo(
    () => [
      field('source', copy.source, 'select', {
        options: opts(
          fourth.filter((account) => account.number !== state.clearing),
        ),
      }),
      field('target', copy.target, 'select', { options: opts(fifth) }),
      field('center', copy.centerDefault, 'select', {
        required: false,
        options: [
          { value: 'none', label: copy.noCenter },
          ...state.centers
            .filter((center) => center.active && center.code !== 'UNALLOCATED')
            .map((center) => ({
              value: center.code,
              label: `${center.code} — ${center.name}`,
            })),
        ],
      }),
    ],
    [fourth, fifth, state.clearing, state.centers],
  )
  if (!state.accounts.length)
    return (
      <Panel title={copy.settings}>
        <Alert status="information" style="stroke">
          {copy.needsChart}
        </Alert>
        <Button
          type="button"
          variant="primary-filled"
          onClick={() => goTo('s44')}
        >
          {copy.goChart}
        </Button>
      </Panel>
    )
  return (
    <div className="space-y-6">
      {!state.clearing ? (
        <Alert status="warning" style="stroke">
          {copy.unconfigured}
        </Alert>
      ) : null}
      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title={copy.settings}>
          <p className="text-sm text-muted-foreground">{copy.settingsHint}</p>
          <CrudForm<Values>
            formId="ledger-settings"
            embedded
            fields={settingsFields}
            initialValues={{
              clearing: state.clearing,
              unallocatedAccount: state.unallocatedAccount,
            }}
            submitLabel={copy.save}
            onSubmit={async (values) => {
              if (
                !fourth.some(
                  (account) => account.number === str(values, 'clearing'),
                ) ||
                !fifth.some(
                  (account) =>
                    account.number === str(values, 'unallocatedAccount'),
                )
              )
                formError(copy.settingsInvalid)
              save({
                ...state,
                clearing: str(values, 'clearing'),
                unallocatedAccount: str(values, 'unallocatedAccount'),
              })
              notify(copy.saved)
            }}
          />
        </Panel>
        <Panel title={copy.ruleTitle}>
          <CrudForm<Values>
            formId="ledger-rule"
            embedded
            fields={ruleFields}
            initialValues={
              state.rules[0] ?? {
                source: '402-1',
                target: '550-1',
                center: 'IT',
              }
            }
            submitLabel={copy.save}
            onSubmit={async (values) => {
              const source = str(values, 'source')
              const target = str(values, 'target')
              if (
                !fourth.some((account) => account.number === source) ||
                source === state.clearing ||
                !fifth.some((account) => account.number === target)
              )
                formError(copy.ruleInvalid)
              const rule = {
                source,
                target,
                center:
                  str(values, 'center') === 'none' ? '' : str(values, 'center'),
              }
              save({
                ...state,
                rules: [
                  ...state.rules.filter(
                    (candidate) => candidate.source !== source,
                  ),
                  rule,
                ],
              })
              notify(copy.saved)
            }}
          />
        </Panel>
      </div>
      <Panel
        title={copy.centers}
        action={
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              setForm({
                title: copy.addCenter,
                values: { code: '', name: '' },
                fields: [
                  field('code', copy.centerCode),
                  field('name', copy.centerName),
                ],
                save(values) {
                  const code = str(values, 'code')
                  const name = str(values, 'name')
                  if (!code || !name) formError(copy.required)
                  if (state.centers.some((center) => center.code === code))
                    formError(copy.duplicate, 'code')
                  save({
                    ...state,
                    centers: [...state.centers, { code, name, active: true }],
                  })
                  notify(copy.saved)
                },
              })
            }
          >
            <Plus className="size-4" />
            {copy.addCenter}
          </Button>
        }
      >
        <GridTable
          rows={state.centers}
          columns={[
            { key: 'code', label: copy.centerCode },
            { key: 'name', label: copy.centerName },
            {
              key: 'active',
              label: copy.status,
              render: (row) => (
                <FinanceStatusBadge>
                  {row.active ? copy.active : copy.inactive}
                </FinanceStatusBadge>
              ),
            },
            {
              key: 'actions',
              label: copy.edit,
              render: (row) =>
                row.code === 'UNALLOCATED' ? null : (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      save({
                        ...state,
                        centers: state.centers.map((center) =>
                          center.code === row.code
                            ? { ...center, active: !center.active }
                            : center,
                        ),
                      })
                    }
                  >
                    {row.active ? copy.deactivate : copy.activate}
                  </Button>
                ),
            },
          ]}
        />
      </Panel>
      <Panel title={copy.rules}>
        <GridTable
          rows={state.rules}
          columns={[
            { key: 'source', label: copy.source },
            { key: 'target', label: copy.target },
            {
              key: 'center',
              label: copy.centerDefault,
              render: (row) => row.center || copy.noCenter,
            },
          ]}
        />
      </Panel>
      <Panel
        title={copy.reconcileTitle}
        action={
          <Button
            type="button"
            variant="primary-filled"
            onClick={() => {
              try {
                save(reconcile(state))
                notify(copy.resolved)
              } catch (error) {
                notify(
                  error instanceof Error ? error.message : copy.required,
                  true,
                )
              }
            }}
          >
            <RefreshCw className="size-4" />
            {copy.reconcile}
          </Button>
        }
      >
        <p className="text-sm text-muted-foreground">{copy.reconcileHint}</p>
        <GridTable
          rows={[
            {
              document: 'FZ/2026/091',
              amount: 123000,
              posted: !!state.reclassification,
            },
          ]}
          columns={[
            { key: 'document', label: copy.document },
            {
              key: 'amount',
              label: copy.amount,
              render: (row) => money(row.amount),
            },
            {
              key: 'posted',
              label: copy.status,
              render: (row) => (
                <FinanceStatusBadge icon={row.posted ? 'completed' : 'pending'}>
                  {row.posted ? copy.posted : copy.pending}
                </FinanceStatusBadge>
              ),
            },
          ]}
        />
        {state.reclassification ? (
          <>
            <h3 className="font-semibold">{copy.ruleJournal}</h3>
            <GridTable
              rows={[
                {
                  number: state.reclassification.target,
                  debit: 123000,
                  credit: 0,
                  center: state.reclassification.center,
                },
                {
                  number: state.reclassification.clearing,
                  debit: 0,
                  credit: 123000,
                  center: '',
                },
              ]}
              columns={[
                { key: 'number', label: copy.number },
                {
                  key: 'debit',
                  label: copy.debit,
                  render: (row) => money(row.debit),
                },
                {
                  key: 'credit',
                  label: copy.credit,
                  render: (row) => money(row.credit),
                },
                { key: 'center', label: copy.centerCode },
              ]}
            />
            <p className="text-sm text-muted-foreground">{copy.postingHint}</p>
          </>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => goTo('s44')}>
            {copy.periods}
          </Button>
          <Button type="button" variant="outline" onClick={() => goTo('s47')}>
            {copy.goBalances}
          </Button>
        </div>
      </Panel>
      <EditDialog config={form} close={() => setForm(null)} />
    </div>
  )
}

function Contractors({ state, save, notify }: SharedProps) {
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [form, setForm] = React.useState<FormConfig | null>(null)
  const [actor, setActor] = React.useState('author')
  const [service, setService] = React.useState('available')
  const [bankResult, setBankResult] = React.useState('WHITELISTED')
  const contractor =
    state.contractors.find((candidate) => candidate.id === selectedId) ??
    state.contractors[0]
  const update = (next: Contractor) =>
    save({
      ...state,
      contractors: state.contractors.map((candidate) =>
        candidate.id === next.id ? next : candidate,
      ),
    })
  function contractorForm(existing?: Contractor) {
    setForm({
      title: existing ? copy.editContractor : copy.addContractor,
      values: existing ?? {
        nip: '',
        name: '',
        address: '',
        email: '',
        phone: '',
        vendor: true,
        customer: false,
      },
      fields: [
        field('nip', copy.nip, 'text', {
          disabled: !!existing,
          description: existing ? copy.nipImmutable : undefined,
        }),
        field('name', copy.name),
        field('address', copy.address),
        field('email', copy.email, 'text', { required: false }),
        field('phone', copy.phone, 'text', { required: false }),
        field('vendor', copy.vendor, 'checkbox', { required: false }),
        field('customer', copy.customer, 'checkbox', { required: false }),
      ],
      save(values) {
        const nip = str(values, 'nip').replace(/[ -]/g, '')
        if (!validNip(nip)) formError(copy.invalidNip, 'nip')
        if (
          state.contractors.some(
            (candidate) =>
              candidate.nip === nip && candidate.id !== existing?.id,
          )
        )
          formError(copy.duplicateNip, 'nip')
        if (!values.vendor && !values.customer)
          formError(copy.roleRequired, 'vendor')
        if (!str(values, 'name') || !str(values, 'address'))
          formError(copy.required)
        const next: Contractor = {
          id: existing?.id ?? crypto.randomUUID(),
          nip,
          name: str(values, 'name'),
          address: str(values, 'address'),
          email: str(values, 'email'),
          phone: str(values, 'phone'),
          vendor: !!values.vendor,
          customer: !!values.customer,
          registry: existing?.registry ?? 'PENDING',
          approval: existing?.approval ?? 'PENDING',
          reason: existing?.reason ?? '',
          banks: existing?.banks ?? [],
          snapshot: existing?.snapshot ?? null,
        }
        save({
          ...state,
          contractors: existing
            ? state.contractors.map((candidate) =>
                candidate.id === existing.id ? next : candidate,
              )
            : [...state.contractors, next],
        })
        setSelectedId(next.id)
        notify(copy.saved)
      },
    })
  }
  function decide(approval: 'APPROVED' | 'REJECTED') {
    if (!contractor) return
    if (contractor.approval !== 'PENDING')
      return notify(copy.decisionFinal, true)
    if (actor === 'author') return notify(copy.selfApproval, true)
    if (approval === 'APPROVED') {
      update({ ...contractor, approval })
      notify(copy.decisionFinal)
      return
    }
    setForm({
      title: copy.reject,
      fields: [field('reason', copy.rejectionReason, 'textarea')],
      values: { reason: '' },
      submit: copy.reject,
      save(values) {
        if (!str(values, 'reason')) formError(copy.required, 'reason')
        update({ ...contractor, approval, reason: str(values, 'reason') })
        notify(copy.decisionFinal)
      },
    })
  }
  function verify(number: string, payment = false) {
    if (!contractor) return
    if (contractor.approval !== 'APPROVED')
      return notify(copy.notApproved, true)
    if (service === 'unavailable') return notify(copy.bankUnavailable, true)
    const checked = new Date().toISOString()
    const status =
      bankResult === 'WHITELISTED' ? 'WHITELISTED' : 'NOT_WHITELISTED'
    const banks = contractor.banks.map((bank) =>
      bank.number === number
        ? {
            ...bank,
            checked,
            status: status as 'WHITELISTED' | 'NOT_WHITELISTED',
          }
        : bank,
    )
    update({
      ...contractor,
      banks,
      snapshot:
        payment && status === 'WHITELISTED'
          ? {
              name: contractor.name,
              nip: contractor.nip,
              bank: number,
              checked,
            }
          : contractor.snapshot,
    })
    notify(
      status === 'WHITELISTED'
        ? payment
          ? copy.paymentReady
          : copy.whitelisted
        : copy.bankRejected,
      status !== 'WHITELISTED',
    )
  }
  return (
    <div className="space-y-6">
      <Panel
        title={copy.contractors}
        action={
          <Button
            type="button"
            variant="primary-filled"
            onClick={() => contractorForm()}
          >
            <Plus className="size-4" />
            {copy.addContractor}
          </Button>
        }
      >
        <p className="text-sm text-muted-foreground">{copy.contractorsHint}</p>
        <GridTable
          rows={state.contractors}
          columns={[
            { key: 'name', label: copy.name },
            { key: 'nip', label: copy.nip },
            {
              key: 'roles',
              label: copy.roles,
              render: (row) =>
                [
                  row.vendor ? copy.vendor : '',
                  row.customer ? copy.customer : '',
                ]
                  .filter(Boolean)
                  .join(', '),
            },
            {
              key: 'approval',
              label: copy.approval,
              render: (row) => (
                <FinanceStatusBadge
                  icon={
                    row.approval === 'APPROVED'
                      ? 'completed'
                      : row.approval === 'REJECTED'
                        ? 'error'
                        : 'pending'
                  }
                >
                  {row.approval === 'APPROVED'
                    ? copy.approved
                    : row.approval === 'REJECTED'
                      ? copy.rejected
                      : copy.approvalPending}
                </FinanceStatusBadge>
              ),
            },
            {
              key: 'actions',
              label: copy.open,
              render: (row) => (
                <IconButton
                  type="button"
                  variant="outline"
                  aria-label={`${copy.open} ${row.name}`}
                  onClick={() => setSelectedId(row.id)}
                >
                  <Eye className="size-4" />
                </IconButton>
              ),
            },
          ]}
        />
      </Panel>
      {contractor ? (
        <>
          <Panel
            title={contractor.name}
            action={
              <Button
                type="button"
                variant="outline"
                onClick={() => contractorForm(contractor)}
              >
                <Pencil className="size-4" />
                {copy.edit}
              </Button>
            }
          >
            <dl className="grid gap-6 md:grid-cols-3">
              {[
                [copy.nip, contractor.nip],
                [copy.address, contractor.address],
                [copy.email, contractor.email],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-sm text-muted-foreground">{label}</dt>
                  <dd className="mt-1 break-words font-medium">
                    {value || '—'}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="text-sm text-muted-foreground">{copy.registryNote}</p>
          </Panel>
          <div className="grid gap-6 xl:grid-cols-2">
            <Panel title={copy.registry}>
              <FinanceStatusBadge
                icon={
                  contractor.registry === 'VERIFIED' ? 'completed' : 'pending'
                }
              >
                {contractor.registry === 'VERIFIED'
                  ? copy.registryVerified
                  : contractor.registry === 'FAILED'
                    ? copy.registryFailed
                    : copy.registryPending}
              </FinanceStatusBadge>
              <SegmentedControl
                value={service}
                onValueChange={setService}
                aria-label={copy.serviceMode}
              >
                <SegmentedControlItem value="available">
                  {copy.available}
                </SegmentedControlItem>
                <SegmentedControlItem value="unavailable">
                  {copy.unavailable}
                </SegmentedControlItem>
              </SegmentedControl>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  update({
                    ...contractor,
                    registry: service === 'available' ? 'VERIFIED' : 'FAILED',
                  })
                  notify(
                    service === 'available'
                      ? copy.registryVerified
                      : copy.registryUnavailable,
                    service !== 'available',
                  )
                }}
              >
                <RefreshCw className="size-4" />
                {copy.verifyRegistry}
              </Button>
            </Panel>
            <Panel title={copy.approval}>
              <FinanceStatusBadge
                icon={
                  contractor.approval === 'APPROVED'
                    ? 'completed'
                    : contractor.approval === 'REJECTED'
                      ? 'error'
                      : 'pending'
                }
              >
                {contractor.approval === 'APPROVED'
                  ? copy.approved
                  : contractor.approval === 'REJECTED'
                    ? copy.rejected
                    : copy.approvalPending}
              </FinanceStatusBadge>
              <p className="text-sm text-muted-foreground">{copy.reviewAs}</p>
              <SegmentedControl
                value={actor}
                onValueChange={setActor}
                aria-label={copy.reviewAs}
              >
                <SegmentedControlItem value="author">
                  {copy.author}
                </SegmentedControlItem>
                <SegmentedControlItem value="reviewer">
                  {copy.reviewer}
                </SegmentedControlItem>
              </SegmentedControl>
              {contractor.approval === 'PENDING' ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="primary-filled"
                    onClick={() => decide('APPROVED')}
                  >
                    {copy.approve}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => decide('REJECTED')}
                  >
                    {copy.reject}
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {contractor.reason || copy.decisionFinal}
                </p>
              )}
            </Panel>
          </div>
          <Panel
            title={copy.bankAccounts}
            action={
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setForm({
                    title: copy.addBank,
                    values: {
                      number: '',
                      primary: contractor.banks.length === 0,
                    },
                    fields: [
                      field('number', copy.bankAccount),
                      field('primary', copy.primary, 'checkbox', {
                        required: false,
                      }),
                    ],
                    save(values) {
                      const number = str(values, 'number')
                        .replace(/\s/g, '')
                        .toUpperCase()
                      if (!validBank(number))
                        formError(copy.invalidBank, 'number')
                      if (
                        contractor.banks.some((bank) => bank.number === number)
                      )
                        formError(copy.duplicateBank, 'number')
                      const primary =
                        !!values.primary || contractor.banks.length === 0
                      update({
                        ...contractor,
                        banks: [
                          ...contractor.banks.map((bank) =>
                            primary ? { ...bank, primary: false } : bank,
                          ),
                          { number, primary, status: 'UNKNOWN', checked: '' },
                        ],
                      })
                      notify(copy.bankAdded)
                    },
                  })
                }
              >
                <Plus className="size-4" />
                {copy.addBank}
              </Button>
            }
          >
            <p className="text-sm text-muted-foreground">{copy.bankResult}</p>
            <SegmentedControl
              value={bankResult}
              onValueChange={setBankResult}
              aria-label={copy.bankResult}
            >
              <SegmentedControlItem value="WHITELISTED">
                {copy.whitelisted}
              </SegmentedControlItem>
              <SegmentedControlItem value="NOT_WHITELISTED">
                {copy.notWhitelisted}
              </SegmentedControlItem>
            </SegmentedControl>
            <GridTable
              rows={contractor.banks}
              columns={[
                { key: 'number', label: copy.bankAccount },
                {
                  key: 'status',
                  label: copy.status,
                  render: (row) => (
                    <FinanceStatusBadge
                      icon={
                        row.status === 'WHITELISTED'
                          ? 'completed'
                          : row.status === 'NOT_WHITELISTED'
                            ? 'error'
                            : 'pending'
                      }
                    >
                      {row.status === 'WHITELISTED'
                        ? copy.whitelisted
                        : row.status === 'NOT_WHITELISTED'
                          ? copy.notWhitelisted
                          : copy.unknown}
                    </FinanceStatusBadge>
                  ),
                },
                {
                  key: 'checked',
                  label: copy.lastCheck,
                  render: (row) =>
                    row.checked
                      ? new Date(row.checked).toLocaleString('pl-PL')
                      : '—',
                },
                {
                  key: 'actions',
                  label: copy.primary,
                  render: (row) => (
                    <div className="flex flex-wrap gap-2">
                      {row.primary ? (
                        <FinanceStatusBadge icon="completed">
                          {copy.primary}
                        </FinanceStatusBadge>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() =>
                            update({
                              ...contractor,
                              banks: contractor.banks.map((bank) => ({
                                ...bank,
                                primary: bank.number === row.number,
                              })),
                            })
                          }
                        >
                          {copy.setPrimary}
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => verify(row.number)}
                      >
                        {copy.verifyBank}
                      </Button>
                    </div>
                  ),
                },
              ]}
            />
            <Button
              type="button"
              variant="primary-filled"
              disabled={!contractor.banks.some((bank) => bank.primary)}
              onClick={() => {
                const bank = contractor.banks.find(
                  (candidate) => candidate.primary,
                )
                if (bank) verify(bank.number, true)
              }}
            >
              <ShieldCheck className="size-4" />
              {copy.paymentCheck}
            </Button>
            {contractor.snapshot ? (
              <div className="space-y-3 border-t border-border pt-4">
                <h3 className="font-semibold">{copy.snapshot}</h3>
                <dl className="grid gap-4 md:grid-cols-2">
                  {[
                    [copy.name, contractor.snapshot.name],
                    [copy.nip, contractor.snapshot.nip],
                    [copy.bankAccount, contractor.snapshot.bank],
                    [
                      copy.lastCheck,
                      new Date(contractor.snapshot.checked).toLocaleString(
                        'pl-PL',
                      ),
                    ],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-sm text-muted-foreground">{label}</dt>
                      <dd className="mt-1 break-words">{value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="text-sm text-muted-foreground">
                  {copy.snapshotHint}
                </p>
              </div>
            ) : null}
          </Panel>
        </>
      ) : (
        <EmptyState title={copy.selectContractor} size="sm" />
      )}
      <EditDialog config={form} close={() => setForm(null)} />
    </div>
  )
}

function Balances({ state, goTo }: SharedProps) {
  const [period, setPeriod] = React.useState('2026-09')
  const [asOf, setAsOf] = React.useState('2026-09-30')
  const [account, setAccount] = React.useState('130-1')
  const fields = React.useMemo(
    () => [
      field('period', copy.period, 'select', {
        options: [
          { value: '2026-08', label: copy.august },
          { value: '2026-09', label: copy.september },
          { value: '2026-10', label: copy.october },
        ],
      }),
      field('asOf', copy.asOf, 'date'),
    ],
    [],
  )
  if (!state.accounts.length)
    return (
      <Panel title={copy.trialTitle}>
        <Alert status="information" style="stroke">
          {copy.needsChart}
        </Alert>
        <Button
          type="button"
          variant="primary-filled"
          onClick={() => goTo('s44')}
        >
          {copy.goChart}
        </Button>
      </Panel>
    )
  const end = new Date(
    Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0),
  )
    .toISOString()
    .slice(0, 10)
  const rows = trialBalance(state, `${period}-01`, end)
  const selected = trialBalance(state, `${period}-01`, asOf).find(
    (row) => row.number === account,
  )
  const entries = journalEntries(state).filter((entry) => entry.date <= asOf)
  const totalDebit = entries.reduce(
    (sum, entry) =>
      sum + entry.lines.reduce((subtotal, line) => subtotal + line.debit, 0),
    0,
  )
  const totalCredit = entries.reduce(
    (sum, entry) =>
      sum + entry.lines.reduce((subtotal, line) => subtotal + line.credit, 0),
    0,
  )
  const lines = entries.flatMap((entry) =>
    entry.lines
      .filter((line) => line.account === account)
      .map((line) => ({
        ...line,
        id: entry.id,
        date: entry.date,
        description: entry.description,
        type: entry.type,
        reference: entry.reference,
      })),
  )
  const amountColumns = [
    'opening',
    'periodDebit',
    'periodCredit',
    'ytdDebit',
    'ytdCredit',
    'closing',
  ] as const
  return (
    <div className="space-y-6">
      <Panel title={copy.trialTitle}>
        <p className="text-sm text-muted-foreground">{copy.trialHint}</p>
        <CrudForm<Values>
          formId="ledger-balance-filter"
          embedded
          twoColumn
          fields={fields}
          initialValues={{ period, asOf }}
          submitLabel={copy.filter}
          onSubmit={async (values) => {
            const date = str(values, 'asOf')
            const nextPeriod = str(values, 'period')
            if (!isDate(date)) formError(copy.dateInvalid, 'asOf')
            if (!date.startsWith(nextPeriod)) formError(copy.dateRange, 'asOf')
            setPeriod(nextPeriod)
            setAsOf(date)
          }}
        />
        <div className="flex flex-wrap items-center justify-between gap-4">
          <FinanceStatusBadge
            icon={totalDebit === totalCredit ? 'completed' : 'error'}
          >
            {totalDebit === totalCredit ? copy.balanced : copy.notBalanced}
          </FinanceStatusBadge>
          <span className="text-sm tabular-nums">
            {copy.difference}: {money(totalDebit - totalCredit)}
          </span>
        </div>
        <GridTable
          rows={rows}
          columns={[
            { key: 'number', label: copy.number },
            { key: 'name', label: copy.name },
            ...amountColumns.map((key) => ({
              key,
              label: copy[key],
              render: (row: (typeof rows)[number]) => (
                <span className="whitespace-nowrap tabular-nums">
                  {money(row[key])}
                </span>
              ),
            })),
            {
              key: 'actions',
              label: copy.open,
              render: (row) => (
                <IconButton
                  type="button"
                  variant="outline"
                  aria-label={`${copy.open} ${row.number}`}
                  onClick={() => setAccount(row.number)}
                >
                  <Eye className="size-4" />
                </IconButton>
              ),
            },
          ]}
        />
        <p className="text-sm text-muted-foreground">{copy.ledgerOnly}</p>
      </Panel>
      <Panel title={`${copy.accountLedger} ${account}`}>
        <dl className="grid gap-6 md:grid-cols-3">
          <div>
            <dt className="text-sm text-muted-foreground">{copy.name}</dt>
            <dd className="mt-1 font-medium">{selected?.name}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">{copy.asOf}</dt>
            <dd className="mt-1 font-medium">{asOf}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">
              {copy.accountBalance}
            </dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">
              {money(selected?.closing ?? 0)}
            </dd>
          </div>
        </dl>
        <GridTable
          rows={lines}
          empty={copy.noEntries}
          columns={[
            { key: 'id', label: copy.document },
            { key: 'date', label: copy.operationDate },
            { key: 'description', label: copy.name },
            {
              key: 'type',
              label: copy.entryType,
              render: (row) => (
                <FinanceStatusBadge>
                  {row.type === 'OPENING'
                    ? copy.openingEntry
                    : row.type === 'REVERSAL'
                      ? copy.reversalEntry
                      : copy.normalEntry}
                </FinanceStatusBadge>
              ),
            },
            {
              key: 'debit',
              label: copy.debit,
              render: (row) => money(row.debit),
            },
            {
              key: 'credit',
              label: copy.credit,
              render: (row) => money(row.credit),
            },
            { key: 'reference', label: copy.sourceEntry },
          ]}
        />
        <p className="text-sm text-muted-foreground">{copy.historyNote}</p>
        <Button type="button" variant="outline" onClick={() => goTo('s44')}>
          <BookOpen className="size-4" />
          {copy.periods}
        </Button>
      </Panel>
    </div>
  )
}

export function LedgerSpecWorkflows({
  screenId,
  goTo,
}: {
  screenId: string
  goTo: (id: string) => void
}) {
  const [state, setState] = React.useState<LedgerState>(initialLedgerState)
  const [loaded, setLoaded] = React.useState(false)
  const [notice, setNotice] = React.useState<{
    message: string
    error: boolean
  } | null>(null)
  React.useEffect(() => {
    try {
      const raw = sessionStorage.getItem(ledgerStorageKey)
      if (raw) {
        const parsed = ledgerStateSchema.safeParse(JSON.parse(raw))
        if (parsed.success) setState(parsed.data)
      }
    } catch {
      setNotice({ message: copy.storageError, error: true })
    }
    setLoaded(true)
  }, [])
  React.useEffect(() => {
    setNotice(null)
  }, [screenId])
  const save = (next: LedgerState) => {
    try {
      sessionStorage.setItem(ledgerStorageKey, JSON.stringify(next))
      setState(next)
    } catch {
      formError(copy.storageError)
    }
  }
  const notify = (message: string, error = false) =>
    setNotice({ message, error })
  const props = { state, save, notify, goTo }
  if (!loaded) return <LoadingMessage label={copy.loading} />
  return (
    <div className="space-y-6" data-testid={`ledger-workflow-${screenId}`}>
      {notice ? (
        <Alert
          status={notice.error ? 'error' : 'information'}
          style="stroke"
          size="sm"
        >
          {notice.message}
        </Alert>
      ) : null}
      {screenId === 's44' ? (
        <ChartPeriods {...props} />
      ) : screenId === 's45' ? (
        <PostingRules {...props} />
      ) : screenId === 's46' ? (
        <Contractors {...props} />
      ) : (
        <Balances {...props} />
      )}
    </div>
  )
}
