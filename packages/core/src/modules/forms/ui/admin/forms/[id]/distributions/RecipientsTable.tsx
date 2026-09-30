"use client"

import * as React from 'react'
import { Copy, X } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions, type RowActionItem } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { KbdShortcut } from '@open-mercato/ui/primitives/kbd'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type InvitationStatus =
  | 'pending'
  | 'sent'
  | 'opened'
  | 'started'
  | 'submitted'
  | 'expired'
  | 'revoked'

export type InvitationRow = {
  id: string
  recipientEmail: string | null
  recipientName: string | null
  recipientRef: string | null
  role: string | null
  status: InvitationStatus
  locale: string | null
  sentAt: string | null
  openedAt: string | null
  startedAt: string | null
  submittedAt: string | null
  expiresAt: string | null
  sendCount: number
  lastError: string | null
  createdAt: string
}

type InvitationListResponse = {
  items: InvitationRow[]
  total: number
}

type CreatedInvitation = {
  id: string
  rawToken: string | null
}

type CreateInvitationsResponse = {
  invitations: CreatedInvitation[]
}

type RecipientInput = {
  email?: string
  name?: string
}

const STATUS_VARIANT: Record<InvitationStatus, StatusBadgeVariant> = {
  pending: 'neutral',
  sent: 'info',
  opened: 'info',
  started: 'warning',
  submitted: 'success',
  expired: 'neutral',
  revoked: 'error',
}

function formatDate(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString()
}

function parseRecipients(raw: string): RecipientInput[] {
  const recipients: RecipientInput[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const [emailPart, ...nameParts] = trimmed.split(',')
    const email = emailPart.trim()
    if (!email) continue
    const name = nameParts.join(',').trim()
    recipients.push(name ? { email, name } : { email })
  }
  return recipients
}

