'use client'

import * as React from 'react'
import { z } from 'zod'
import {
  ArrowRight,
  ChevronRight,
  FileText,
  LineChart,
  Wallet,
} from 'lucide-react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import type { CrudField } from '@open-mercato/ui/backend/CrudForm'
import {
  GenericPreviewForm,
  AllocationPreviewResult,
} from './GenericPreviewForm'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@open-mercato/ui/primitives/card'
import {
  Alert,
  AlertTitle,
  AlertDescription,
} from '@open-mercato/ui/primitives/alert'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import screenData from '../data/screens.json'
import ledgerSpecScreens from '../data/ledger-spec-screens.json'
import operationsSpecScreens from '../data/operations-spec-screens.json'
import taxSpecScreens from '../data/tax-spec-screens.json'
import { LedgerSpecWorkflows } from './LedgerSpecWorkflows'
import { OperationsSpecWorkflows } from './OperationsSpecWorkflows'
import { TaxSpecWorkflows } from './TaxSpecWorkflows'
import specialData from '../data/special-content.json'
import actionResults from '../data/action-results.json'
import { ScenarioGuide } from './ScenarioGuide'
import { FinanceNavigation } from './FinanceNavigation'
import { FinanceDashboard } from './FinanceDashboard'
import { BankCloseScenario } from './BankCloseScenario'
import { PayablesReceivablesScenario } from './PayablesReceivablesScenario'
import { BudgetCurrencyScenario } from './BudgetCurrencyScenario'
import { TaxApprovalScenario } from './TaxApprovalScenario'
import {
  CreateDemoRecordDialog,
  hasCreateDemoAction,
} from './CreateDemoRecordDialog'

import {
  FinanceStatusBadge,
  type FinanceStatusIcon,
} from './FinanceStatusBadge'

type DemoBadge = {
  text: string
  tone: 'neutral' | 'info' | 'warning' | 'error' | 'success'
  icon?: FinanceStatusIcon
}
type DemoLink = { text: string; to: string }
type DemoCell = string | DemoBadge | DemoLink
const createdRowsSchema = z.record(
  z.string(),
  z.array(
    z.array(
      z.union([
        z.string(),
        z.object({ text: z.string(), to: z.string() }),
        z.object({
          text: z.string(),
          tone: z.enum(['neutral', 'info', 'warning', 'error', 'success']),
          icon: z
            .enum(['completed', 'pending', 'error', 'info', 'neutral', 'draft'])
            .optional(),
        }),
      ]),
    ),
  ),
)
type DemoScreen = {
  id: string
  area: string
  title: string
  subtitle: string
  kind: string
  refs: string[]
  next: string
  action?: string
  actionTarget?: string
  columns?: string[]
  rows?: DemoCell[][]
  metrics?: string[][]
  links?: string[][]
  facts?: string[][]
  related?: string[][]
  checks?: string[][]
  steps?: string[]
  fields?: string[][]
  summary?: string[][]
  status?: DemoBadge
  series?: number[]
  mismatch?: boolean
}
type DemoRow = { id: string; cells: DemoCell[] }
type SelectedRecord = {
  headings: string[]
  cells: DemoCell[]
  target?: string
}
type SpecialContent = {
  callout?: { title: string; body: string; tone: 'info' | 'warning' }
  metrics?: string[][]
  series?: number[]
  tables?: Array<{ title: string; columns: string[]; rows: DemoCell[][] }>
  choices?: string[][]
  steps?: string[]
  links?: string[][]
}

