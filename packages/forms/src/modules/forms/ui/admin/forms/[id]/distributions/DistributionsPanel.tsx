"use client"

import * as React from 'react'
import { Plus } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions, type RowActionItem } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { CreateDistributionDialog } from './CreateDistributionDialog'
import { EmbedSettingsDialog } from './EmbedSettingsDialog'
import { RecipientsTable } from './RecipientsTable'

export type DistributionMode = 'open' | 'personal'
export type DistributionStatus = 'active' | 'paused' | 'closed'

export type DistributionRow = {
  id: string
  formId: string
  mode: DistributionMode
  status: DistributionStatus
  publicSlug: string | null
  title: string | null
  defaultLocale: string
  pinnedVersionId: string | null
  requireCustomerAuth: boolean
  allowMultipleSubmissions: boolean
  maxResponses: number | null
  responseCount: number
  opensAt: string | null
  closesAt: string | null
  redirectUrl: string | null
  createdAt: string
  updatedAt: string
}

type DistributionListResponse = {
  items: DistributionRow[]
  total: number
}

type FormSummaryResponse = {
  id: string
  name: string
}

const STATUS_VARIANT: Record<DistributionStatus, StatusBadgeVariant> = {
  active: 'success',
  paused: 'warning',
  closed: 'neutral',
}

function formatDate(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString()
}