function personalLinkFor(token: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}/i/${token}`
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

export function RecipientsTable({
  distributionId,
  distributionTitle,
  onClose,
  onMutated,
}: {
  distributionId: string
  distributionTitle: string | null
  onClose: () => void
  onMutated?: () => void
}) {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation } = useGuardedMutation({ contextId: 'forms.invitations' })

  const [rows, setRows] = React.useState<InvitationRow[]>([])
  const [total, setTotal] = React.useState(0)
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [bulkValue, setBulkValue] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const [createdLinks, setCreatedLinks] = React.useState<string[]>([])

  const reload = React.useCallback(() => setReloadToken((token) => token + 1), [])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      try {
        const resp = await apiCall<InvitationListResponse>(
          `/api/forms/distributions/${encodeURIComponent(distributionId)}/invitations`,
        )
        if (cancelled) return
        if (!resp.ok || !resp.result) {
          flash('forms.invitation.errors.load', 'error')
          return
        }
        setRows(resp.result.items)
        setTotal(resp.result.total)
      } catch (error) {
        if (!cancelled) {
          flash(error instanceof Error ? error.message : 'forms.invitation.errors.load', 'error')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [distributionId, reloadToken])

  React.useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  const handleBulkAdd = React.useCallback(async () => {
    if (submitting) return
    const recipients = parseRecipients(bulkValue)
    if (recipients.length === 0) {
      flash('forms.invitation.add.empty', 'error')
      return
    }
    setSubmitting(true)
    try {
      await runMutation({
        operation: async () => {
          const resp = await apiCall<CreateInvitationsResponse>(
            `/api/forms/distributions/${encodeURIComponent(distributionId)}/invitations`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ recipients }),
            },
          )
          if (!resp.ok || !resp.result) {
            flash('forms.invitation.add.failed', 'error')
            throw new Error('forms.invitation.add.failed')
          }
          const links = resp.result.invitations
            .map((invitation) => (invitation.rawToken ? personalLinkFor(invitation.rawToken) : null))
            .filter((link): link is string => Boolean(link))
          setCreatedLinks(links)
          setBulkValue('')
          flash('forms.invitation.add.success', 'success')
          onMutated?.()
          reload()
        },
        context: { distributionId, recipientCount: recipients.length },
        mutationPayload: { distributionId, recipientCount: recipients.length },
      })
    } catch {
      // flash already surfaced
    } finally {
      setSubmitting(false)
    }
  }, [bulkValue, distributionId, onMutated, reload, runMutation, submitting])

  const handleBulkKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        void handleBulkAdd()
      }
    },
    [handleBulkAdd],
  )

  const handleSend = React.useCallback(
    async (row: InvitationRow) => {
      await runMutation({
        operation: async () => {
          const resp = await apiCall(
            `/api/forms/distributions/${encodeURIComponent(distributionId)}/invitations/${encodeURIComponent(row.id)}/send`,
            { method: 'POST' },
          )
          if (!resp.ok) {
            flash('forms.invitation.send.failed', 'error')
            throw new Error('forms.invitation.send.failed')
          }
          flash('forms.invitation.send.success', 'success')
          onMutated?.()
          reload()
        },
        context: { invitationId: row.id },
        mutationPayload: { invitationId: row.id },
      }).catch(() => undefined)
    },
    [distributionId, onMutated, reload, runMutation],
  )

  const handleRevoke = React.useCallback(
    async (row: InvitationRow) => {
      const ok = await confirm({
        title: t('forms.invitation.revoke.confirm', { fallback: 'Revoke this invitation?' }),
        description: t('forms.invitation.revoke.body', {
          fallback: 'The personal link stops working immediately.',
        }),
        variant: 'destructive',
      })
      if (!ok) return
      await runMutation({
        operation: async () => {
          const resp = await apiCall(
            `/api/forms/distributions/${encodeURIComponent(distributionId)}/invitations/${encodeURIComponent(row.id)}`,
            { method: 'DELETE' },
          )
          if (!resp.ok) {
            flash('forms.invitation.revoke.failed', 'error')
            throw new Error('forms.invitation.revoke.failed')
          }
          flash('forms.invitation.revoke.success', 'success')
          onMutated?.()
          reload()
        },
        context: { invitationId: row.id },
        mutationPayload: { invitationId: row.id },
      }).catch(() => undefined)
    },
    [confirm, distributionId, onMutated, reload, runMutation, t],
  )

  const handleCopyAll = React.useCallback(async () => {
    if (createdLinks.length === 0) return
    const copied = await copyToClipboard(createdLinks.join('\n'))
    flash(copied ? 'forms.invitation.links.copied' : 'forms.invitation.links.copy_failed', copied ? 'success' : 'error')
  }, [createdLinks])

  const columns = React.useMemo<ColumnDef<InvitationRow>[]>(
    () => [
      {
        header: t('forms.invitation.columns.email', { fallback: 'Email' }),
        accessorKey: 'recipientEmail',
        cell: ({ row }) => (
          <span className="text-foreground">{row.original.recipientEmail ?? '—'}</span>
        ),
        meta: { truncate: true, maxWidth: 240 },
      },
      {
        header: t('forms.invitation.columns.name', { fallback: 'Name' }),
        accessorKey: 'recipientName',
        cell: ({ row }) => (
          <span className="text-muted-foreground">{row.original.recipientName ?? '—'}</span>
        ),
        meta: { truncate: true, maxWidth: 180 },
      },
      {
        header: t('forms.invitation.columns.status', { fallback: 'Status' }),
        accessorKey: 'status',
        cell: ({ row }) => (
          <StatusBadge variant={STATUS_VARIANT[row.original.status] ?? 'neutral'} dot>
            {t(`forms.invitation.status.${row.original.status}`, { fallback: row.original.status })}
          </StatusBadge>
        ),
      },
      {
        header: t('forms.invitation.columns.sent_at', { fallback: 'Sent' }),
        accessorKey: 'sentAt',
        cell: ({ row }) => formatDate(row.original.sentAt) || '—',
      },
      {
        header: t('forms.invitation.columns.submitted_at', { fallback: 'Submitted' }),
        accessorKey: 'submittedAt',
        cell: ({ row }) => formatDate(row.original.submittedAt) || '—',
      },
      {
        header: t('forms.invitation.columns.send_count', { fallback: 'Sends' }),
        accessorKey: 'sendCount',
        cell: ({ row }) => (
          <span className="font-mono text-xs text-foreground">{row.original.sendCount}</span>
        ),
      },
    ],
    [t],
  )

  const renderRowActions = React.useCallback(
    (row: InvitationRow) => {
      const items: RowActionItem[] = []
      const canSend = row.status !== 'revoked' && row.status !== 'submitted' && !!row.recipientEmail
      if (canSend) {
        items.push({
          id: 'send',
          label:
            row.sendCount > 0
              ? t('forms.invitation.actions.resend', { fallback: 'Resend' })
              : t('forms.invitation.actions.send', { fallback: 'Send' }),
          onSelect: () => void handleSend(row),
        })
      }
      if (row.status !== 'revoked') {
        items.push({
          id: 'revoke',
          label: t('forms.invitation.actions.revoke', { fallback: 'Revoke' }),
          destructive: true,
          onSelect: () => void handleRevoke(row),
        })
      }
      return <RowActions items={items} />
    },
    [handleRevoke, handleSend, t],
  )

  const headerTitle = distributionTitle
    ? `${distributionTitle} · ${t('forms.invitation.title', { fallback: 'Recipients' })}`
    : t('forms.invitation.title', { fallback: 'Recipients' })

  return (
    <div className="fixed inset-0 z-modal flex justify-end">
      <div className="absolute inset-0 bg-foreground/40" onClick={onClose} aria-hidden="true" />
      <aside
        role="dialog"
        aria-label={headerTitle}
        aria-modal="true"
        className="relative flex h-full w-full max-w-4xl flex-col gap-4 overflow-y-auto border-l border-border bg-background p-4 shadow-xl"
      >
        <header className="flex items-center justify-between gap-3 border-b border-border pb-3">
          <h2 className="text-lg font-semibold text-foreground">{headerTitle}</h2>
          <IconButton
            type="button"
            variant="ghost"
            size="default"
            onClick={onClose}
            aria-label={t('forms.invitation.close', { fallback: 'Close' })}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </IconButton>
        </header>

        <section className="flex flex-col gap-2 rounded-md border border-border bg-muted/30 p-3" onKeyDown={handleBulkKeyDown}>
          <label className="text-sm font-medium text-foreground" htmlFor="forms-invitation-bulk">
            {t('forms.invitation.add.title', { fallback: 'Add recipients' })}
          </label>
          <p className="text-xs text-muted-foreground">
            {t('forms.invitation.add.help', { fallback: 'One per line: email,name' })}
          </p>
          <Textarea
            id="forms-invitation-bulk"
            value={bulkValue}
            onChange={(event) => setBulkValue(event.target.value)}
            placeholder={'jane@example.com,Jane Doe\njohn@example.com'}
            rows={4}
          />
          <div className="flex items-center justify-end gap-2">
            <span className="mr-auto hidden text-xs text-muted-foreground sm:inline-flex sm:items-center sm:gap-1">
              <KbdShortcut keys={['⌘', 'Enter']} /> {t('forms.invitation.add.shortcut', { fallback: 'to add' })}
            </span>
            <Button type="button" size="default" disabled={submitting} onClick={handleBulkAdd}>
              {t('forms.invitation.add.action', { fallback: 'Add recipients' })}
            </Button>
          </div>
        </section>

        {createdLinks.length > 0 ? (
          <section className="flex flex-col gap-2 rounded-md border border-status-warning-border bg-status-warning-bg p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-status-warning-text">
                {t('forms.invitation.links.title', {
                  fallback: 'Personal links (shown once — copy them now)',
                })}
              </p>
              <Button type="button" variant="outline" size="sm" onClick={handleCopyAll}>
                <Copy className="mr-1 h-3 w-3" aria-hidden="true" />
                {t('forms.invitation.links.copy_all', { fallback: 'Copy all' })}
              </Button>
            </div>
            <ul className="flex flex-col gap-1">
              {createdLinks.map((link) => (
                <li
                  key={link}
                  className="flex items-center justify-between gap-2 rounded border border-border bg-background px-2 py-1"
                >
                  <span className="truncate font-mono text-xs text-foreground">{link}</span>
                  <IconButton
                    type="button"
                    variant="ghost"
                    size="default"
                    aria-label={t('forms.invitation.links.copy_one', { fallback: 'Copy link' })}
                    onClick={async () => {
                      const copied = await copyToClipboard(link)
                      flash(
                        copied ? 'forms.invitation.links.copied' : 'forms.invitation.links.copy_failed',
                        copied ? 'success' : 'error',
                      )
                    }}
                  >
                    <Copy className="h-4 w-4" aria-hidden="true" />
                  </IconButton>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <DataTable
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
          emptyState={t('forms.invitation.empty', { fallback: 'No recipients yet.' })}
        />

        {ConfirmDialogElement}
      </aside>
    </div>
  )
}
