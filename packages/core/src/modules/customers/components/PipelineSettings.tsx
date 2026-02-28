"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import {
  AppearanceSelector,
  type AppearanceSelectorLabels,
} from '@open-mercato/core/modules/dictionaries/components/AppearanceSelector'
import {
  renderDictionaryColor,
  renderDictionaryIcon,
} from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'

type Pipeline = {
  id: string
  name: string
  isDefault: boolean
  organizationId: string
  tenantId: string
}

type PipelineStage = {
  id: string
  pipelineId: string
  label: string
  order: number
  color: string | null
  icon: string | null
}

type PipelineDialogState =
  | { mode: 'create' }
  | { mode: 'edit'; entry: Pipeline }

type StageDialogState =
  | { mode: 'create'; pipelineId: string }
  | { mode: 'edit'; entry: PipelineStage }

function normalizePipeline(raw: Record<string, unknown>): Pipeline {
  return {
    id: typeof raw.id === 'string' ? raw.id : '',
    name: typeof raw.name === 'string' ? raw.name : '',
    isDefault: raw.isDefault === true || raw.is_default === true,
    organizationId: typeof raw.organizationId === 'string' ? raw.organizationId : (typeof raw.organization_id === 'string' ? raw.organization_id : ''),
    tenantId: typeof raw.tenantId === 'string' ? raw.tenantId : (typeof raw.tenant_id === 'string' ? raw.tenant_id : ''),
  }
}

function normalizeStage(raw: Record<string, unknown>): PipelineStage {
  return {
    id: typeof raw.id === 'string' ? raw.id : '',
    pipelineId: typeof raw.pipelineId === 'string' ? raw.pipelineId : (typeof raw.pipeline_id === 'string' ? raw.pipeline_id : ''),
    label: typeof raw.label === 'string' ? raw.label : '',
    order: typeof raw.order === 'number' ? raw.order : 0,
    color: typeof raw.color === 'string' && raw.color.trim().length ? raw.color.trim() : null,
    icon: typeof raw.icon === 'string' && raw.icon.trim().length ? raw.icon.trim() : null,
  }
}