const screens = [
  ...screenData,
  ...ledgerSpecScreens,
  ...operationsSpecScreens,
  ...taxSpecScreens,
] as unknown as DemoScreen[]
const specialScreens = specialData as unknown as Record<string, SpecialContent>
const defaultScreen = screens[0]
const bankCloseScreens = new Set(['s3', 's6', 's16', 's17', 's18', 's39'])
const payablesReceivablesScreens = new Set([
  's8',
  's9',
  's10',
  's12',
  's13',
  's14',
  's43',
])
const budgetCurrencyScreens = new Set(['s25', 's27', 's28', 's42'])
const taxApprovalScreens = new Set(['s36', 's37', 's40'])
const ledgerSpecIds = new Set(ledgerSpecScreens.map((screen) => screen.id))
const operationsSpecIds = new Set(
  operationsSpecScreens.map((screen) => screen.id),
)
const taxSpecIds = new Set(taxSpecScreens.map((screen) => screen.id))
const contextLinks: Record<string, string[]> = {
  s2: ['s44', 's47'],
  s5: ['s44', 's45'],
  s6: ['s47', 's45', 's51', 's57'],
  s7: ['s46', 's54', 's10'],
  s10: ['s46', 's52'],
  s11: ['s46', 's52'],
  s15: ['s52'],
  s17: ['s52'],
  s18: ['s52'],
  s20: ['s48'],
  s21: ['s48'],
  s22: ['s48', 's49'],
  s23: ['s51'],
  s24: ['s51'],
  s25: ['s51'],
  s30: ['s45'],
  s31: ['s45'],
  s36: ['s53', 's55', 's56'],
  s37: ['s55', 's56'],
  s38: ['s47', 's57'],
  s42: ['s50'],
  s43: ['s46', 's54', 's49'],
  s44: ['s45', 's47'],
  s45: ['s44', 's47'],
  s46: ['s7', 's11'],
  s47: ['s45', 's57'],
  s48: ['s20', 's49'],
  s49: ['s48', 's50'],
  s50: ['s42', 's49'],
  s51: ['s23', 's52'],
  s52: ['s10', 's15'],
  s53: ['s55', 's56'],
  s54: ['s46', 's7'],
  s55: ['s37', 's53'],
  s56: ['s55', 's57'],
  s57: ['s47', 's56'],
}
const dedicatedScenarioScreens = new Set([
  ...ledgerSpecIds,
  ...operationsSpecIds,
  ...taxSpecIds,
  ...bankCloseScreens,
  ...payablesReceivablesScreens,
  ...budgetCurrencyScreens,
  ...taxApprovalScreens,
])

function isBadge(value: DemoCell): value is DemoBadge {
  return typeof value === 'object' && 'tone' in value
}

function isLink(value: DemoCell): value is DemoLink {
  return typeof value === 'object' && 'to' in value
}

function cellText(value: DemoCell): string {
  return typeof value === 'string' ? value : value.text
}

function previewFields(
  screen: DemoScreen,
  t: ReturnType<typeof useT>,
): { fields: CrudField[]; initialValues: Record<string, string> } {
  const invoiceFields =
    screen.kind === 'invoice-form'
      ? [
          [
            t('finance_previews.form.counterparty'),
            screen.id === 's42' ? 'Nord GmbH' : 'TechNova sp. z o.o.',
            'text',
          ],
          [
            t('finance_previews.form.taxId'),
            screen.id === 's42' ? 'DE123456789' : '5213456789',
            'text',
          ],
          [
            t('finance_previews.form.address'),
            screen.id === 's42'
              ? 'Berliner Str. 42, Berlin'
              : 'ul. Marszałkowska 12, Warszawa',
            'text',
          ],
          [
            t('finance_previews.form.documentNumber'),
            screen.id === 's42' ? 'FS/2026/095' : 'FZ/09/2026/092',
            'text',
          ],
          [t('finance_previews.form.issueDate'), '2026-09-25', 'date'],
          [t('finance_previews.form.transactionDate'), '2026-09-25', 'date'],
          [t('finance_previews.form.dueDate'), '2026-10-14', 'date'],
          [t('finance_previews.form.currency'), 'PLN', 'select', 'PLN|EUR|USD'],
          [
            t('finance_previews.form.paymentMethod'),
            t('finance_previews.form.transfer'),
            'select',
            [
              t('finance_previews.form.transfer'),
              t('finance_previews.form.card'),
              t('finance_previews.form.cash'),
            ].join('|'),
          ],
          [
            t('finance_previews.form.bankAccount'),
            'PL61 1090 1014 0000 0712 1981 2874',
            'text',
          ],
          [
            t('finance_previews.form.lineName'),
            screen.id === 's42' ? 'Usługi IT za wrzesień' : 'Prace wdrożeniowe',
            'text',
          ],
          [
            t('finance_previews.form.quantity'),
            screen.id === 's42' ? '10' : '8',
            'number',
          ],
          [
            t('finance_previews.form.unitPrice'),
            screen.id === 's42' ? '1200' : '1230',
            'number',
          ],
          [t('finance_previews.form.vatRate'), '23', 'select', '23|8|5|0'],
          [t('finance_previews.form.notes'), '', 'textarea'],
        ]
      : null
  const journalFields =
    screen.kind === 'journal'
      ? [
          [t('finance_previews.form.postingDate'), '2026-09-25', 'date'],
          [
            t('finance_previews.form.period'),
            'Wrzesień 2026',
            'select',
            'Wrzesień 2026|Październik 2026',
          ],
          [
            t('finance_previews.form.description'),
            'Korekta opłaty bankowej',
            'text',
          ],
          [t('finance_previews.form.sourceDocument'), 'WB/2026/0412', 'text'],
          [
            t('finance_previews.form.debitAccount'),
            '402-01',
            'select',
            '402-01|130-01|202-01',
          ],
          [
            t('finance_previews.form.creditAccount'),
            '130-01',
            'select',
            '130-01|402-01|202-01',
          ],
          [t('finance_previews.form.amount'), '42', 'number'],
        ]
      : null
  const requestFields =
    screen.kind === 'request'
      ? [
          [t('finance_previews.form.purchaseSubject'), 'Usługi IT', 'text'],
          [t('finance_previews.form.amount'), '24600', 'number'],
          [
            t('finance_previews.form.costCenter'),
            'IT',
            'select',
            'IT|Sprzedaż|Operacje',
          ],
          [
            t('finance_previews.form.period'),
            'Wrzesień 2026',
            'select',
            'Wrzesień 2026|Październik 2026',
          ],
          [
            t('finance_previews.form.justification'),
            'Dodatkowe prace wdrożeniowe',
            'textarea',
          ],
        ]
      : null
  const source = invoiceFields ??
    journalFields ??
    requestFields ??
    screen.fields ?? [
      [
        t('finance_previews.form.documentNumber'),
        screen.id === 's42'
          ? 'FS/2026/095'
          : screen.id === 's43'
            ? 'FZ/09/2026/089'
            : 'ZK/2026/221',
        'text',
      ],
      [t('finance_previews.form.description'), screen.subtitle, 'text'],
      [t('finance_previews.form.date'), '2026-09-25', 'date'],
      [t('finance_previews.form.amount'), '12300', 'number'],
      [t('finance_previews.form.notes'), '', 'textarea'],
    ]
  const fields: CrudField[] = source.map(
    ([label, value, type, options], index) => ({
      id: `field_${index}`,
      label,
      type:
        type === 'select' ||
        type === 'textarea' ||
        type === 'date' ||
        type === 'number'
          ? type
          : 'text',
      options:
        type === 'select'
          ? (options ?? '')
              .split('|')
              .filter(Boolean)
              .map((option) => ({ value: option, label: option }))
          : undefined,
      layout: type === 'textarea' ? 'full' : 'half',
    }),
  )
  const initialValues = Object.fromEntries(
    source.map((field, index) => [`field_${index}`, field[1] ?? '']),
  )
  return { fields, initialValues }
}

