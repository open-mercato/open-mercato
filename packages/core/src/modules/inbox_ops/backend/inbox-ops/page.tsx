"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import type { ColumnDef } from '@tanstack/react-table'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { Settings, Inbox, Copy } from 'lucide-react'

type ProposalRow = {
  id: string
  summary: string
  confidence: string
  status: string
  inboxEmailId: string
  createdAt: string
  participants?: { name: string; email: string }[]
  actionCount?: number
  pendingActionCount?: number
  discrepancyCount?: number
  emailSubject?: string | null
  emailFrom?: string | null
  receivedAt?: string | null
}

type ProposalListResponse = {
  items?: ProposalRow[]
  total?: number
  page?: number
  totalPages?: number
}

type StatusCounts = {
  pending: number
  partial: number
  accepted: number
  rejected: number
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  partial: 'bg-blue-100 text-blue-800',
  accepted: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  processing: 'bg-purple-100 text-purple-800',
}

function ConfidenceBadge({ value }: { value: string }) {
  const num = parseFloat(value)
  const pct = Math.round(num * 100)
  const color = num >= 0.8 ? 'bg-green-100 text-green-800' : num >= 0.6 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${color}`}>{pct}%</span>
}

function StatusBadge({ status }: { status: string }) {
  const t = useT()
  const statusLabels: Record<string, string> = {
    pending: t('inbox_ops.status.pending', 'Pending'),
    partial: t('inbox_ops.status.partial', 'Partial'),
    accepted: t('inbox_ops.status.accepted', 'Accepted'),
    rejected: t('inbox_ops.status.rejected', 'Rejected'),
    processing: t('inbox_ops.status.processing', 'Processing'),
  }
  const color = STATUS_COLORS[status] || 'bg-gray-100 text-gray-800'
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${color}`}>{statusLabels[status] || status}</span>
}

