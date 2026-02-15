"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Settings, Inbox, Copy } from 'lucide-react'

type ProposalRow = {
  id: string
  summary: string
  confidence: string
  status: string
  inboxEmailId: string
  createdAt: string
  participants?: { name: string; email: string }[]
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
  const color = STATUS_COLORS[status] || 'bg-gray-100 text-gray-800'
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium capitalize ${color}`}>{status}</span>
}

export default function InboxOpsProposalsPage() {
  const t = useT()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()

  const [items, setItems] = React.useState<ProposalRow[]>([])
  const [total, setTotal] = React.useState(0)
  const [page, setPage] = React.useState(1)
  const [pageSize] = React.useState(25)
  const [statusFilter, setStatusFilter] = React.useState<string | undefined>()
  const [search, setSearch] = React.useState('')
  const [isLoading, setIsLoading] = React.useState(true)
  const [counts, setCounts] = React.useState<StatusCounts>({ pending: 0, partial: 0, accepted: 0, rejected: 0 })
  const [settings, setSettings] = React.useState<{ inboxAddress?: string } | null>(null)
  const [copied, setCopied] = React.useState(false)

  const loadProposals = React.useCallback(async () => {
    setIsLoading(true)
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('pageSize', String(pageSize))
    if (statusFilter) params.set('status', statusFilter)
    if (search) params.set('search', search)

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
    loadProposals()
    loadCounts()
    loadSettings()
  }, [loadProposals, loadCounts, loadSettings])

  const handleCopyAddress = React.useCallback(() => {
    if (settings?.inboxAddress) {
      navigator.clipboard.writeText(settings.inboxAddress)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [settings])

  const columns: ColumnDef<ProposalRow>[] = React.useMemo(() => [
    {
      accessorKey: 'summary',
      header: t('inbox_ops.summary', 'Summary'),
      cell: ({ row }) => (
        <Link
          href={`/backend/inbox-ops/proposals/${row.original.id}`}
          className="text-sm font-medium text-primary hover:underline truncate max-w-[300px] block"
        >
          {row.original.summary?.slice(0, 80) || 'Untitled proposal'}
        </Link>
      ),
    },
    {
      accessorKey: 'status',
      header: t('inbox_ops.status.pending', 'Status'),
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      accessorKey: 'confidence',
      header: t('inbox_ops.confidence', 'Confidence'),
      cell: ({ row }) => <ConfidenceBadge value={row.original.confidence} />,
    },
    {
      accessorKey: 'createdAt',
      header: t('inbox_ops.received_at', 'Received'),
      cell: ({ row }) => {
        const d = new Date(row.original.createdAt)
        return <span className="text-sm text-muted-foreground">{d.toLocaleDateString()} {d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      },
    },
  ], [t])

  const totalCount = counts.pending + counts.partial + counts.accepted + counts.rejected
  const isEmpty = totalCount === 0 && !isLoading

  const tabs = [
    { label: `${t('common.all', 'All')} (${totalCount})`, value: undefined },
    { label: `${t('inbox_ops.status.pending', 'Pending')} (${counts.pending})`, value: 'pending' },
    { label: `${t('inbox_ops.status.partial', 'Partial')} (${counts.partial})`, value: 'partial' },
    { label: `${t('inbox_ops.status.accepted', 'Accepted')} (${counts.accepted})`, value: 'accepted' },
    { label: `${t('inbox_ops.status.rejected', 'Rejected')} (${counts.rejected})`, value: 'rejected' },
  ]

  return (
    <Page>
      <div className="flex items-center justify-between px-3 py-3 md:px-6 md:py-4">
        <h1 className="text-lg font-semibold">{t('inbox_ops.title', 'InboxOps')}</h1>
        <Link href="/backend/inbox-ops/settings">
          <Button variant="outline" size="sm">
            <Settings className="h-4 w-4" />
            <span className="hidden md:inline ml-1">{t('inbox_ops.settings.title', 'Settings')}</span>
          </Button>
        </Link>
      </div>

      <PageBody>
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Inbox className="h-12 w-12 text-muted-foreground mb-4" />
            <h2 className="text-lg font-semibold mb-2">{t('inbox_ops.empty.title', 'Forward emails to start')}</h2>
            {settings?.inboxAddress && (
              <div className="mt-4 flex items-center gap-2 bg-muted rounded-lg px-4 py-3">
                <code className="text-sm font-mono">{settings.inboxAddress}</code>
                <Button variant="outline" size="sm" onClick={handleCopyAddress}>
                  <Copy className="h-4 w-4" />
                  {copied ? 'Copied!' : 'Copy'}
                </Button>
              </div>
            )}
            <ol className="mt-6 text-sm text-muted-foreground text-left space-y-2">
              <li>1. {t('inbox_ops.empty.step1', 'Forward any email thread to this address')}</li>
              <li>2. {t('inbox_ops.empty.step2', "We'll analyze it and propose actions")}</li>
              <li>3. {t('inbox_ops.empty.step3', 'Review and accept with one click')}</li>
            </ol>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 px-3 py-2 md:px-0 overflow-x-auto">
              {tabs.map((tab) => (
                <Button
                  key={tab.value ?? 'all'}
                  variant={statusFilter === tab.value ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => { setStatusFilter(tab.value); setPage(1) }}
                >
                  {tab.label}
                </Button>
              ))}
            </div>

            <div className="overflow-auto">
              <div className="min-w-[640px]">
                <DataTable
                  columns={columns}
                  data={items}
                  isLoading={isLoading}
                  onRowClick={(row) => router.push(`/backend/inbox-ops/proposals/${row.id}`)}
                  pagination={{
                    page,
                    pageSize,
                    total,
                    totalPages: Math.ceil(total / pageSize),
                    onPageChange: setPage,
                  }}
                />
              </div>
            </div>
          </>
        )}
      </PageBody>
    </Page>
  )
}
