"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { Info } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Avatar, AvatarStack } from '@open-mercato/ui/primitives/avatar'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { formatCostMinor } from '../../components/types'
import {
  buildSampleProcessList,
  PROCESS_STATUS_LABEL_KEY,
  PROCESS_STATUS_TONE,
  type AgentProcessStatus,
  type ProcessListRow,
} from '../../components/processTypes'

type Facet = 'all' | 'needs_decision' | 'stuck' | 'high_value' | 'fraud'

const HIGH_VALUE_MINOR = 4_000_000
const STUCK_MS = 24 * 60 * 60 * 1000
const NEEDS_DECISION: AgentProcessStatus[] = ['waiting_on_you', 'question_open', 'docs_requested']

function ageOf(iso: string): number {
  const parsed = Date.parse(iso)
  return Number.isFinite(parsed) ? Math.max(0, Date.now() - parsed) : 0
}

function ageShort(iso: string): string {
  const ms = ageOf(iso)
  const days = Math.floor(ms / (24 * 60 * 60 * 1000))
  const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000))
  const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000))
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h`
  return `${minutes}m`
}

function matchesFacet(row: ProcessListRow, facet: Facet): boolean {
  switch (facet) {
    case 'needs_decision':
      return NEEDS_DECISION.includes(row.status)
    case 'stuck':
      return ageOf(row.openedAt) >= STUCK_MS
    case 'high_value':
      return row.subjectValueMinor >= HIGH_VALUE_MINOR
    case 'fraud':
      return row.subjectFraud
    default:
      return true
  }
}

export default function ProcessesListPage() {
  const t = useT()
  const router = useRouter()
  const [facet, setFacet] = React.useState<Facet>('all')

  const rows = React.useMemo(() => buildSampleProcessList(), [])
  const filtered = React.useMemo(() => rows.filter((row) => matchesFacet(row, facet)), [rows, facet])

  const facetTabs: Array<{ key: Facet; label: string; count: number }> = [
    { key: 'all', label: t('agent_orchestrator.process.facet.all'), count: rows.length },
    {
      key: 'needs_decision',
      label: t('agent_orchestrator.process.facet.needsDecision'),
      count: rows.filter((row) => matchesFacet(row, 'needs_decision')).length,
    },
    {
      key: 'stuck',
      label: t('agent_orchestrator.process.facet.stuck'),
      count: rows.filter((row) => matchesFacet(row, 'stuck')).length,
    },
    {
      key: 'high_value',
      label: t('agent_orchestrator.process.facet.highValue'),
      count: rows.filter((row) => matchesFacet(row, 'high_value')).length,
    },
    {
      key: 'fraud',
      label: t('agent_orchestrator.process.facet.fraud'),
      count: rows.filter((row) => matchesFacet(row, 'fraud')).length,
    },
  ]

  const columns = React.useMemo<ColumnDef<ProcessListRow>[]>(
    () => [
      {
        accessorKey: 'subjectLabel',
        header: t('agent_orchestrator.process.list.col.claim'),
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="font-mono text-sm font-medium text-foreground">{row.original.subjectLabel}</div>
            <div className="truncate text-xs text-muted-foreground">{row.original.subjectTitle}</div>
          </div>
        ),
      },
      {
        accessorKey: 'subjectType',
        header: t('agent_orchestrator.process.list.col.type'),
        cell: ({ row }) => <span className="text-sm text-foreground">{row.original.subjectType}</span>,
      },
      {
        accessorKey: 'currentStage',
        header: t('agent_orchestrator.process.list.col.stage'),
        cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.currentStage}</span>,
      },
      {
        accessorKey: 'agentIds',
        header: t('agent_orchestrator.process.list.col.agents'),
        enableSorting: false,
        cell: ({ row }) => (
          <AvatarStack max={4}>
            {row.original.agentIds.map((agent) => (
              <Avatar key={agent} label={agent} size="sm" />
            ))}
          </AvatarStack>
        ),
      },
      {
        accessorKey: 'status',
        header: t('agent_orchestrator.process.list.col.status'),
        cell: ({ row }) => (
          <StatusBadge variant={PROCESS_STATUS_TONE[row.original.status]} dot>
            {t(PROCESS_STATUS_LABEL_KEY[row.original.status])}
          </StatusBadge>
        ),
      },
      {
        accessorKey: 'openedAt',
        header: t('agent_orchestrator.process.list.col.age'),
        cell: ({ row }) => (
          <span className="text-sm tabular-nums text-muted-foreground">{ageShort(row.original.openedAt)}</span>
        ),
      },
      {
        accessorKey: 'costMinor',
        header: t('agent_orchestrator.process.list.col.cost'),
        cell: ({ row }) => (
          <span className="text-sm tabular-nums text-muted-foreground">
            {formatCostMinor(row.original.costMinor, row.original.currency) ?? '—'}
          </span>
        ),
      },
    ],
    [t],
  )

  return (
    <Page>
      <PageBody className="space-y-4">
        <div>
          <h1 className="text-lg font-semibold">{t('agent_orchestrator.process.list.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('agent_orchestrator.process.list.subtitle')}</p>
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <p>
            <span className="mr-1.5 rounded-md border border-border bg-card px-1.5 py-0.5 font-medium text-foreground">
              {t('agent_orchestrator.process.preview')}
            </span>
            {t('agent_orchestrator.process.previewNote')}
          </p>
        </div>

        <div className="flex flex-nowrap items-center gap-4 overflow-x-auto border-b border-border">
          {facetTabs.map((tab) => {
            const active = facet === tab.key
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setFacet(tab.key)}
                className={cn(
                  '-mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 py-2.5 text-sm transition-colors',
                  active
                    ? 'border-brand-violet font-semibold text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {tab.label}
                <span
                  className={cn(
                    'inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-medium tabular-nums',
                    active ? 'bg-brand-violet/10 text-brand-violet' : 'bg-muted text-muted-foreground',
                  )}
                >
                  {tab.count}
                </span>
              </button>
            )
          })}
        </div>

        <DataTable<ProcessListRow>
          columns={columns}
          data={filtered}
          sortable
          onRowClick={(row) => router.push(`/backend/processes/${encodeURIComponent(row.id)}`)}
        />
      </PageBody>
    </Page>
  )
}