export default function InboxOpsProposalsPage() {
  const t = useT()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const [items, setItems] = React.useState<ProposalRow[]>([])
  const [total, setTotal] = React.useState(0)
  const [page, setPage] = React.useState(1)
  const [pageSize] = React.useState(25)
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [search, setSearch] = React.useState('')
  const [isLoading, setIsLoading] = React.useState(true)
  const [initialLoadComplete, setInitialLoadComplete] = React.useState(false)
  const [counts, setCounts] = React.useState<StatusCounts>({ pending: 0, partial: 0, accepted: 0, rejected: 0 })
  const [settings, setSettings] = React.useState<{ inboxAddress?: string } | null>(null)
  const [copied, setCopied] = React.useState(false)

  const statusFilter = typeof filterValues.status === 'string' ? filterValues.status : undefined

  const loadProposals = React.useCallback(async () => {
    setIsLoading(true)
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('pageSize', String(pageSize))
    if (statusFilter) params.set('status', statusFilter)
    if (search.trim()) params.set('search', search.trim())

    const result = await apiCall<ProposalListResponse>(`/api/inbox_ops/proposals?${params}`)
    if (result?.ok && result.result?.items) {
      setItems(result.result.items)
      setTotal(result.result.total || 0)
    }
    setIsLoading(false)
  }, [page, pageSize, statusFilter, search, scopeVersion])

  const loadCounts = React.useCallback(async () => {
    const result = await apiCall<StatusCounts>('/api/inbox_ops/proposals/counts')
    if (result?.ok && result.result) setCounts(result.result)
  }, [scopeVersion])

  const loadSettings = React.useCallback(async () => {
    const result = await apiCall<{ settings: { inboxAddress?: string } | null }>('/api/inbox_ops/settings')
    if (result?.ok && result.result?.settings) setSettings(result.result.settings)
  }, [scopeVersion])

  React.useEffect(() => {
    Promise.all([loadProposals(), loadCounts(), loadSettings()]).then(() => {
      setInitialLoadComplete(true)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (initialLoadComplete) loadProposals()
  }, [page, statusFilter, search, scopeVersion]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleCopyAddress = React.useCallback(() => {
    if (settings?.inboxAddress) {
      navigator.clipboard.writeText(settings.inboxAddress)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [settings])

  const handleRefresh = React.useCallback(() => {
    loadProposals()
    loadCounts()
  }, [loadProposals, loadCounts])

  const handleFiltersApply = React.useCallback((values: FilterValues) => {
    setFilterValues(values)
    setPage(1)
  }, [])

  const handleFiltersClear = React.useCallback(() => {
    setFilterValues({})
    setPage(1)
  }, [])

  const handleRejectProposal = React.useCallback(async (proposalId: string) => {
    const confirmed = await confirm({
      title: t('inbox_ops.action.reject_all', 'Reject Proposal'),
      text: t('inbox_ops.action.reject_all_confirm', 'Reject all pending actions in this proposal?'),
    })
    if (!confirmed) return

    const result = await apiCall<{ ok: boolean }>(
      `/api/inbox_ops/proposals/${proposalId}/reject`,
      { method: 'POST' },
    )
    if (result?.ok && result.result?.ok) {
      flash(t('inbox_ops.action.proposal_rejected', 'Proposal rejected'), 'success')
      loadProposals()
      loadCounts()
    } else {
      flash(t('inbox_ops.flash.action_reject_failed', 'Failed to reject'), 'error')
    }
  }, [confirm, t, loadProposals, loadCounts])

  const filters = React.useMemo<FilterDef[]>(() => [
    {
      id: 'status',
      label: t('inbox_ops.list.filters.status', 'Status'),
      type: 'select',
      options: [
        { value: 'pending', label: `${t('inbox_ops.status.pending', 'Pending')} (${counts.pending})` },
        { value: 'partial', label: `${t('inbox_ops.status.partial', 'Partial')} (${counts.partial})` },
        { value: 'accepted', label: `${t('inbox_ops.status.accepted', 'Accepted')} (${counts.accepted})` },
        { value: 'rejected', label: `${t('inbox_ops.status.rejected', 'Rejected')} (${counts.rejected})` },
      ],
    },
  ], [t, counts])

  const columns: ColumnDef<ProposalRow>[] = React.useMemo(() => [
    {
      accessorKey: 'summary',
      header: t('inbox_ops.summary', 'Summary'),
      cell: ({ row }) => (
        <div className="min-w-0">
          <Link
            href={`/backend/inbox-ops/proposals/${row.original.id}`}
            className="text-sm font-medium text-primary hover:underline truncate max-w-[300px] block"
          >
            {row.original.emailSubject || row.original.summary?.slice(0, 80) || t('inbox_ops.untitled_proposal', 'Untitled proposal')}
          </Link>
          {row.original.emailFrom && (
            <span className="text-xs text-muted-foreground truncate block">{row.original.emailFrom}</span>
          )}
        </div>
      ),
    },
    {
      accessorKey: 'status',
      header: t('inbox_ops.list.status', 'Status'),
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      id: 'actions_count',
      header: t('inbox_ops.list.progress', 'Progress'),
      cell: ({ row }) => {
        const pending = row.original.pendingActionCount ?? 0
        const total = row.original.actionCount ?? 0
        if (total === 0) return <span className="text-sm text-muted-foreground">—</span>
        return (
          <span className="text-sm text-muted-foreground">
            {t('inbox_ops.list.action_summary', '{pending}/{total} actions')
              .replace('{pending}', String(pending))
              .replace('{total}', String(total))}
          </span>
        )
      },
    },
    {
      accessorKey: 'confidence',
      header: t('inbox_ops.confidence', 'Confidence'),
      cell: ({ row }) => <ConfidenceBadge value={row.original.confidence} />,
    },
    {
      accessorKey: 'receivedAt',
      header: t('inbox_ops.received_at', 'Received'),
      cell: ({ row }) => {
        const dateStr = row.original.receivedAt || row.original.createdAt
        const d = new Date(dateStr)
        return <span className="text-sm text-muted-foreground">{d.toLocaleDateString()} {d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      },
    },
  ], [t])

  const totalCount = counts.pending + counts.partial + counts.accepted + counts.rejected

  const emptyStateContent = initialLoadComplete && totalCount === 0 ? (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <Inbox className="h-12 w-12 text-muted-foreground mb-4" />
      <h2 className="text-lg font-semibold mb-2">{t('inbox_ops.empty.title', 'Forward emails to start')}</h2>
      {settings?.inboxAddress && (
        <div className="mt-4 flex items-center gap-2 bg-muted rounded-lg px-4 py-3">
          <code className="text-sm font-mono">{settings.inboxAddress}</code>
          <Button variant="outline" size="sm" onClick={handleCopyAddress}>
            <Copy className="h-4 w-4" />
            {copied ? t('inbox_ops.settings.copied', 'Copied') : t('inbox_ops.settings.copy', 'Copy')}
          </Button>
        </div>
      )}
      <ol className="mt-6 text-sm text-muted-foreground text-left space-y-2">
        <li>1. {t('inbox_ops.empty.step1', 'Forward any email thread to this address')}</li>
        <li>2. {t('inbox_ops.empty.step2', "We'll analyze it and propose actions")}</li>
        <li>3. {t('inbox_ops.empty.step3', 'Review and accept with one click')}</li>
      </ol>
    </div>
  ) : undefined

  return (
    <Page>
      <PageBody>
        <DataTable<ProposalRow>
          title={t('inbox_ops.title', 'AI Inbox Actions')}
          refreshButton={{
            label: t('inbox_ops.list.actions.refresh', 'Refresh'),
            onRefresh: handleRefresh,
          }}
          actions={(
            <div className="flex items-center gap-2">
              {settings?.inboxAddress && (
                <Button variant="outline" size="sm" onClick={handleCopyAddress}>
                  <Copy className="h-4 w-4" />
                  <span className="hidden md:inline ml-1">
                    {copied ? t('inbox_ops.settings.copied', 'Copied') : t('inbox_ops.settings.copy', 'Copy')}
                  </span>
                </Button>
              )}
              <Button variant="outline" size="sm" asChild>
                <Link href="/backend/inbox-ops/settings">
                  <Settings className="h-4 w-4" />
                  <span className="hidden md:inline ml-1">{t('inbox_ops.list.actions.settings', 'Settings')}</span>
                </Link>
              </Button>
            </div>
          )}
          columns={columns}
          data={items}
          searchValue={search}
          onSearchChange={(value) => { setSearch(value); setPage(1) }}
          searchPlaceholder={t('inbox_ops.list.searchPlaceholder', 'Search proposals...')}
          filters={filters}
          filterValues={filterValues}
          onFiltersApply={handleFiltersApply}
          onFiltersClear={handleFiltersClear}
          onRowClick={(row) => router.push(`/backend/inbox-ops/proposals/${row.id}`)}
          rowActions={(row) => (
            <RowActions items={[
              {
                id: 'view',
                label: t('inbox_ops.list.actions.view', 'View'),
                onSelect: () => router.push(`/backend/inbox-ops/proposals/${row.id}`),
              },
              ...(row.status === 'pending' || row.status === 'partial' ? [{
                id: 'reject',
                label: t('inbox_ops.list.actions.reject', 'Reject'),
                destructive: true,
                onSelect: () => handleRejectProposal(row.id),
              }] : []),
            ]} />
          )}
          pagination={{
            page,
            pageSize,
            total,
            totalPages: Math.ceil(total / pageSize),
            onPageChange: setPage,
          }}
          isLoading={isLoading}
          emptyState={emptyStateContent}
        />
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}
