"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import type { SectionAction } from '@open-mercato/ui/backend/detail'

type BranchRecord = {
  id: string
  name: string
  branch_type: string | null
  specialization: string | null
  budget: string | null
  headcount: number | null
  responsible_person_id: string | null
  is_active: boolean
  created_at: string | null
}

type BranchFormData = {
  name: string
  branchType: string
  specialization: string
  budget: string
  headcount: string
  isActive: boolean
}

const BRANCH_TYPES = ['headquarters', 'branch', 'warehouse', 'office'] as const

function BranchForm({
  initial,
  onSubmit,
  onCancel,
  isSubmitting,
}: {
  initial?: BranchFormData
  onSubmit: (data: BranchFormData) => void
  onCancel: () => void
  isSubmitting: boolean
}) {
  const t = useT()
  const [formData, setFormData] = React.useState<BranchFormData>(
    initial ?? {
      name: '',
      branchType: '',
      specialization: '',
      budget: '',
      headcount: '',
      isActive: true,
    },
  )

  const branchTypeLabels: Record<string, string> = {
    headquarters: t('customers.companies.detail.branches.types.headquarters', 'Headquarters'),
    branch: t('customers.companies.detail.branches.types.branch', 'Branch'),
    warehouse: t('customers.companies.detail.branches.types.warehouse', 'Warehouse'),
    office: t('customers.companies.detail.branches.types.office', 'Office'),
  }

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel()
      } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        if (!isSubmitting && formData.name.trim()) onSubmit(formData)
      }
    },
    [formData, isSubmitting, onCancel, onSubmit],
  )

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4" onKeyDown={handleKeyDown}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="text-xs font-medium text-muted-foreground">
            {t('customers.companies.detail.branches.name', 'Name')} *
          </label>
          <input
            type="text"
            value={formData.name}
            onChange={(event) => setFormData((prev) => ({ ...prev, name: event.target.value }))}
            className="mt-1 w-full rounded border px-3 py-1.5 text-sm"
            required
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">
            {t('customers.companies.detail.branches.type', 'Type')}
          </label>
          <select
            value={formData.branchType}
            onChange={(event) => setFormData((prev) => ({ ...prev, branchType: event.target.value }))}
            className="mt-1 w-full rounded border px-3 py-1.5 text-sm"
          >
            <option value="">{t('customers.companies.detail.branches.selectType', 'Select type')}</option>
            {BRANCH_TYPES.map((type) => (
              <option key={type} value={type}>{branchTypeLabels[type] ?? type}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">
            {t('customers.companies.detail.branches.specialization', 'Specialization')}
          </label>
          <input
            type="text"
            value={formData.specialization}
            onChange={(event) => setFormData((prev) => ({ ...prev, specialization: event.target.value }))}
            className="mt-1 w-full rounded border px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">
            {t('customers.companies.detail.branches.budget', 'Monthly budget')}
          </label>
          <input
            type="number"
            value={formData.budget}
            onChange={(event) => setFormData((prev) => ({ ...prev, budget: event.target.value }))}
            className="mt-1 w-full rounded border px-3 py-1.5 text-sm"
            min="0"
            step="0.01"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">
            {t('customers.companies.detail.branches.headcount', 'Headcount')}
          </label>
          <input
            type="number"
            value={formData.headcount}
            onChange={(event) => setFormData((prev) => ({ ...prev, headcount: event.target.value }))}
            className="mt-1 w-full rounded border px-3 py-1.5 text-sm"
            min="0"
            step="1"
          />
        </div>
        <div className="flex items-center gap-2 pt-5">
          <input
            type="checkbox"
            checked={formData.isActive}
            onChange={(event) => setFormData((prev) => ({ ...prev, isActive: event.target.checked }))}
            id="branch-active"
          />
          <label htmlFor="branch-active" className="text-sm">
            {t('customers.companies.detail.branches.active', 'Active')}
          </label>
        </div>
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => onSubmit(formData)}
          disabled={isSubmitting || !formData.name.trim()}
        >
          {isSubmitting && <Spinner className="mr-1 h-3 w-3" />}
          {initial ? t('customers.companies.detail.branches.save', 'Save') : t('customers.companies.detail.branches.create', 'Create')}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          {t('customers.companies.detail.branches.cancel', 'Cancel')}
        </Button>
      </div>
    </div>
  )
}

