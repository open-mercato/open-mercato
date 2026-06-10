'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

const PAGE_SIZE = 50

type ModerationCategory = { flagged: boolean; score: number }

type ModerationFlagRow = {
  id: string
  tenantId: string
  organizationId: string | null
  agentId: string
  userId: string
  providerId: string
  modelId: string
  categories: Record<string, ModerationCategory>
  createdAt: string
}

type ModerationFlagsResponse = {
  items: ModerationFlagRow[]
  total: number
  page: number
  pageSize: number
}

async function fetchModerationFlags(params: {
  page: number
  from: string
  to: string
  agentId: string
  userId: string
}): Promise<ModerationFlagsResponse> {
  const search = new URLSearchParams()
  search.set('page', String(params.page))
  search.set('pageSize', String(PAGE_SIZE))
  if (params.from) search.set('from', params.from)
  if (params.to) search.set('to', params.to)
  if (params.agentId) search.set('agentId', params.agentId)
  if (params.userId) search.set('userId', params.userId)
  const { result, status } = await apiCallOrThrow<ModerationFlagsResponse>(
    `/api/ai_assistant/moderation-flags?${search.toString()}`,
    undefined,
    { errorMessage: 'Failed to load moderation flags' },
  )
  if (!result) throw new Error(`Failed to load moderation flags (${status})`)
  return result
}

function flaggedCategoryNames(categories: Record<string, ModerationCategory>): string[] {
  return Object.entries(categories)
    .filter(([, value]) => value.flagged)
    .map(([name]) => name)
}

export function AiModerationFlagsPageClient() {
  const t = useT()
  const [page, setPage] = React.useState(1)
  const [from, setFrom] = React.useState('')
  const [to, setTo] = React.useState('')
  const [agentId, setAgentId] = React.useState('')
  const [userId, setUserId] = React.useState('')
  const [applied, setApplied] = React.useState({ from: '', to: '', agentId: '', userId: '' })

  const query = useQuery<ModerationFlagsResponse>({
    queryKey: ['ai_assistant', 'moderation_flags', page, applied],
    queryFn: () => fetchModerationFlags({ page, ...applied }),
    retry: false,
  })

  const applyFilters = React.useCallback(() => {
    setPage(1)
    setApplied({ from, to, agentId, userId })
  }, [from, to, agentId, userId])

  const columns = React.useMemo<ColumnDef<ModerationFlagRow, unknown>[]>(
    () => [
      {
        accessorKey: 'agentId',
        header: t('ai_assistant.moderationFlags.columns.agent', 'Agent'),
      },
      {
        accessorKey: 'userId',
        header: t('ai_assistant.moderationFlags.columns.user', 'User'),
        meta: { truncate: true, maxWidth: 220 },
      },
      {
        accessorKey: 'categories',
        header: t('ai_assistant.moderationFlags.columns.categories', 'Categories'),
        cell: ({ row }) => {
          const names = flaggedCategoryNames(row.original.categories)
          if (names.length === 0) {
            return <span className="text-muted-foreground">—</span>
          }
          return (
            <div className="flex flex-wrap gap-1">
              {names.map((name) => (
                <StatusBadge key={name} variant="error" dot>
                  {name}
                </StatusBadge>
              ))}
            </div>
          )
        },
      },
      {
        accessorKey: 'createdAt',
        header: t('ai_assistant.moderationFlags.columns.createdAt', 'Flagged at'),
        cell: ({ row }) => new Date(row.original.createdAt).toLocaleString(),
      },
    ],
    [t],
  )

  const total = query.data?.total ?? 0

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">
          {t('ai_assistant.moderationFlags.title', 'Moderation flags')}
        </h2>
        <p className="text-xs text-muted-foreground">
          {t(
            'ai_assistant.moderationFlags.subtitle',
            'Inputs blocked by the content safety filter. Category flags and scores only — no prompt content is stored.',
          )}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="moderation-from">{t('ai_assistant.moderationFlags.filters.from', 'From')}</Label>
          <Input id="moderation-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="moderation-to">{t('ai_assistant.moderationFlags.filters.to', 'To')}</Label>
          <Input id="moderation-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="moderation-agent">{t('ai_assistant.moderationFlags.columns.agent', 'Agent')}</Label>
          <Input
            id="moderation-agent"
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            placeholder={t('ai_assistant.moderationFlags.filters.agentPlaceholder', 'module.agent')}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="moderation-user">{t('ai_assistant.moderationFlags.columns.user', 'User')}</Label>
          <Input id="moderation-user" value={userId} onChange={(e) => setUserId(e.target.value)} />
        </div>
        <Button type="button" variant="outline" onClick={applyFilters}>
          {t('ai_assistant.moderationFlags.filters.apply', 'Apply')}
        </Button>
      </div>

      <DataTable<ModerationFlagRow>
        columns={columns}
        data={query.data?.items ?? []}
        isLoading={query.isLoading}
        error={query.error ? (query.error as Error).message : undefined}
        emptyState={t('ai_assistant.moderationFlags.empty', 'No flagged messages.')}
        pagination={{
          page,
          pageSize: PAGE_SIZE,
          total,
          totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
          onPageChange: setPage,
        }}
      />
    </div>
  )
}

export default AiModerationFlagsPageClient