function MetricCards({ metrics }: { metrics: string[][] }) {
  const icons = [Wallet, FileText, LineChart]
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {metrics.map(([label, value, caption], index) => {
        const Icon = icons[index % icons.length]
        return (
          <Card
            key={`${label}-${index}`}
            className="border-b-2 border-b-accent-indigo/40 shadow-sm"
          >
            <CardContent className="space-y-4 p-5">
              <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
                <span>{label}</span>
                <Icon
                  className="size-5 text-accent-indigo"
                  aria-hidden="true"
                />
              </div>
              <div className="text-3xl font-semibold tracking-tight text-foreground">
                {value}
              </div>
              {caption ? (
                <p className="text-sm text-muted-foreground">{caption}</p>
              ) : null}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

function FlowChart({ title, values }: { title: string; values: number[] }) {
  const maxValue = Math.max(...values, 1)
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <svg
          viewBox="0 0 480 180"
          role="img"
          aria-label={title}
          className="h-48 w-full"
        >
          <line x1="0" y1="160" x2="480" y2="160" className="stroke-border" />
          {values.map((value, index) => {
            const height = Math.max(8, (value / maxValue) * 145)
            return (
              <React.Fragment key={index}>
                <rect
                  x={index * 40 + 6}
                  y={160 - height}
                  width="28"
                  height={height}
                  rx="4"
                  className="fill-accent-indigo/80"
                />
                <text
                  x={index * 40 + 20}
                  y="176"
                  textAnchor="middle"
                  className="fill-muted-foreground text-xs"
                >
                  {index + 1}
                </text>
              </React.Fragment>
            )
          })}
        </svg>
      </CardContent>
    </Card>
  )
}

function PreviewTable({
  title,
  headings,
  rows,
  renderCell,
  openRecord,
}: {
  title: string
  headings: string[]
  rows: DemoCell[][]
  renderCell: (
    value: DemoCell,
    cells: DemoCell[],
    headings: string[],
  ) => React.ReactNode
  openRecord: (cells: DemoCell[], headings: string[]) => void
}) {
  const data = React.useMemo<DemoRow[]>(
    () => rows.map((cells, index) => ({ id: `${title}-${index}`, cells })),
    [rows, title],
  )
  const columns = React.useMemo<ColumnDef<DemoRow, unknown>[]>(
    () =>
      headings.map((heading, index) => ({
        id: `column_${index}`,
        header: heading,
        accessorFn: (row: DemoRow) => cellText(row.cells[index] ?? ''),
        cell: ({ row }) =>
          renderCell(
            row.original.cells[index] ?? '',
            row.original.cells,
            headings,
          ),
      })),
    [headings, renderCell],
  )
  return (
    <DataTable
      title={title}
      columns={columns}
      data={data}
      onRowClick={(row) => openRecord(row.cells, headings)}
      embedded
    />
  )
}

export function FinancePreview() {
  const t = useT()
  const [activeId, setActiveId] = React.useState(defaultScreen.id)
  const [scenarioRunId, setScenarioRunId] = React.useState(0)
  const [search, setSearch] = React.useState('')
  const [statusFilter, setStatusFilter] = React.useState('all')
  const [message, setMessage] = React.useState<string | null>(null)
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false)
  const [createdRows, setCreatedRows] = React.useState<
    Record<string, DemoCell[][]>
  >({})
  const [createdRowsLoaded, setCreatedRowsLoaded] = React.useState(false)
  const [selectedRecord, setSelectedRecord] =
    React.useState<SelectedRecord | null>(null)
  const active =
    screens.find((screen) => screen.id === activeId) ?? defaultScreen
  const special = specialScreens[active.id]

  React.useEffect(() => {
    const readHash = () => {
      const id = window.location.hash.replace(/^#/, '')
      if (screens.some((screen) => screen.id === id)) setActiveId(id)
    }
    readHash()
    window.addEventListener('hashchange', readHash)
    return () => window.removeEventListener('hashchange', readHash)
  }, [])

  React.useEffect(() => {
    try {
      const stored = window.sessionStorage.getItem(
        'finance-preview-created-rows',
      )
      if (stored) {
        const result = createdRowsSchema.safeParse(JSON.parse(stored))
        setCreatedRows(result.success ? result.data : {})
      }
    } catch {
      setCreatedRows({})
    }
    setCreatedRowsLoaded(true)
  }, [])

  React.useEffect(() => {
    if (!createdRowsLoaded) return
    try {
      window.sessionStorage.setItem(
        'finance-preview-created-rows',
        JSON.stringify(createdRows),
      )
    } catch {
      return
    }
  }, [createdRows, createdRowsLoaded])

  const goTo = React.useCallback((id: string) => {
    if (!screens.some((screen) => screen.id === id)) return
    setActiveId(id)
    setSearch('')
    setStatusFilter('all')
    setMessage(null)
    window.location.hash = id
    window.scrollTo(0, 0)
  }, [])

  const openRecord = React.useCallback(
    (cells: DemoCell[], headings: string[]) => {
      setSelectedRecord({ cells, headings, target: cells.find(isLink)?.to })
    },
    [],
  )

  const renderCell = React.useCallback(
    (value: DemoCell, cells: DemoCell[], headings: string[]) => {
      if (isLink(value))
        return (
          <Button
            type="button"
            variant="link"
            className="h-auto p-0 text-accent-indigo"
            onClick={(event) => {
              event.stopPropagation()
              openRecord(cells, headings)
            }}
          >
            {value.text}
          </Button>
        )
      if (isBadge(value))
        return (
          <FinanceStatusBadge variant={value.tone} icon={value.icon}>
            {value.text}
          </FinanceStatusBadge>
        )
      return (
        <span className="block max-w-64 whitespace-normal break-words leading-5">
          {value}
        </span>
      )
    },
    [openRecord],
  )

  const rows = React.useMemo<DemoRow[]>(
    () =>
      [...(createdRows[active.id] ?? []), ...(active.rows ?? [])].map(
        (cells, index) => ({
          id: `${active.id}-${index}`,
          cells,
        }),
      ),
    [active, createdRows],
  )
  const statusOptions = React.useMemo(
    () =>
      Array.from(
        new Set(
          rows.flatMap((row) =>
            row.cells.filter(isBadge).map((value) => value.text),
          ),
        ),
      ),
    [rows],
  )
  const filteredRows = React.useMemo(
    () =>
      rows.filter((row) => {
        const matchesSearch = row.cells.some((cell) =>
          cellText(cell)
            .toLocaleLowerCase()
            .includes(search.toLocaleLowerCase()),
        )
        const matchesStatus =
          statusFilter === 'all' ||
          row.cells.some((cell) => isBadge(cell) && cell.text === statusFilter)
        return matchesSearch && matchesStatus
      }),
    [rows, search, statusFilter],
  )
  const columns = React.useMemo<ColumnDef<DemoRow, unknown>[]>(
    () =>
      (active.columns ?? []).map((title, index) => ({
        id: `column_${index}`,
        header: title,
        meta: { truncate: false },
        accessorFn: (row: DemoRow) => cellText(row.cells[index] ?? ''),
        cell: ({ row }) =>
          renderCell(
            row.original.cells[index] ?? '',
            row.original.cells,
            active.columns ?? [],
          ),
      })),
    [active, renderCell],
  )

  const addDemoRow = (row: DemoCell[]) => {
    setCreatedRows((current) => ({
      ...current,
      [active.id]: [row, ...(current[active.id] ?? [])],
    }))
    setMessage(t('finance_previews.screen.saved'))
  }
  const copyRowId = (row: DemoRow) => {
    const identifier = cellText(row.cells[0] ?? '')
    if (!navigator.clipboard?.writeText) {
      setMessage(t('finance_previews.screen.copyUnavailable'))
      return
    }
    void navigator.clipboard
      .writeText(identifier)
      .then(() => setMessage(t('finance_previews.screen.copied')))
      .catch(() => setMessage(t('finance_previews.screen.copyUnavailable')))
  }
  const exportRow = (row: DemoRow) => {
    const values = row.cells.map(
      (cell) => `"${cellText(cell).replaceAll('"', '""')}"`,
    )
    const csv = [active.columns?.join(',') ?? '', values.join(',')].join('\n')
    const url = URL.createObjectURL(
      new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }),
    )
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `finance-preview-${row.id}.csv`
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    setMessage(t('finance_previews.screen.exported'))
  }
  const handleStandaloneAction = () => {
    if (active.id === 's4' || active.id === 's41') {
      const columns = active.columns ?? [active.title]
      const sourceRows =
        active.id === 's41'
          ? rows.map((row) => row.cells.map(cellText))
          : [
              [active.title],
              ...(active.facts ?? []).map(([label, value]) => [
                `${label}: ${value}`,
              ]),
            ]
      const csv = [columns, ...sourceRows]
        .map((row) =>
          row.map((value) => `"${value.replaceAll('"', '""')}"`).join(','),
        )
        .join('\n')
      const url = URL.createObjectURL(
        new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }),
      )
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `finance-preview-${active.id}.csv`
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setMessage(t('finance_previews.screen.exported'))
      return
    }
    const result = actionResults[active.id as keyof typeof actionResults]
    if (result) setMessage(result)
  }
  const form = previewFields(active, t)
  const hasForm = [
    'form',
    'journal',
    'allocation',
    'budget',
    'request',
    'invoice-form',
  ].includes(active.kind)

  return (
    <Page data-testid="finance-preview" aria-busy={!createdRowsLoaded}>
      <FinanceNavigation screens={screens} active={active} goTo={goTo} />
      <PageHeader
        title={active.title}
        description={active.subtitle}
        actions={
          <>
            {active.status && !dedicatedScenarioScreens.has(active.id) ? (
              <FinanceStatusBadge
                variant={active.status.tone}
                icon={active.status.icon}
              >
                {active.status.text}
              </FinanceStatusBadge>
            ) : null}
            <Badge
              tone="neutral"
              appearance="stroke"
              size={20}
              title={t('finance_previews.demo.description')}
            >
              {t('finance_previews.demo.title')}
            </Badge>
            <ScenarioGuide
              activeId={active.id}
              goTo={goTo}
              onStart={(screenId, resetKeys) => {
                resetKeys.forEach((key) =>
                  window.sessionStorage.removeItem(key),
                )
                setScenarioRunId((current) => current + 1)
                setSelectedRecord(null)
                setCreateDialogOpen(false)
                goTo(screenId)
              }}
            />
            {active.action && !dedicatedScenarioScreens.has(active.id) ? (
              <Button
                type={active.id === 's31' ? 'submit' : 'button'}
                form={
                  active.id === 's31' ? 'finance-preview-form-s31' : undefined
                }
                variant="primary-filled"
                onClick={() =>
                  active.id === 's31'
                    ? undefined
                    : active.actionTarget
                      ? goTo(active.actionTarget)
                      : hasCreateDemoAction(active.id)
                        ? setCreateDialogOpen(true)
                        : handleStandaloneAction()
                }
              >
                {active.action}
              </Button>
            ) : null}
          </>
        }
      />
      <PageBody>
        <div key={scenarioRunId} className="space-y-5">
          {message ? (
            <Alert status="information" style="stroke" size="sm">
              {message}
            </Alert>
          ) : null}

          {contextLinks[active.id]?.length ? (
            <nav
              aria-label={t('finance_previews.screen.related')}
              className="flex flex-wrap gap-2"
            >
              {contextLinks[active.id].map((id) => {
                const target = screens.find((screen) => screen.id === id)
                return target ? (
                  <Button
                    key={id}
                    type="button"
                    variant="outline"
                    onClick={() => goTo(id)}
                  >
                    {target.title}
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </Button>
                ) : null
              })}
            </nav>
          ) : null}
          {dedicatedScenarioScreens.has(active.id) ? (
            <>
              {ledgerSpecIds.has(active.id) ? (
                <LedgerSpecWorkflows
                  key={active.id}
                  screenId={active.id}
                  goTo={goTo}
                />
              ) : null}
              {operationsSpecIds.has(active.id) ? (
                <OperationsSpecWorkflows
                  key={active.id}
                  screenId={active.id}
                  goTo={goTo}
                />
              ) : null}
              {taxSpecIds.has(active.id) ? (
                <TaxSpecWorkflows
                  key={active.id}
                  screenId={active.id}
                  goTo={goTo}
                />
              ) : null}
              {bankCloseScreens.has(active.id) ? (
                <BankCloseScenario screenId={active.id} goTo={goTo} />
              ) : null}
              {payablesReceivablesScreens.has(active.id) ? (
                <PayablesReceivablesScenario screenId={active.id} goTo={goTo} />
              ) : null}
              {budgetCurrencyScreens.has(active.id) ? (
                <BudgetCurrencyScenario screenId={active.id} goTo={goTo} />
              ) : null}
              {taxApprovalScreens.has(active.id) ? (
                <TaxApprovalScenario screenId={active.id} goTo={goTo} />
              ) : null}
            </>
          ) : (
            <>
              {special?.callout ? (
                <Alert
                  status={
                    special.callout.tone === 'info'
                      ? 'information'
                      : special.callout.tone
                  }
                  style="stroke"
                  size="sm"
                >
                  <AlertTitle>{special.callout.title}</AlertTitle>
                  <AlertDescription>{special.callout.body}</AlertDescription>
                </Alert>
              ) : null}

              {special?.metrics ? (
                <MetricCards metrics={special.metrics} />
              ) : null}

              {special?.series ? (
                <FlowChart title={active.title} values={special.series} />
              ) : null}

              {special?.tables?.map((table, index) => (
                <PreviewTable
                  key={`${active.id}-${index}`}
                  title={table.title}
                  headings={table.columns}
                  rows={table.rows}
                  renderCell={renderCell}
                  openRecord={openRecord}
                />
              ))}

              {special?.steps ? (
                <Card>
                  <CardHeader>
                    <CardTitle>{t('finance_previews.screen.steps')}</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {special.steps.map((step, index) => (
                      <div
                        key={step}
                        className="flex items-center gap-3 rounded-lg border border-border p-4"
                      >
                        <Badge
                          tone="neutral"
                          appearance="stroke"
                          size={20}
                          numeric
                        >
                          {index + 1}
                        </Badge>
                        <strong className="text-sm">{step}</strong>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              ) : null}

              {special?.choices ? (
                <Card>
                  <CardHeader>
                    <CardTitle>
                      {t('finance_previews.screen.choices')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {special.choices.map(([label, description, target]) => (
                      <Button
                        key={label}
                        type="button"
                        variant="outline"
                        className="h-auto w-full justify-between whitespace-normal py-3 text-left"
                        onClick={() => goTo(target)}
                      >
                        <span>
                          <strong className="block">{label}</strong>
                          <span className="block text-xs text-muted-foreground">
                            {description}
                          </span>
                        </span>
                        <ChevronRight aria-hidden="true" />
                      </Button>
                    ))}
                  </CardContent>
                </Card>
              ) : null}

              {special?.links ? (
                <Card>
                  <CardHeader>
                    <CardTitle>
                      {t('finance_previews.screen.related')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-wrap gap-2">
                    {special.links.map(([label, target]) => (
                      <Button
                        key={`${label}-${target}`}
                        type="button"
                        variant="outline"
                        onClick={() => goTo(target)}
                      >
                        {label}
                        <ArrowRight aria-hidden="true" />
                      </Button>
                    ))}
                  </CardContent>
                </Card>
              ) : null}

              {active.kind === 'dashboard' ? (
                <FinanceDashboard goTo={goTo} />
              ) : null}

              {active.id === 's32' ? (
                <AllocationPreviewResult onEdit={() => goTo('s31')} />
              ) : active.metrics ? (
                <MetricCards metrics={active.metrics} />
              ) : null}

              {active.kind === 'fx' ? (
                <>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {[
                      ['EUR / PLN', '4,3400', '+0,28%'],
                      ['USD / PLN', '3,8760', '+0,12%'],
                      ['GBP / PLN', '5,1800', '−0,08%'],
                      ['CHF / PLN', '4,6250', '+0,19%'],
                    ].map(([pair, rate, change]) => (
                      <Card
                        key={pair}
                        className="border-b-2 border-b-accent-indigo/40 shadow-sm"
                      >
                        <CardContent className="space-y-4 p-5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">{pair}</span>
                            <LineChart
                              className="size-5 text-accent-indigo"
                              aria-hidden="true"
                            />
                          </div>
                          <strong className="block text-3xl tabular-nums">
                            {rate}
                          </strong>
                          <Badge tone="neutral" appearance="stroke" size={20}>
                            {change}
                          </Badge>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                  <FlowChart
                    title={active.title}
                    values={[47, 53, 52, 61, 58, 63, 71, 67, 73, 80, 77, 86]}
                  />
                </>
              ) : null}

              {active.rows && active.columns ? (
                <DataTable
                  columns={columns}
                  data={filteredRows}
                  title={active.title}
                  toolbar={
                    <div className="flex flex-wrap items-center gap-3">
                      <SearchInput
                        value={search}
                        onChange={setSearch}
                        placeholder={t('finance_previews.screen.search')}
                        aria-label={t('finance_previews.screen.search')}
                        className="w-full min-w-0 sm:w-72 sm:flex-1"
                      />
                      {statusOptions.length > 0 ? (
                        <Select
                          value={statusFilter}
                          onValueChange={setStatusFilter}
                        >
                          <SelectTrigger
                            className="w-full sm:w-48"
                            aria-label={t(
                              'finance_previews.screen.allStatuses',
                            )}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">
                              {t('finance_previews.screen.allStatuses')}
                            </SelectItem>
                            {statusOptions.map((option) => (
                              <SelectItem key={option} value={option}>
                                {option}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : null}
                      {search || statusFilter !== 'all' ? (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            setSearch('')
                            setStatusFilter('all')
                          }}
                        >
                          {t('finance_previews.screen.clearFilters')}
                        </Button>
                      ) : null}
                    </div>
                  }
                  rowActions={(row) => (
                    <RowActions
                      items={[
                        {
                          id: 'open',
                          label: t('finance_previews.screen.open'),
                          onSelect: () =>
                            openRecord(row.cells, active.columns ?? []),
                        },
                        {
                          id: 'copy',
                          label: t('finance_previews.screen.copyId'),
                          onSelect: () => copyRowId(row),
                        },
                        {
                          id: 'export',
                          label: t('finance_previews.screen.exportRow'),
                          onSelect: () => exportRow(row),
                        },
                      ]}
                    />
                  )}
                  onRowClick={(row) =>
                    openRecord(row.cells, active.columns ?? [])
                  }
                  emptyState={
                    <EmptyState
                      title={t('finance_previews.screen.empty')}
                      size="sm"
                    />
                  }
                  embedded
                />
              ) : null}

              {active.series && active.id !== 's32' ? (
                <FlowChart title={active.title} values={active.series} />
              ) : null}

              {active.facts ? (
                <Card>
                  <CardHeader>
                    <CardTitle>{t('finance_previews.screen.facts')}</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {active.facts.map(([label, value]) => (
                      <div
                        key={label}
                        className="rounded-lg border border-border p-4"
                      >
                        <span className="block text-sm text-muted-foreground">
                          {label}
                        </span>
                        <strong className="mt-2 block text-lg">{value}</strong>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              ) : null}

              {active.related ? (
                <Card>
                  <CardHeader>
                    <CardTitle>
                      {t('finance_previews.screen.related')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="divide-y divide-border">
                    {active.related.map(([title, detail, amount], index) => (
                      <div
                        key={`${title}-${index}`}
                        className="flex flex-wrap items-center justify-between gap-3 py-3"
                      >
                        <div>
                          <strong>{title}</strong>
                          <span className="ml-3 text-sm text-muted-foreground">
                            {detail}
                          </span>
                        </div>
                        <strong className="tabular-nums">{amount}</strong>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              ) : null}

              {active.steps ? (
                <Card>
                  <CardHeader>
                    <CardTitle>{t('finance_previews.screen.steps')}</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {active.steps.map((step, index) => (
                      <div
                        key={step}
                        className="flex items-center gap-3 rounded-lg border border-border p-4"
                      >
                        <Badge
                          tone="neutral"
                          appearance="stroke"
                          size={20}
                          numeric
                        >
                          {index + 1}
                        </Badge>
                        <strong className="text-sm">{step}</strong>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              ) : null}

              {active.checks ? (
                <Card>
                  <CardHeader>
                    <CardTitle>{t('finance_previews.screen.checks')}</CardTitle>
                  </CardHeader>
                  <CardContent className="divide-y divide-border">
                    {active.checks.map(([title, detail, target], index) => (
                      <Button
                        key={`${title}-${index}`}
                        type="button"
                        variant="ghost"
                        className="h-auto w-full justify-between whitespace-normal py-4 text-left"
                        onClick={() => goTo(target)}
                      >
                        <span>
                          <strong className="block">{title}</strong>
                          <span className="block text-sm text-muted-foreground">
                            {detail}
                          </span>
                        </span>
                        <ChevronRight className="size-4" aria-hidden="true" />
                      </Button>
                    ))}
                  </CardContent>
                </Card>
              ) : null}

              {hasForm ? (
                <Card>
                  <CardHeader>
                    <CardTitle>{t('finance_previews.screen.form')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <GenericPreviewForm
                      key={active.id}
                      screenId={active.id}
                      fields={form.fields}
                      initialValues={form.initialValues}
                      onPreview={() => goTo('s32')}
                    />
                  </CardContent>
                </Card>
              ) : null}

              {active.summary && active.id !== 's31' ? (
                <Card>
                  <CardHeader>
                    <CardTitle>{t('finance_previews.screen.facts')}</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-4 sm:grid-cols-3">
                    {active.summary.map(([label, value]) => (
                      <div key={label}>
                        <span className="block text-sm text-muted-foreground">
                          {label}
                        </span>
                        <strong>{value}</strong>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              ) : null}

              {active.links?.length ? (
                <Card>
                  <CardHeader>
                    <CardTitle>
                      {t('finance_previews.screen.related')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-wrap gap-2">
                    {active.links.map(([label, target]) => (
                      <Button
                        key={`${label}-${target}`}
                        type="button"
                        variant="outline"
                        onClick={() => goTo(target)}
                      >
                        {label}
                        <ArrowRight aria-hidden="true" />
                      </Button>
                    ))}
                  </CardContent>
                </Card>
              ) : null}

              {!special &&
              !active.rows &&
              !active.facts &&
              !active.steps &&
              !hasForm &&
              !active.series &&
              active.kind !== 'dashboard' &&
              active.kind !== 'fx' ? (
                <Card>
                  <CardContent className="flex flex-wrap items-center justify-between gap-4 p-6">
                    <div className="flex items-center gap-3">
                      <FileText
                        className="size-6 text-accent-indigo"
                        aria-hidden="true"
                      />
                      <p className="text-sm text-muted-foreground">
                        {active.subtitle}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="primary-filled"
                      onClick={() => goTo(active.next)}
                    >
                      {t('finance_previews.screen.next')}
                      <ArrowRight aria-hidden="true" />
                    </Button>
                  </CardContent>
                </Card>
              ) : null}
            </>
          )}
        </div>
        <CreateDemoRecordDialog
          screenId={active.id}
          open={createDialogOpen}
          onClose={() => setCreateDialogOpen(false)}
          onCreate={addDemoRow}
        />
        <Dialog
          open={selectedRecord !== null}
          onOpenChange={(isOpen) => !isOpen && setSelectedRecord(null)}
        >
          <DialogContent size="lg">
            <DialogHeader>
              <DialogTitle>
                {selectedRecord ? cellText(selectedRecord.cells[0] ?? '') : ''}
              </DialogTitle>
            </DialogHeader>
            <dl className="grid gap-4 sm:grid-cols-2">
              {selectedRecord?.cells.map((cell, index) => (
                <div
                  key={index}
                  className="rounded-lg border border-border p-4"
                >
                  <dt className="text-sm text-muted-foreground">
                    {selectedRecord.headings[index] ?? `${index + 1}`}
                  </dt>
                  <dd className="mt-1 font-medium">{cellText(cell)}</dd>
                </div>
              ))}
            </dl>
            {selectedRecord?.target ? (
              <Button
                type="button"
                variant="primary-filled"
                onClick={() => {
                  const target = selectedRecord.target
                  setSelectedRecord(null)
                  if (target) goTo(target)
                }}
              >
                {t('finance_previews.screen.sampleProcess')}
                <ArrowRight aria-hidden="true" />
              </Button>
            ) : null}
          </DialogContent>
        </Dialog>
      </PageBody>
    </Page>
  )
}
