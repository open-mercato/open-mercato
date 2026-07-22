"use client"

import * as React from 'react'
import { Plus } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, deleteCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import type { ColumnDef } from '@tanstack/react-table'
import {
  EUDR_MITIGATION_STATUSES,
  EUDR_MITIGATION_TYPES,
  type EudrMitigationStatus,
  type EudrMitigationType,
} from '../data/validators'

type MitigationActionRow = {
  id: string
  riskAssessmentId: string
  actionType: EudrMitigationType | null
  title: string
  description: string | null
  status: EudrMitigationStatus | null
  dueDate: string | null
  completedAt: string | null
  notes: string | null
  updatedAt: string
}

type MitigationActionsResponse = {
  items?: MitigationActionRow[]
}

type MitigationActionFormValues = {
  actionType: string
  title: string
  description: string
  status: string
  dueDate: string
  notes: string
} & Record<string, unknown>

type MutationContext = {
  formId: string
  resourceKind: string
  resourceId: string
  retryLastMutation: () => Promise<boolean>
}

export type MitigationActionsSectionProps = {
  riskAssessmentId: string
}

function optionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function formatDate(value: string | null | undefined, emptyLabel: string): string {
  if (!value) return emptyLabel
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return emptyLabel
  return date.toLocaleDateString()
}

function formatDateInput(value: string | null | undefined): string {
  if (!value) return ''
  return value.slice(0, 10)
}

function isOverdue(row: MitigationActionRow): boolean {
  if (!row.dueDate || row.status === 'completed') return false
  const date = new Date(row.dueDate)
  return !Number.isNaN(date.getTime()) && date.getTime() < Date.now()
}

function statusVariant(status: string | null | undefined): 'neutral' | 'info' | 'success' {
  if (status === 'in_progress') return 'info'
  if (status === 'completed') return 'success'
  return 'neutral'
}

function actionTypeOptions(translate: ReturnType<typeof useT>) {
  return EUDR_MITIGATION_TYPES.map((type) => ({
    value: type,
    label: translate(`eudr.mitigationType.${type}`),
  }))
}

function actionStatusOptions(translate: ReturnType<typeof useT>) {
  return EUDR_MITIGATION_STATUSES.map((status) => ({
    value: status,
    label: translate(`eudr.mitigationStatus.${status}`),
  }))
}

