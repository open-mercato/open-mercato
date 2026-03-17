'use client'

import * as React from 'react'
import Link from 'next/link'
import type { ColumnDef } from '@tanstack/react-table'
import { Pencil, Plus, ShieldAlert, Trash2 } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ChallengeMethod } from '../../../data/constants'
import { SudoProvider } from '../../../components/SudoProvider'
import { useSudoChallenge } from '../../../components/hooks/useSudoChallenge'

type SudoConfigRow = {
  id: string
  tenantId: string | null
  tenantName: string | null
  organizationId: string | null
  organizationName: string | null
  label: string | null
  targetIdentifier: string
  isEnabled: boolean
  isDeveloperDefault: boolean
  ttlSeconds: number
  challengeMethod: ChallengeMethod
  configuredBy: string | null
  createdAt: string
  updatedAt: string
}

type SudoConfigListResponse = {
  items: SudoConfigRow[]
}

function renderScopeLabel(row: SudoConfigRow, platformLabel: string) {
  if (!row.tenantId && !row.organizationId) {
    return <span>{platformLabel}</span>
  }
  const tenantLabel = row.tenantName ?? row.tenantId ?? '-'
  if (!row.organizationId) {
    return <span className="whitespace-normal break-words">{tenantLabel}</span>
  }
  const orgLabel = row.organizationName ?? row.organizationId ?? '-'
  return (
    <div className="space-y-1 whitespace-normal break-words">
      <div>{tenantLabel}</div>
      <div className="text-muted-foreground">{orgLabel}</div>
    </div>
  )
}

