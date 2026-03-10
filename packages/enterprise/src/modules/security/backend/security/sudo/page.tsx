'use client'

import * as React from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Pencil, Plus, ShieldAlert, Trash2 } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ChallengeMethod, SudoTargetType } from '../../../data/constants'
import SudoConfigForm, { type SudoConfigFormValues } from '../../../components/SudoConfigForm'
import { SudoProvider } from '../../../components/SudoProvider'
import { useSudoChallenge } from '../../../components/hooks/useSudoChallenge'

type SudoConfigRow = {
  id: string
  tenantId: string | null
  organizationId: string | null
  targetType: SudoTargetType
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
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editingRow, setEditingRow] = React.useState<SudoConfigRow | null>(null)
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
    const sudoToken = await requireSudo('security.sudo.manage', { targetType: SudoTargetType.FEATURE })
    if (!sudoToken) {
      flash(t('security.admin.sudo.flash.cancelled', 'Sudo challenge cancelled.'), 'error')
      return null
    }
    return sudoToken
  }, [requireSudo, t])

  const handleSubmit = React.useCallback(async (values: SudoConfigFormValues) => {
    const sudoToken = await requestToken()
    if (!sudoToken) return

    setSaving(true)
    try {
      const payload = {
        tenantId: values.tenantId.trim() || null,
        organizationId: values.organizationId.trim() || null,
        targetType: values.targetType,
        targetIdentifier: values.targetIdentifier.trim(),
        isEnabled: values.isEnabled,
        ttlSeconds: values.ttlSeconds,
        challengeMethod: values.challengeMethod,
      }
      if (editingRow) {
        await runMutationWithContext(
          () =>
            apiCallOrThrow(`/api/security/sudo/configs/${encodeURIComponent(editingRow.id)}`, {
              method: 'PUT',
              headers: {
                'content-type': 'application/json',
                'x-sudo-token': sudoToken,
              },
              body: JSON.stringify(payload),
            }),
          payload,
        )
        flash(t('security.admin.sudo.flash.updated', 'Sudo configuration updated.'), 'success')
      } else {
        await runMutationWithContext(
          () =>
            apiCallOrThrow('/api/security/sudo/configs', {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                'x-sudo-token': sudoToken,
              },
              body: JSON.stringify(payload),
            }),
          payload,
        )
        flash(t('security.admin.sudo.flash.created', 'Sudo configuration created.'), 'success')
      }
      setDialogOpen(false)
      setEditingRow(null)
      await loadRows()
    } catch {
      flash(t('security.admin.sudo.flash.saveError', 'Failed to save sudo configuration.'), 'error')
    } finally {
      setSaving(false)
    }
  }, [editingRow, loadRows, requestToken, runMutationWithContext, t])

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
      accessorKey: 'targetType',
      header: t('security.admin.sudo.table.targetType', 'Type'),
      cell: ({ row }) => t(`security.admin.sudo.targetType.${row.original.targetType}`, row.original.targetType),
    },
    {
      accessorKey: 'targetIdentifier',
      header: t('security.admin.sudo.table.targetIdentifier', 'Target'),
    },
    {
      id: 'scope',
      header: t('security.admin.sudo.table.scope', 'Scope'),
      cell: ({ row }) => {
        if (row.original.organizationId) {
          return `${row.original.tenantId ?? '-'} / ${row.original.organizationId}`
        }
        if (row.original.tenantId) return row.original.tenantId
        return t('security.admin.sudo.scope.platform', 'Platform')
      },
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
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <IconButton
            type="button"
            variant="ghost"
            size="sm"
            aria-label={t('ui.actions.edit', 'Edit')}
            onClick={() => {
              setEditingRow(row.original)
              setDialogOpen(true)
            }}
          >
            <Pencil className="size-4" />
          </IconButton>
          <IconButton
            type="button"
            variant="ghost"
            size="sm"
            aria-label={t('ui.actions.delete', 'Delete')}
            onClick={() => void handleDelete(row.original)}
          >
            <Trash2 className="size-4" />
          </IconButton>
        </div>
      ),
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
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setEditingRow(null)
                setDialogOpen(true)
              }}
            >
              <Plus className="mr-2 size-4" />
              {t('security.admin.sudo.actions.add', 'Add rule')}
            </Button>
          )}
          perspective={{ tableId: 'security.sudo.list' }}
          isLoading={loading}
          error={error ? <span>{error}</span> : null}
        />

        <Dialog open={dialogOpen} onOpenChange={(nextOpen) => {
          setDialogOpen(nextOpen)
          if (!nextOpen) {
            setEditingRow(null)
          }
        }}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {editingRow
                  ? t('security.admin.sudo.dialog.edit', 'Edit sudo rule')
                  : t('security.admin.sudo.dialog.create', 'Create sudo rule')}
              </DialogTitle>
            </DialogHeader>
            <SudoConfigForm
              value={editingRow ? {
                ...editingRow,
                tenantId: editingRow.tenantId ?? '',
                organizationId: editingRow.organizationId ?? '',
              } : undefined}
              submitting={saving}
              onSubmit={handleSubmit}
              onCancel={() => {
                setDialogOpen(false)
                setEditingRow(null)
              }}
            />
          </DialogContent>
        </Dialog>

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