export function MitigationActionsSection({
  riskAssessmentId,
}: MitigationActionsSectionProps) {
  const translate = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [rows, setRows] = React.useState<MitigationActionRow[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [dialogMode, setDialogMode] = React.useState<'create' | 'edit' | null>(null)
  const [editingRow, setEditingRow] = React.useState<MitigationActionRow | null>(null)
  const [reloadToken, setReloadToken] = React.useState(0)
  const mutationContextId = `eudr-mitigation-actions:${riskAssessmentId}`
  const { runMutation, retryLastMutation } = useGuardedMutation<MutationContext>({
    contextId: mutationContextId,
    blockedMessage: translate('ui.forms.flash.saveBlocked'),
  })

  React.useEffect(() => {
    let cancelled = false
    async function loadRows() {
      setLoading(true)
      setError(null)
      try {
        const call = await apiCall<MitigationActionsResponse>(
          `/api/eudr/mitigation-actions?riskAssessmentId=${encodeURIComponent(riskAssessmentId)}&pageSize=100&sortField=dueDate&sortDir=asc`,
          undefined,
          { fallback: { items: [] } },
        )
        if (!call.ok) {
          if (!cancelled) setError(translate('eudr.mitigationActions.loadError'))
          return
        }
        if (!cancelled) setRows(Array.isArray(call.result?.items) ? call.result.items : [])
      } catch {
        if (!cancelled) setError(translate('eudr.mitigationActions.loadError'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadRows()
    return () => {
      cancelled = true
    }
  }, [reloadToken, riskAssessmentId, translate])

  const refreshRows = React.useCallback(() => {
    setReloadToken((currentToken) => currentToken + 1)
  }, [])

  const openCreateDialog = React.useCallback(() => {
    setEditingRow(null)
    setDialogMode('create')
  }, [])

  const openEditDialog = React.useCallback((row: MitigationActionRow) => {
    setEditingRow(row)
    setDialogMode('edit')
  }, [])

  const closeDialog = React.useCallback(() => {
    setDialogMode(null)
    setEditingRow(null)
  }, [])

  const handleDelete = React.useCallback(async (row: MitigationActionRow) => {
    const confirmed = await confirm({
      title: translate('eudr.mitigationActions.confirmDelete', { title: row.title }),
      variant: 'destructive',
    })
    if (!confirmed) return

    try {
      await runMutation({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(row.updatedAt),
          () => deleteCrud('eudr/mitigation-actions', row.id, {
            errorMessage: translate('eudr.mitigationActions.deleteError'),
          }),
        ),
        context: {
          formId: mutationContextId,
          resourceKind: 'eudr.mitigation_action',
          resourceId: row.id,
          retryLastMutation,
        },
        mutationPayload: { id: row.id },
      })
      flash(translate('eudr.mitigationActions.deleteSuccess'), 'success')
      refreshRows()
    } catch (deleteError) {
      if (surfaceRecordConflict(deleteError, translate, { onRefresh: refreshRows })) return
      flash(translate('eudr.mitigationActions.deleteError'), 'error')
    }
  }, [confirm, mutationContextId, refreshRows, retryLastMutation, runMutation, translate])

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'actionType',
      label: translate('eudr.mitigationActions.form.actionType'),
      type: 'select',
      options: actionTypeOptions(translate),
    },
    {
      id: 'title',
      label: translate('eudr.mitigationActions.form.title'),
      type: 'text',
      required: true,
    },
    {
      id: 'description',
      label: translate('eudr.mitigationActions.form.description'),
      type: 'textarea',
    },
    {
      id: 'status',
      label: translate('eudr.mitigationActions.form.status'),
      type: 'select',
      options: actionStatusOptions(translate),
    },
    {
      id: 'dueDate',
      label: translate('eudr.mitigationActions.form.dueDate'),
      type: 'date',
    },
    {
      id: 'notes',
      label: translate('eudr.mitigationActions.form.notes'),
      type: 'textarea',
    },
  ], [translate])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'details',
      title: translate('eudr.mitigationActions.form.details'),
      column: 1,
      fields: ['actionType', 'title', 'description', 'status', 'dueDate', 'notes'],
    },
  ], [translate])

  const initialValues = React.useMemo<MitigationActionFormValues>(() => ({
    actionType: editingRow?.actionType ?? 'request_documents',
    title: editingRow?.title ?? '',
    description: editingRow?.description ?? '',
    status: editingRow?.status ?? 'planned',
    dueDate: formatDateInput(editingRow?.dueDate),
    notes: editingRow?.notes ?? '',
  }), [editingRow])

  const columns = React.useMemo<ColumnDef<MitigationActionRow>[]>(() => [
    {
      accessorKey: 'title',
      header: translate('eudr.mitigationActions.columns.title'),
      cell: ({ row }) => row.original.title,
      meta: { maxWidth: '260px', truncate: true },
    },
    {
      accessorKey: 'actionType',
      header: translate('eudr.mitigationActions.columns.type'),
      cell: ({ row }) => row.original.actionType
        ? translate(`eudr.mitigationType.${row.original.actionType}`)
        : translate('eudr.common.empty'),
    },
    {
      accessorKey: 'status',
      header: translate('eudr.mitigationActions.columns.status'),
      cell: ({ row }) => (
        <StatusBadge variant={statusVariant(row.original.status)} dot>
          {row.original.status ? translate(`eudr.mitigationStatus.${row.original.status}`) : translate('eudr.common.empty')}
        </StatusBadge>
      ),
    },
    {
      accessorKey: 'dueDate',
      header: translate('eudr.mitigationActions.columns.dueDate'),
      cell: ({ row }) => (
        <span className={isOverdue(row.original) ? 'text-status-warning-text' : undefined}>
          {formatDate(row.original.dueDate, translate('eudr.common.empty'))}
        </span>
      ),
    },
    {
      accessorKey: 'completedAt',
      header: translate('eudr.mitigationActions.columns.completedAt'),
      cell: ({ row }) => formatDate(row.original.completedAt, translate('eudr.common.empty')),
    },
  ], [translate])

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{translate('eudr.mitigationActions.title')}</h2>
          <p className="text-sm text-muted-foreground">{translate('eudr.mitigationActions.description')}</p>
        </div>
        <Button type="button" onClick={openCreateDialog}>
          <Plus className="size-4" aria-hidden="true" />
          {translate('eudr.mitigationActions.actions.add')}
        </Button>
      </div>

      <DataTable<MitigationActionRow>
        title={translate('eudr.mitigationActions.tableTitle')}
        columns={columns}
        data={rows}
        isLoading={loading}
        error={error}
        rowActions={(row) => (
          <RowActions
            items={[
              {
                id: 'edit',
                label: translate('eudr.mitigationActions.actions.edit'),
                onSelect: () => openEditDialog(row),
              },
              {
                id: 'delete',
                label: translate('eudr.mitigationActions.actions.delete'),
                destructive: true,
                onSelect: () => {
                  void handleDelete(row)
                },
              },
            ]}
          />
        )}
        emptyState={(
          <EmptyState
            size="sm"
            variant="subtle"
            title={translate('eudr.mitigationActions.empty')}
          />
        )}
        perspective={{ tableId: 'eudr.risk_assessments.detail.mitigation_actions' }}
        disableRowClick
        stickyActionsColumn
      />

      <Dialog open={dialogMode !== null} onOpenChange={(open) => {
        if (!open) closeDialog()
      }}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>
              {dialogMode === 'edit'
                ? translate('eudr.mitigationActions.editTitle')
                : translate('eudr.mitigationActions.createTitle')}
            </DialogTitle>
          </DialogHeader>
          <CrudForm<MitigationActionFormValues>
            embedded
            title={dialogMode === 'edit'
              ? translate('eudr.mitigationActions.editTitle')
              : translate('eudr.mitigationActions.createTitle')}
            submitLabel={translate('eudr.mitigationActions.form.submit')}
            fields={fields}
            groups={groups}
            initialValues={initialValues}
            onSubmit={async (values) => {
              const title = optionalText(values.title)
              if (!title) {
                const message = translate('eudr.mitigationActions.form.titleRequired')
                throw createCrudFormError(message, { title: message })
              }
              const payload = {
                riskAssessmentId,
                actionType: optionalText(values.actionType) ?? 'request_documents',
                title,
                description: optionalText(values.description),
                status: optionalText(values.status) ?? 'planned',
                dueDate: optionalText(values.dueDate),
                notes: optionalText(values.notes),
              }
              if (dialogMode === 'edit' && editingRow) {
                await withScopedApiRequestHeaders(
                  buildOptimisticLockHeader(editingRow.updatedAt),
                  () => updateCrud('eudr/mitigation-actions', {
                    id: editingRow.id,
                    ...payload,
                  }, {
                    errorMessage: translate('eudr.mitigationActions.updateError'),
                  }),
                )
                flash(translate('eudr.mitigationActions.updateSuccess'), 'success')
              } else {
                await createCrud('eudr/mitigation-actions', payload, {
                  errorMessage: translate('eudr.mitigationActions.createError'),
                })
                flash(translate('eudr.mitigationActions.createSuccess'), 'success')
              }
              closeDialog()
              refreshRows()
            }}
          />
        </DialogContent>
      </Dialog>
      {ConfirmDialogElement}
    </section>
  )
}

export default MitigationActionsSection