function SecuritySudoPageInner() {
  const t = useT()
  const { requireSudo } = useSudoChallenge()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation, retryLastMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: 'security-sudo-management',
  })

  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [rows, setRows] = React.useState<SudoConfigRow[]>([])
  const [saving, setSaving] = React.useState(false)

  const runMutationWithContext = React.useCallback(
    async <T,>(operation: () => Promise<T>, mutationPayload?: Record<string, unknown>): Promise<T> => {
      return runMutation({
        operation,
        mutationPayload,
        context: { retryLastMutation },
      })
    },
    [retryLastMutation, runMutation],
  )

  const loadRows = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    const response = await apiCall<SudoConfigListResponse>('/api/security/sudo/configs')
    if (!response.ok || !response.result) {
      setRows([])
      setError(t('security.admin.sudo.errors.load', 'Failed to load sudo configuration.'))
      setLoading(false)
      return
    }
    setRows(Array.isArray(response.result.items) ? response.result.items : [])
    setLoading(false)
  }, [t])

  React.useEffect(() => {
    void loadRows()
  }, [loadRows])

  const requestToken = React.useCallback(async () => {
    const sudoToken = await requireSudo('security.sudo.manage')
    if (!sudoToken) {
      flash(t('security.admin.sudo.flash.cancelled', 'Sudo challenge cancelled.'), 'error')
      return null
    }
    return sudoToken
  }, [requireSudo, t])

  const handleDelete = React.useCallback(async (row: SudoConfigRow) => {
    const accepted = await confirm({
      title: t('security.admin.sudo.delete.title', 'Delete sudo rule?'),
      text: t('security.admin.sudo.delete.text', 'This removes the selected sudo protection rule.'),
      variant: 'destructive',
      confirmText: t('ui.actions.delete', 'Delete'),
      cancelText: t('ui.actions.cancel', 'Cancel'),
    })
    if (!accepted) return

    const sudoToken = await requestToken()
    if (!sudoToken) return

    setSaving(true)
    try {
      await runMutationWithContext(
        () =>
          apiCallOrThrow(`/api/security/sudo/configs/${encodeURIComponent(row.id)}`, {
            method: 'DELETE',
            headers: { 'x-sudo-token': sudoToken },
          }),
        { id: row.id },
      )
      flash(t('security.admin.sudo.flash.deleted', 'Sudo configuration deleted.'), 'success')
      await loadRows()
    } catch {
      flash(t('security.admin.sudo.flash.deleteError', 'Failed to delete sudo configuration.'), 'error')
    } finally {
      setSaving(false)
    }
  }, [confirm, loadRows, requestToken, runMutationWithContext, t])

  const columns = React.useMemo<ColumnDef<SudoConfigRow>[]>(() => [
    {
      accessorKey: 'label',
      header: t('security.admin.sudo.table.label', 'Label'),
      cell: ({ row }) => row.original.label ?? '—',
    },
    {
      accessorKey: 'targetIdentifier',
      header: t('security.admin.sudo.table.targetIdentifier', 'Target'),
    },
    {
      id: 'scope',
      header: t('security.admin.sudo.table.scope', 'Scope'),
      cell: ({ row }) => renderScopeLabel(row.original, t('security.admin.sudo.scope.platform', 'Platform')),
    },
    {
      accessorKey: 'challengeMethod',
      header: t('security.admin.sudo.table.challengeMethod', 'Method'),
      cell: ({ row }) => t(`security.admin.sudo.challengeMethod.${row.original.challengeMethod}`, row.original.challengeMethod),
    },
    {
      accessorKey: 'ttlSeconds',
      header: t('security.admin.sudo.table.ttl', 'TTL'),
      cell: ({ row }) => t('security.admin.sudo.table.ttlValue', '{value}s', { value: String(row.original.ttlSeconds) }),
    },
    {
      id: 'source',
      header: t('security.admin.sudo.table.source', 'Source'),
      cell: ({ row }) => row.original.isDeveloperDefault
        ? t('security.admin.sudo.source.developer', 'Developer default')
        : t('security.admin.sudo.source.admin', 'Admin override'),
    },
    {
      accessorKey: 'isEnabled',
      header: t('security.admin.sudo.table.status', 'Status'),
      cell: ({ row }) => row.original.isEnabled
        ? t('security.admin.sudo.status.enabled', 'Enabled')
        : t('security.admin.sudo.status.disabled', 'Disabled'),
    },
    {
      id: 'actions',
      header: t('security.admin.sudo.table.actions', 'Actions'),
      cell: ({ row }) => {
        const isDeveloperDefault = row.original.isDeveloperDefault
        return (
          <div className="flex items-center gap-2">
            {isDeveloperDefault ? (
              <IconButton
                variant="ghost"
                size="sm"
                aria-label={t('ui.actions.edit', 'Edit')}
                disabled
              >
                <Pencil className="size-4" />
              </IconButton>
            ) : (
              <IconButton
                asChild
                variant="ghost"
                size="sm"
                aria-label={t('ui.actions.edit', 'Edit')}
              >
                <Link href={`/backend/security/sudo/${row.original.id}/edit`}>
                  <Pencil className="size-4" />
                </Link>
              </IconButton>
            )}
            <IconButton
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t('ui.actions.delete', 'Delete')}
              disabled={isDeveloperDefault}
              onClick={() => void handleDelete(row.original)}
            >
              <Trash2 className="size-4" />
            </IconButton>
          </div>
        )
      },
    },
  ], [handleDelete, t])

  return (
    <Page>
      <PageBody className="space-y-6">
        <div className="rounded-xl border bg-muted/20 p-4">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 size-5 text-amber-600" />
            <div className="space-y-1">
              <h2 className="text-sm font-semibold">
                {t('security.admin.sudo.notice.title', 'Sensitive operations require re-authentication')}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t(
                  'security.admin.sudo.notice.description',
                  'Use sudo rules to require a fresh password or MFA challenge for selected features, routes, modules, or packages.',
                )}
              </p>
            </div>
          </div>
        </div>

        <DataTable<SudoConfigRow>
          title={t('security.admin.sudo.title', 'Sudo protection')}
          columns={columns}
          data={rows}
          actions={(
            <Button
              asChild
              variant="outline"
              size="sm"
            >
              <Link href="/backend/security/sudo/create">
                <Plus className="mr-2 size-4" />
                {t('security.admin.sudo.actions.add', 'Add rule')}
              </Link>
            </Button>
          )}
          perspective={{ tableId: 'security.sudo.list' }}
          isLoading={loading}
          error={error ? <span>{error}</span> : null}
        />

        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}

export default function SecuritySudoPage() {
  return (
    <SudoProvider>
      <SecuritySudoPageInner />
    </SudoProvider>
  )
}