export default function PipelineSettings(): React.ReactElement {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const [pipelines, setPipelines] = React.useState<Pipeline[]>([])
  const [loadingPipelines, setLoadingPipelines] = React.useState(false)
  const [pipelineDialog, setPipelineDialog] = React.useState<PipelineDialogState | null>(null)
  const [pipelineForm, setPipelineForm] = React.useState({ name: '', isDefault: false })
  const [submittingPipeline, setSubmittingPipeline] = React.useState(false)

  const [expandedPipelineId, setExpandedPipelineId] = React.useState<string | null>(null)
  const [stages, setStages] = React.useState<Record<string, PipelineStage[]>>({})
  const [loadingStages, setLoadingStages] = React.useState<Record<string, boolean>>({})
  const [stageDialog, setStageDialog] = React.useState<StageDialogState | null>(null)
  const [stageForm, setStageForm] = React.useState({ label: '', color: null as string | null, icon: null as string | null })
  const [submittingStage, setSubmittingStage] = React.useState(false)

  const loadPipelines = React.useCallback(async () => {
    setLoadingPipelines(true)
    try {
      const data = await readApiResultOrThrow<{ items?: unknown[] }>(
        '/api/customers/pipelines',
        undefined,
        { errorMessage: t('customers.pipelines.errors.loadFailed', 'Failed to load pipelines'), fallback: { items: [] } },
      )
      const items = Array.isArray(data?.items) ? data.items : []
      setPipelines(items.map((item) => normalizePipeline(item as Record<string, unknown>)))
    } finally {
      setLoadingPipelines(false)
    }
  }, [t])

  const loadStages = React.useCallback(async (pipelineId: string) => {
    setLoadingStages((prev) => ({ ...prev, [pipelineId]: true }))
    try {
      const data = await readApiResultOrThrow<{ items?: unknown[] }>(
        `/api/customers/pipeline-stages?pipelineId=${encodeURIComponent(pipelineId)}`,
        undefined,
        { errorMessage: t('customers.pipelines.errors.stagesLoadFailed', 'Failed to load stages'), fallback: { items: [] } },
      )
      const items = Array.isArray(data?.items) ? data.items : []
      setStages((prev) => ({
        ...prev,
        [pipelineId]: items.map((item) => normalizeStage(item as Record<string, unknown>)),
      }))
    } finally {
      setLoadingStages((prev) => ({ ...prev, [pipelineId]: false }))
    }
  }, [t])

  React.useEffect(() => {
    void loadPipelines()
  }, [loadPipelines, scopeVersion])

  React.useEffect(() => {
    if (expandedPipelineId) {
      void loadStages(expandedPipelineId)
    }
  }, [expandedPipelineId, loadStages])

  const openCreatePipeline = React.useCallback(() => {
    setPipelineForm({ name: '', isDefault: false })
    setPipelineDialog({ mode: 'create' })
  }, [])

  const openEditPipeline = React.useCallback((pipeline: Pipeline) => {
    setPipelineForm({ name: pipeline.name, isDefault: pipeline.isDefault })
    setPipelineDialog({ mode: 'edit', entry: pipeline })
  }, [])

  const closePipelineDialog = React.useCallback(() => {
    setPipelineDialog(null)
  }, [])

  const handlePipelineSubmit = React.useCallback(async () => {
    if (!pipelineForm.name.trim()) return
    setSubmittingPipeline(true)
    try {
      if (pipelineDialog?.mode === 'create') {
        const res = await apiCall('/api/customers/pipelines', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: pipelineForm.name.trim(), isDefault: pipelineForm.isDefault }),
        })
        if (!res.ok) {
          await raiseCrudError(res.response, t('customers.pipelines.errors.createFailed', 'Failed to create pipeline'))
          return
        }
        flash(t('customers.pipelines.flash.created', 'Pipeline created'), 'success')
      } else if (pipelineDialog?.mode === 'edit') {
        const res = await apiCall('/api/customers/pipelines', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: pipelineDialog.entry.id, name: pipelineForm.name.trim(), isDefault: pipelineForm.isDefault }),
        })
        if (!res.ok) {
          await raiseCrudError(res.response, t('customers.pipelines.errors.updateFailed', 'Failed to update pipeline'))
          return
        }
        flash(t('customers.pipelines.flash.updated', 'Pipeline updated'), 'success')
      }
      setPipelineDialog(null)
      await loadPipelines()
    } finally {
      setSubmittingPipeline(false)
    }
  }, [pipelineDialog, pipelineForm, loadPipelines, t])

  const handleDeletePipeline = React.useCallback(async (pipeline: Pipeline) => {
    const confirmed = await confirm({
      title: t('customers.pipelines.confirm.deleteTitle', 'Delete pipeline'),
      text: t('customers.pipelines.confirm.deleteDesc', 'Are you sure you want to delete this pipeline? This cannot be undone.'),
      confirmText: t('customers.pipelines.confirm.deleteConfirm', 'Delete'),
      variant: 'destructive',
    })
    if (!confirmed) return
    const res = await apiCall('/api/customers/pipelines', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: pipeline.id }),
    })
    if (!res.ok) {
      const body = (res.result ?? {}) as Record<string, unknown>
      const msg = typeof body.error === 'string' ? body.error : t('customers.pipelines.errors.deleteFailed', 'Failed to delete pipeline')
      flash(msg, 'error')
      return
    }
    flash(t('customers.pipelines.flash.deleted', 'Pipeline deleted'), 'success')
    if (expandedPipelineId === pipeline.id) setExpandedPipelineId(null)
    await loadPipelines()
  }, [confirm, expandedPipelineId, loadPipelines, t])

  const toggleExpand = React.useCallback((pipelineId: string) => {
    setExpandedPipelineId((prev) => (prev === pipelineId ? null : pipelineId))
  }, [])

  const openCreateStage = React.useCallback((pipelineId: string) => {
    setStageForm({ label: '', color: null, icon: null })
    setStageDialog({ mode: 'create', pipelineId })
  }, [])

  const openEditStage = React.useCallback((stage: PipelineStage) => {
    setStageForm({ label: stage.label, color: stage.color, icon: stage.icon })
    setStageDialog({ mode: 'edit', entry: stage })
  }, [])

  const closeStageDialog = React.useCallback(() => {
    setStageDialog(null)
  }, [])

  const handleStageSubmit = React.useCallback(async () => {
    if (!stageForm.label.trim()) return
    setSubmittingStage(true)
    try {
      const appearance: Record<string, unknown> = {}
      if (stageForm.color) appearance.color = stageForm.color
      if (stageForm.icon) appearance.icon = stageForm.icon

      if (stageDialog?.mode === 'create') {
        const res = await apiCall('/api/customers/pipeline-stages', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ pipelineId: stageDialog.pipelineId, label: stageForm.label.trim(), ...appearance }),
        })
        if (!res.ok) {
          await raiseCrudError(res.response, t('customers.pipelines.errors.stageCreateFailed', 'Failed to create stage'))
          return
        }
        flash(t('customers.pipelines.flash.stageCreated', 'Stage created'), 'success')
        await loadStages(stageDialog.pipelineId)
      } else if (stageDialog?.mode === 'edit') {
        const res = await apiCall('/api/customers/pipeline-stages', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: stageDialog.entry.id, label: stageForm.label.trim(), ...appearance }),
        })
        if (!res.ok) {
          await raiseCrudError(res.response, t('customers.pipelines.errors.stageUpdateFailed', 'Failed to update stage'))
          return
        }
        flash(t('customers.pipelines.flash.stageUpdated', 'Stage updated'), 'success')
        await loadStages(stageDialog.entry.pipelineId)
      }
      setStageDialog(null)
    } finally {
      setSubmittingStage(false)
    }
  }, [stageDialog, stageForm, loadStages, t])

  const handleDeleteStage = React.useCallback(async (stage: PipelineStage) => {
    const confirmed = await confirm({
      title: t('customers.pipelines.confirm.stageDeleteTitle', 'Delete stage'),
      text: t('customers.pipelines.confirm.stageDeleteDesc', 'Are you sure you want to delete this stage?'),
      confirmText: t('customers.pipelines.confirm.stageDeleteConfirm', 'Delete'),
      variant: 'destructive',
    })
    if (!confirmed) return
    const res = await apiCall('/api/customers/pipeline-stages', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: stage.id }),
    })
    if (!res.ok) {
      const body = (res.result ?? {}) as Record<string, unknown>
      const msg = typeof body.error === 'string' ? body.error : t('customers.pipelines.errors.stageDeleteFailed', 'Failed to delete stage')
      flash(msg, 'error')
      return
    }
    flash(t('customers.pipelines.flash.stageDeleted', 'Stage deleted'), 'success')
    await loadStages(stage.pipelineId)
  }, [confirm, loadStages, t])

  const handleMoveStage = React.useCallback(async (stage: PipelineStage, direction: 'up' | 'down') => {
    const pipelineStages = stages[stage.pipelineId] ?? []
    const idx = pipelineStages.findIndex((s) => s.id === stage.id)
    if (idx < 0) return
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= pipelineStages.length) return

    const reordered = [...pipelineStages]
    const temp = reordered[idx]
    reordered[idx] = reordered[swapIdx]
    reordered[swapIdx] = temp

    const orderedStages = reordered.map((s, i) => ({ id: s.id, order: i }))
    const res = await apiCall('/api/customers/pipeline-stages/reorder', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stages: orderedStages }),
    })
    if (!res.ok) {
      flash(t('customers.pipelines.errors.reorderFailed', 'Failed to reorder stages'), 'error')
      return
    }
    await loadStages(stage.pipelineId)
  }, [stages, loadStages, t])

  const handleKeyDown = React.useCallback(
    (handler: () => void) => (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        handler()
      }
    },
    [],
  )

  const appearanceLabels = React.useMemo<AppearanceSelectorLabels>(() => ({
    colorLabel: t('customers.pipelines.stageForm.color', 'Color'),
    colorClearLabel: t('customers.pipelines.stageForm.colorClear', 'Remove color'),
    iconLabel: t('customers.pipelines.stageForm.icon', 'Icon'),
    iconPlaceholder: t('customers.pipelines.stageForm.iconPlaceholder', 'e.g. lucide:star'),
    iconPickerTriggerLabel: t('customers.pipelines.stageForm.iconPicker', 'Pick icon'),
    iconSearchPlaceholder: t('customers.pipelines.stageForm.iconSearch', 'Search icons…'),
    iconSearchEmptyLabel: t('customers.pipelines.stageForm.iconSearchEmpty', 'No icons found'),
    iconSuggestionsLabel: t('customers.pipelines.stageForm.iconSuggestions', 'Suggestions'),
    iconClearLabel: t('customers.pipelines.stageForm.iconClear', 'Remove icon'),
    previewEmptyLabel: t('customers.pipelines.stageForm.previewEmpty', 'No appearance set'),
  }), [t])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">{t('customers.pipelines.title', 'Sales Pipelines')}</h3>
          <p className="text-sm text-muted-foreground">
            {t('customers.pipelines.description', 'Manage sales pipelines and their stages.')}
          </p>
        </div>
        <Button size="sm" onClick={openCreatePipeline}>
          {t('customers.pipelines.actions.create', 'Add pipeline')}
        </Button>
      </div>

      {loadingPipelines ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" />
          {t('customers.pipelines.loading', 'Loading pipelines…')}
        </div>
      ) : pipelines.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('customers.pipelines.empty', 'No pipelines yet. Create one to get started.')}
        </p>
      ) : (
        <div className="divide-y divide-border rounded-md border">
          {pipelines.map((pipeline) => {
            const isExpanded = expandedPipelineId === pipeline.id
            const pipelineStages = stages[pipeline.id] ?? []
            const isLoadingStages = loadingStages[pipeline.id] ?? false

            return (
              <div key={pipeline.id}>
                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{pipeline.name}</span>
                    {pipeline.isDefault ? (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                        {t('customers.pipelines.defaultBadge', 'Default')}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleExpand(pipeline.id)}
                    >
                      {isExpanded
                        ? t('customers.pipelines.actions.hideStages', 'Hide stages')
                        : t('customers.pipelines.actions.manageStages', 'Manage stages')}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => openEditPipeline(pipeline)}>
                      {t('customers.pipelines.actions.edit', 'Edit')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => void handleDeletePipeline(pipeline)}
                    >
                      {t('customers.pipelines.actions.delete', 'Delete')}
                    </Button>
                  </div>
                </div>

                {isExpanded ? (
                  <div className="border-t border-border bg-muted/30 px-4 py-3">
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        {t('customers.pipelines.stages.title', 'Stages')}
                      </span>
                      <Button size="sm" variant="outline" onClick={() => openCreateStage(pipeline.id)}>
                        {t('customers.pipelines.stages.add', 'Add stage')}
                      </Button>
                    </div>

                    {isLoadingStages ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Spinner className="h-3 w-3" />
                        {t('customers.pipelines.stages.loading', 'Loading…')}
                      </div>
                    ) : pipelineStages.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        {t('customers.pipelines.stages.empty', 'No stages yet.')}
                      </p>
                    ) : (
                      <div className="divide-y divide-border rounded-md border bg-background">
                        {pipelineStages.map((stage, idx) => (
                          <div key={stage.id} className="flex items-center justify-between gap-3 px-3 py-2">
                            <div className="flex items-center gap-2">
                              <span className="w-5 text-center text-xs text-muted-foreground">{idx + 1}</span>
                              {stage.color ? renderDictionaryColor(stage.color, 'h-3 w-3 rounded-full') : null}
                              {stage.icon ? renderDictionaryIcon(stage.icon, 'h-4 w-4') : null}
                              <span className="text-sm">{stage.label}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                disabled={idx === 0}
                                onClick={() => void handleMoveStage(stage, 'up')}
                                title={t('customers.pipelines.stages.moveUp', 'Move up')}
                              >
                                ↑
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                disabled={idx === pipelineStages.length - 1}
                                onClick={() => void handleMoveStage(stage, 'down')}
                                title={t('customers.pipelines.stages.moveDown', 'Move down')}
                              >
                                ↓
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openEditStage(stage)}
                              >
                                {t('customers.pipelines.stages.edit', 'Edit')}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                onClick={() => void handleDeleteStage(stage)}
                              >
                                {t('customers.pipelines.stages.delete', 'Delete')}
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}

      {/* Pipeline Dialog */}
      <Dialog open={pipelineDialog !== null} onOpenChange={(open) => { if (!open) closePipelineDialog() }}>
        <DialogContent onKeyDown={handleKeyDown(handlePipelineSubmit)}>
          <DialogHeader>
            <DialogTitle>
              {pipelineDialog?.mode === 'create'
                ? t('customers.pipelines.dialog.createTitle', 'Create pipeline')
                : t('customers.pipelines.dialog.editTitle', 'Edit pipeline')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="pipeline-name">{t('customers.pipelines.form.name', 'Name')}</Label>
              <Input
                id="pipeline-name"
                value={pipelineForm.name}
                onChange={(e) => setPipelineForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder={t('customers.pipelines.form.namePlaceholder', 'e.g. New Business')}
                autoFocus
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="pipeline-default"
                checked={pipelineForm.isDefault}
                onCheckedChange={(checked) => setPipelineForm((prev) => ({ ...prev, isDefault: checked === true }))}
              />
              <Label htmlFor="pipeline-default" className="cursor-pointer">
                {t('customers.pipelines.form.isDefault', 'Set as default pipeline')}
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closePipelineDialog} disabled={submittingPipeline}>
              {t('customers.pipelines.dialog.cancel', 'Cancel')}
            </Button>
            <Button onClick={() => void handlePipelineSubmit()} disabled={submittingPipeline || !pipelineForm.name.trim()}>
              {submittingPipeline ? <Spinner className="mr-2 h-4 w-4" /> : null}
              {t('customers.pipelines.dialog.save', 'Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {ConfirmDialogElement}

      {/* Stage Dialog */}
      <Dialog open={stageDialog !== null} onOpenChange={(open) => { if (!open) closeStageDialog() }}>
        <DialogContent onKeyDown={handleKeyDown(handleStageSubmit)}>
          <DialogHeader>
            <DialogTitle>
              {stageDialog?.mode === 'create'
                ? t('customers.pipelines.stageDialog.createTitle', 'Add stage')
                : t('customers.pipelines.stageDialog.editTitle', 'Edit stage')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="stage-label">{t('customers.pipelines.stageForm.label', 'Label')}</Label>
              <Input
                id="stage-label"
                value={stageForm.label}
                onChange={(e) => setStageForm((prev) => ({ ...prev, label: e.target.value }))}
                placeholder={t('customers.pipelines.stageForm.labelPlaceholder', 'e.g. Discovery')}
                autoFocus
              />
            </div>
            <AppearanceSelector
              color={stageForm.color}
              icon={stageForm.icon}
              onColorChange={(next) => setStageForm((prev) => ({ ...prev, color: next }))}
              onIconChange={(next) => setStageForm((prev) => ({ ...prev, icon: next }))}
              labels={appearanceLabels}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeStageDialog} disabled={submittingStage}>
              {t('customers.pipelines.stageDialog.cancel', 'Cancel')}
            </Button>
            <Button onClick={() => void handleStageSubmit()} disabled={submittingStage || !stageForm.label.trim()}>
              {submittingStage ? <Spinner className="mr-2 h-4 w-4" /> : null}
              {t('customers.pipelines.stageDialog.save', 'Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
