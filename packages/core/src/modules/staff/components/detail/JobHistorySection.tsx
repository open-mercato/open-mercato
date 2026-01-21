"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { LoadingMessage, ErrorMessage, TabEmptyState } from '@open-mercato/ui/backend/detail'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type JobHistoryRecord = {
  id: string
  name: string
  companyName: string | null
  description: string | null
  startDate: string | null
  endDate: string | null
}

type JobHistoryResponse = {
  items?: Record<string, unknown>[]
}

type JobHistoryFormValues = {
  name?: string
  companyName?: string
  description?: string
  startDate?: string
  endDate?: string
}

export function JobHistorySection({ memberId }: { memberId: string | null }) {
  const t = useT()
  const [items, setItems] = React.useState<JobHistoryRecord[]>([])
  const [isLoading, setIsLoading] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [dialogMode, setDialogMode] = React.useState<'create' | 'edit'>('create')
  const [activeRecord, setActiveRecord] = React.useState<JobHistoryRecord | null>(null)
  const [reloadToken, setReloadToken] = React.useState(0)

  const labels = React.useMemo(() => ({
    title: t('staff.teamMembers.detail.jobHistory.title', 'Job history'),
    emptyTitle: t('staff.teamMembers.detail.jobHistory.emptyTitle', 'No job history yet'),
    emptyAction: t('staff.teamMembers.detail.jobHistory.emptyAction', 'Add job history'),
    add: t('staff.teamMembers.detail.jobHistory.add', 'Add job'),
    edit: t('staff.teamMembers.detail.jobHistory.edit', 'Edit job'),
    deleteConfirm: t('staff.teamMembers.detail.jobHistory.deleteConfirm', 'Delete this job history entry?'),
    errorLoad: t('staff.teamMembers.detail.jobHistory.errorLoad', 'Failed to load job history.'),
    errorSave: t('staff.teamMembers.detail.jobHistory.errorSave', 'Failed to save job history.'),
    errorDelete: t('staff.teamMembers.detail.jobHistory.errorDelete', 'Failed to delete job history.'),
    loading: t('staff.teamMembers.detail.jobHistory.loading', 'Loading job history...'),
    saved: t('staff.teamMembers.detail.jobHistory.saved', 'Job history saved.'),
    updated: t('staff.teamMembers.detail.jobHistory.updated', 'Job history updated.'),
    deleted: t('staff.teamMembers.detail.jobHistory.deleted', 'Job history deleted.'),
    present: t('staff.teamMembers.detail.jobHistory.present', 'Present'),
    unknownDate: t('staff.teamMembers.detail.jobHistory.unknownDate', 'Unknown date'),
    fields: {
      name: t('staff.teamMembers.detail.jobHistory.fields.name', 'Role / title'),
      companyName: t('staff.teamMembers.detail.jobHistory.fields.companyName', 'Company'),
      startDate: t('staff.teamMembers.detail.jobHistory.fields.startDate', 'From'),
      endDate: t('staff.teamMembers.detail.jobHistory.fields.endDate', 'To'),
      description: t('staff.teamMembers.detail.jobHistory.fields.description', 'Description'),
    },
    save: t('staff.teamMembers.detail.jobHistory.save', 'Save job'),
    update: t('staff.teamMembers.detail.jobHistory.update', 'Update job'),
    cancel: t('staff.teamMembers.detail.jobHistory.cancel', 'Cancel'),
  }), [t])

  const fields = React.useMemo<CrudField[]>(() => ([
    { id: 'name', label: labels.fields.name, type: 'text', required: true },
    { id: 'companyName', label: labels.fields.companyName, type: 'text' },
    { id: 'startDate', label: labels.fields.startDate, type: 'date', required: true, layout: 'half' },
    { id: 'endDate', label: labels.fields.endDate, type: 'date', layout: 'half' },
    { id: 'description', label: labels.fields.description, type: 'textarea' },
  ]), [labels.fields])

  const dateFormatter = React.useMemo(
    () => new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' }),
    [],
  )

  const loadJobHistory = React.useCallback(async () => {
    if (!memberId) return
    setIsLoading(true)
    setLoadError(null)
    try {
      const params = new URLSearchParams({
        entityId: memberId,
        pageSize: '100',
        sortField: 'startDate',
        sortDir: 'desc',
      })
      const payload = await readApiResultOrThrow<JobHistoryResponse>(
        `/api/staff/job-histories?${params.toString()}`,
        undefined,
        { errorMessage: labels.errorLoad },
      )
      const records = normalizeJobHistoryItems(payload?.items)
      setItems(records)
    } catch (error) {
      const message = error instanceof Error ? error.message : labels.errorLoad
      setLoadError(message)
    } finally {
      setIsLoading(false)
    }
  }, [labels.errorLoad, memberId])

  React.useEffect(() => {
    void loadJobHistory()
  }, [loadJobHistory, reloadToken])

  const openCreateDialog = React.useCallback(() => {
    if (!memberId) return
    setDialogMode('create')
    setActiveRecord(null)
    setDialogOpen(true)
  }, [memberId])

  const openEditDialog = React.useCallback((record: JobHistoryRecord) => {
    setDialogMode('edit')
    setActiveRecord(record)
    setDialogOpen(true)
  }, [])

  const closeDialog = React.useCallback(() => {
    setDialogOpen(false)
    setActiveRecord(null)
  }, [])

  const handleSubmit = React.useCallback(async (values: JobHistoryFormValues) => {
    if (!memberId) return
    const payload = buildJobHistoryPayload(values)
    if (dialogMode === 'edit' && activeRecord) {
      await updateCrud('staff/job-histories', { id: activeRecord.id, ...payload }, { errorMessage: labels.errorSave })
      flash(labels.updated, 'success')
    } else {
      await createCrud('staff/job-histories', { entityId: memberId, ...payload }, { errorMessage: labels.errorSave })
      flash(labels.saved, 'success')
    }
    closeDialog()
    setReloadToken((prev) => prev + 1)
  }, [activeRecord, closeDialog, dialogMode, labels.errorSave, labels.saved, labels.updated, memberId])

  const handleDelete = React.useCallback(async (record: JobHistoryRecord) => {
    if (!confirm(labels.deleteConfirm)) return
    await deleteCrud('staff/job-histories', { id: record.id, errorMessage: labels.errorDelete })
    flash(labels.deleted, 'success')
    setReloadToken((prev) => prev + 1)
  }, [labels.deleteConfirm, labels.deleted, labels.errorDelete])

  const dialogTitle = dialogMode === 'edit' ? labels.edit : labels.add

  const initialValues = dialogMode === 'edit' && activeRecord
    ? {
        name: activeRecord.name,
        companyName: activeRecord.companyName ?? '',
        description: activeRecord.description ?? '',
        startDate: toDateInputValue(activeRecord.startDate),
        endDate: toDateInputValue(activeRecord.endDate),
      }
    : {
        name: '',
        companyName: '',
        description: '',
        startDate: '',
        endDate: '',
      }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase text-muted-foreground">{labels.title}</h2>
        <Button type="button" size="sm" onClick={openCreateDialog} disabled={!memberId}>
          {labels.add}
        </Button>
      </div>

      {isLoading ? (
        <LoadingMessage label={labels.loading} />
      ) : loadError ? (
        <ErrorMessage label={loadError} />
      ) : items.length === 0 ? (
        <TabEmptyState
          title={labels.emptyTitle}
          actionLabel={labels.emptyAction}
          onAction={openCreateDialog}
          disabled={!memberId}
        />
      ) : (
        <div className="space-y-3">
          {items.map((record) => (
            <div key={record.id} className="rounded-lg border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-base font-semibold text-foreground">{record.name}</div>
                  <div className="text-sm text-muted-foreground">
                    {formatDateRange(record, labels.present, labels.unknownDate, dateFormatter)}
                  </div>
                  {record.companyName ? (
                    <div className="text-sm text-foreground">{record.companyName}</div>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <Button type="button" size="sm" variant="ghost" onClick={() => openEditDialog(record)}>
                    {labels.edit}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => handleDelete(record)}>
                    {t('staff.teamMembers.actions.delete', 'Delete')}
                  </Button>
                </div>
              </div>
              {record.description ? (
                <p className="mt-3 text-sm text-muted-foreground">{record.description}</p>
              ) : null}
            </div>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={(open) => (open ? setDialogOpen(true) : closeDialog())}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
          </DialogHeader>
          <CrudForm<JobHistoryFormValues>
            fields={fields}
            initialValues={initialValues}
            onSubmit={handleSubmit}
            submitLabel={dialogMode === 'edit' ? labels.update : labels.save}
            extraActions={(
              <Button type="button" variant="ghost" onClick={closeDialog}>
                {labels.cancel}
              </Button>
            )}
            embedded
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}

function normalizeJobHistoryItems(items?: Record<string, unknown>[]): JobHistoryRecord[] {
  if (!Array.isArray(items)) return []
  return items
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const record = item as Record<string, unknown>
      const rawId = record.id ?? record.job_history_id ?? null
      const id =
        typeof rawId === 'string'
          ? rawId
          : typeof rawId === 'number' || typeof rawId === 'bigint'
            ? String(rawId)
            : null
      if (!id) return null
      const name = typeof record.name === 'string' ? record.name : ''
      return {
        id,
        name,
        companyName: typeof record.company_name === 'string'
          ? record.company_name
          : typeof record.companyName === 'string'
            ? record.companyName
            : null,
        description: typeof record.description === 'string' ? record.description : null,
        startDate: typeof record.start_date === 'string'
          ? record.start_date
          : typeof record.startDate === 'string'
            ? record.startDate
            : null,
        endDate: typeof record.end_date === 'string'
          ? record.end_date
          : typeof record.endDate === 'string'
            ? record.endDate
            : null,
      }
    })
    .filter((value): value is JobHistoryRecord => value !== null)
}

function buildJobHistoryPayload(values: JobHistoryFormValues) {
  const payload: Record<string, unknown> = {
    name: values.name?.trim() ?? '',
    companyName: values.companyName?.trim() || null,
    description: values.description?.trim() || null,
  }
  if (values.startDate) payload.startDate = values.startDate
  if (values.endDate) payload.endDate = values.endDate
  return payload
}

function toDateInputValue(value?: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

function formatDateRange(
  record: JobHistoryRecord,
  presentLabel: string,
  unknownLabel: string,
  formatter: Intl.DateTimeFormat,
): string {
  const start = record.startDate ? new Date(record.startDate) : null
  const end = record.endDate ? new Date(record.endDate) : null
  const startLabel = start && !Number.isNaN(start.getTime()) ? formatter.format(start) : unknownLabel
  const endLabel = end && !Number.isNaN(end.getTime()) ? formatter.format(end) : presentLabel
  return `${startLabel} — ${endLabel}`
}