export function BranchesSection({
  companyId,
  onActionChange,
  runMutation,
}: {
  companyId: string
  onActionChange?: (action: SectionAction | null) => void
  runMutation?: <T>(operation: () => Promise<T>) => Promise<T>
}) {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [branches, setBranches] = React.useState<BranchRecord[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [showForm, setShowForm] = React.useState(false)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)

  const guardedRun = React.useCallback(
    async <T,>(operation: () => Promise<T>): Promise<T> => {
      if (runMutation) return runMutation(operation)
      return operation()
    },
    [runMutation],
  )

  const branchTypeLabels: Record<string, string> = React.useMemo(() => ({
    headquarters: t('customers.companies.detail.branches.types.headquarters', 'Headquarters'),
    branch: t('customers.companies.detail.branches.types.branch', 'Branch'),
    warehouse: t('customers.companies.detail.branches.types.warehouse', 'Warehouse'),
    office: t('customers.companies.detail.branches.types.office', 'Office'),
  }), [t])

  const loadBranches = React.useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)
    try {
      const result = await readApiResultOrThrow<{ items: BranchRecord[] }>(
        `/api/customers/branches?companyEntityId=${encodeURIComponent(companyId)}&pageSize=100`,
      )
      setBranches(result.items ?? [])
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t('customers.companies.detail.branches.loadError', 'Failed to load branches.'))
    } finally {
      setIsLoading(false)
    }
  }, [companyId, t])

  React.useEffect(() => {
    loadBranches().catch(() => {})
  }, [loadBranches])

  React.useEffect(() => {
    onActionChange?.({
      label: t('customers.companies.detail.branches.add', 'Add branch'),
      onClick: () => {
        setShowForm(true)
        setEditingId(null)
      },
    })
    return () => onActionChange?.(null)
  }, [onActionChange, t])

  const handleCreate = React.useCallback(async (data: BranchFormData) => {
    setIsSubmitting(true)
    try {
      await guardedRun(() =>
        apiCallOrThrow('/api/customers/branches', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            companyEntityId: companyId,
            name: data.name.trim(),
            branchType: data.branchType || undefined,
            specialization: data.specialization.trim() || undefined,
            budget: data.budget ? parseFloat(data.budget) : undefined,
            headcount: data.headcount ? parseInt(data.headcount, 10) : undefined,
            isActive: data.isActive,
          }),
        }),
      )
      flash(t('customers.companies.detail.branches.createSuccess', 'Branch created.'), 'success')
      setShowForm(false)
      await loadBranches()
    } catch (err) {
      const message = err instanceof Error ? err.message : t('customers.companies.detail.branches.createError', 'Failed to create branch.')
      flash(message, 'error')
    } finally {
      setIsSubmitting(false)
    }
  }, [companyId, guardedRun, loadBranches, t])

  const handleUpdate = React.useCallback(async (branchId: string, data: BranchFormData) => {
    setIsSubmitting(true)
    try {
      await guardedRun(() =>
        apiCallOrThrow('/api/customers/branches', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            id: branchId,
            name: data.name.trim(),
            branchType: data.branchType || undefined,
            specialization: data.specialization.trim() || undefined,
            budget: data.budget ? parseFloat(data.budget) : undefined,
            headcount: data.headcount ? parseInt(data.headcount, 10) : undefined,
            isActive: data.isActive,
          }),
        }),
      )
      flash(t('customers.companies.detail.branches.updateSuccess', 'Branch updated.'), 'success')
      setEditingId(null)
      await loadBranches()
    } catch (err) {
      const message = err instanceof Error ? err.message : t('customers.companies.detail.branches.updateError', 'Failed to update branch.')
      flash(message, 'error')
    } finally {
      setIsSubmitting(false)
    }
  }, [guardedRun, loadBranches, t])

  const handleDelete = React.useCallback(async (branchId: string, branchName: string) => {
    const confirmed = await confirm({
      title: t('customers.companies.detail.branches.deleteConfirm', 'Delete branch "{{name}}"?', { name: branchName }),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      await guardedRun(() =>
        apiCallOrThrow(`/api/customers/branches?id=${encodeURIComponent(branchId)}`, {
          method: 'DELETE',
        }),
      )
      flash(t('customers.companies.detail.branches.deleteSuccess', 'Branch deleted.'), 'success')
      await loadBranches()
    } catch (err) {
      const message = err instanceof Error ? err.message : t('customers.companies.detail.branches.deleteError', 'Failed to delete branch.')
      flash(message, 'error')
    }
  }, [confirm, guardedRun, loadBranches, t])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner className="h-5 w-5" />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground">
        <p className="text-destructive">{loadError}</p>
        <Button size="sm" variant="outline" onClick={() => loadBranches()}>
          {t('customers.companies.detail.branches.retry', 'Retry')}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {showForm && (
        <BranchForm
          onSubmit={handleCreate}
          onCancel={() => setShowForm(false)}
          isSubmitting={isSubmitting}
        />
      )}

      {branches.length === 0 && !showForm && (
        <div className="flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground">
          <p>{t('customers.companies.detail.branches.empty', 'No branches yet.')}</p>
          <Button size="sm" variant="outline" onClick={() => setShowForm(true)}>
            {t('customers.companies.detail.branches.add', 'Add branch')}
          </Button>
        </div>
      )}

      {branches.length > 0 && (
        <div className="divide-y rounded-lg border">
          {branches.map((branch) => {
            if (editingId === branch.id) {
              return (
                <div key={branch.id} className="p-3">
                  <BranchForm
                    initial={{
                      name: branch.name,
                      branchType: branch.branch_type ?? '',
                      specialization: branch.specialization ?? '',
                      budget: branch.budget ?? '',
                      headcount: branch.headcount?.toString() ?? '',
                      isActive: branch.is_active,
                    }}
                    onSubmit={(data) => handleUpdate(branch.id, data)}
                    onCancel={() => setEditingId(null)}
                    isSubmitting={isSubmitting}
                  />
                </div>
              )
            }
            return (
              <div key={branch.id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{branch.name}</span>
                    {branch.branch_type && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                        {branchTypeLabels[branch.branch_type] ?? branch.branch_type}
                      </span>
                    )}
                    {!branch.is_active && (
                      <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-400">
                        {t('customers.companies.detail.branches.inactive', 'Inactive')}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
                    {branch.specialization && <span>{branch.specialization}</span>}
                    {branch.budget && (
                      <span>{t('customers.companies.detail.branches.budgetLabel', 'Budget')}: {branch.budget}</span>
                    )}
                    {branch.headcount !== null && branch.headcount !== undefined && (
                      <span>{t('customers.companies.detail.branches.headcountLabel', 'Staff')}: {branch.headcount}</span>
                    )}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditingId(branch.id)}>
                    {t('customers.companies.detail.branches.edit', 'Edit')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => handleDelete(branch.id, branch.name)}>
                    {t('customers.companies.detail.branches.delete', 'Delete')}
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}
      {ConfirmDialogElement}
    </div>
  )
}