function publicLinkFor(slug: string | null): string | null {
  if (!slug) return null
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}/f/${slug}`
}

async function copyToClipboard(value: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    return false
  }
  return false
}

export function DistributionsPanel({ formId }: { formId: string }) {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation } = useGuardedMutation({ contextId: 'forms.distributions' })

  const [rows, setRows] = React.useState<DistributionRow[]>([])
  const [total, setTotal] = React.useState(0)
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [formName, setFormName] = React.useState<string | null>(null)
  const [createOpen, setCreateOpen] = React.useState(false)
  const [recipientsFor, setRecipientsFor] = React.useState<DistributionRow | null>(null)
  const [embedFor, setEmbedFor] = React.useState<DistributionRow | null>(null)

  const reload = React.useCallback(() => setReloadToken((token) => token + 1), [])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      try {
        const [listResp, summaryResp] = await Promise.all([
          apiCall<DistributionListResponse>(
            `/api/forms/${encodeURIComponent(formId)}/distributions`,
          ),
          apiCall<FormSummaryResponse>(`/api/forms/${encodeURIComponent(formId)}`),
        ])
        if (cancelled) return
        if (!listResp.ok || !listResp.result) {
          flash('forms.distribution.errors.load', 'error')
          return
        }
        setRows(listResp.result.items)
        setTotal(listResp.result.total)
        if (summaryResp.ok && summaryResp.result) {
          setFormName(summaryResp.result.name)
        }
      } catch (error) {
        if (!cancelled) {
          flash(error instanceof Error ? error.message : 'forms.distribution.errors.load', 'error')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [formId, reloadToken, scopeVersion])

  const handleCopyLink = React.useCallback(
    async (row: DistributionRow) => {
      const link = publicLinkFor(row.publicSlug)
      if (!link) {
        flash('forms.distribution.copy.unavailable', 'error')
        return
      }
      const copied = await copyToClipboard(link)
      flash(copied ? 'forms.distribution.copy.success' : 'forms.distribution.copy.failed', copied ? 'success' : 'error')
    },
    [],
  )

  const patchStatus = React.useCallback(
    async (row: DistributionRow, nextStatus: DistributionStatus) => {
      await runMutation({
        operation: async () => {
          const resp = await apiCall(`/api/forms/distributions/${encodeURIComponent(row.id)}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ status: nextStatus }),
          })
          if (!resp.ok) {
            flash('forms.distribution.status.failed', 'error')
            throw new Error('forms.distribution.status.failed')
          }
          flash('forms.distribution.status.success', 'success')
          reload()
        },
        context: { distributionId: row.id, nextStatus },
        mutationPayload: { distributionId: row.id, status: nextStatus },
      })
    },
    [reload, runMutation],
  )

  const handlePause = React.useCallback(
    async (row: DistributionRow) => {
      const next: DistributionStatus = row.status === 'paused' ? 'active' : 'paused'
      await patchStatus(row, next).catch(() => undefined)
    },
    [patchStatus],
  )

  const handleClose = React.useCallback(
    async (row: DistributionRow) => {
      const ok = await confirm({
        title: t('forms.distribution.close.confirm', { fallback: 'Close this distribution?' }),
        description: t('forms.distribution.close.body', {
          fallback: 'Closing stops all new submissions. This cannot be undone.',
        }),
        variant: 'destructive',
      })
      if (!ok) return
      await patchStatus(row, 'closed').catch(() => undefined)
    },
    [confirm, patchStatus, t],
  )

  const columns = React.useMemo<ColumnDef<DistributionRow>[]>(
    () => [
      {
        header: t('forms.distribution.columns.title', { fallback: 'Title / mode' }),
        accessorKey: 'title',
        cell: ({ row }) => (
          <div className="flex flex-col gap-0.5">
            <span className="font-medium text-foreground">
              {row.original.title ?? t('forms.distribution.untitled', { fallback: 'Untitled distribution' })}
            </span>
            <span className="text-xs text-muted-foreground">
              {row.original.mode === 'open'
                ? t('forms.distribution.mode.open', { fallback: 'Open link' })
                : t('forms.distribution.mode.personal', { fallback: 'Personal invitations' })}
            </span>
          </div>
        ),
        meta: { truncate: true, maxWidth: 260 },
      },
      {
        header: t('forms.distribution.columns.status', { fallback: 'Status' }),
        accessorKey: 'status',
        cell: ({ row }) => (
          <StatusBadge variant={STATUS_VARIANT[row.original.status] ?? 'neutral'} dot>
            {t(`forms.distribution.status.${row.original.status}`, { fallback: row.original.status })}
          </StatusBadge>
        ),
      },
      {
        header: t('forms.distribution.columns.link', { fallback: 'Public link' }),
        accessorKey: 'publicSlug',
        cell: ({ row }) => {
          if (row.original.mode !== 'open' || !row.original.publicSlug) {
            return <span className="text-muted-foreground">—</span>
          }
          return (
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={(event) => {
                event.stopPropagation()
                void handleCopyLink(row.original)
              }}
            >
              {t('forms.distribution.copy.action', { fallback: 'Copy link' })}
            </Button>
          )
        },
      },
      {
        header: t('forms.distribution.columns.responses', { fallback: 'Responses' }),
        accessorKey: 'responseCount',
        cell: ({ row }) => {
          const max = row.original.maxResponses
          return (
            <span className="font-mono text-xs text-foreground">
              {row.original.responseCount}
              {max != null ? ` / ${max}` : ''}
            </span>
          )
        },
      },
      {
        header: t('forms.distribution.columns.created_at', { fallback: 'Created' }),
        accessorKey: 'createdAt',
        cell: ({ row }) => formatDate(row.original.createdAt) || '—',
      },
    ],
    [handleCopyLink, t],
  )

  const renderRowActions = React.useCallback(
    (row: DistributionRow) => {
      const list: RowActionItem[] = []
      if (row.mode === 'personal') {
        list.push({
          id: 'recipients',
          label: t('forms.distribution.actions.recipients', { fallback: 'Manage recipients' }),
          onSelect: () => setRecipientsFor(row),
        })
      }
      if (row.mode === 'open') {
        list.push({
          id: 'copy',
          label: t('forms.distribution.copy.action', { fallback: 'Copy link' }),
          onSelect: () => void handleCopyLink(row),
        })
        list.push({
          id: 'embed',
          label: t('forms.distribution.actions.embed', { fallback: 'Website embed' }),
          onSelect: () => setEmbedFor(row),
        })
      }
      if (row.status !== 'closed') {
        list.push({
          id: 'pause',
          label:
            row.status === 'paused'
              ? t('forms.distribution.actions.resume', { fallback: 'Resume' })
              : t('forms.distribution.actions.pause', { fallback: 'Pause' }),
          onSelect: () => void handlePause(row),
        })
        list.push({
          id: 'close',
          label: t('forms.distribution.actions.close', { fallback: 'Close' }),
          destructive: true,
          onSelect: () => void handleClose(row),
        })
      }
      return <RowActions items={list} />
    },
    [handleClose, handleCopyLink, handlePause, t],
  )

  return (
    <Page>
      <PageBody>
        <DataTable
          title={
            formName
              ? `${formName} · ${t('forms.distribution.title', { fallback: 'Distribution' })}`
              : t('forms.distribution.title', { fallback: 'Distribution' })
          }
          columns={columns}
          data={rows}
          isLoading={isLoading}
          pagination={{
            page: 1,
            pageSize: 100,
            total,
            totalPages: 1,
            onPageChange: () => undefined,
          }}
          rowActions={renderRowActions}
          actions={
            <Button type="button" size="default" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
              {t('forms.distribution.actions.new', { fallback: 'New distribution' })}
            </Button>
          }
          emptyState={t('forms.distribution.empty', { fallback: 'No distributions yet.' })}
        />

        {createOpen ? (
          <CreateDistributionDialog
            formId={formId}
            onClose={() => setCreateOpen(false)}
            onCreated={() => {
              setCreateOpen(false)
              reload()
            }}
          />
        ) : null}

        {recipientsFor ? (
          <RecipientsTable
            distributionId={recipientsFor.id}
            distributionTitle={recipientsFor.title}
            onClose={() => setRecipientsFor(null)}
            onMutated={reload}
          />
        ) : null}

        {embedFor ? (
          <EmbedSettingsDialog
            distributionId={embedFor.id}
            publicSlug={embedFor.publicSlug}
            onClose={() => setEmbedFor(null)}
            onSaved={() => {
              setEmbedFor(null)
              reload()
            }}
          />
        ) : null}

        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
