'use client'

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@open-mercato/ui/primitives/dialog'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { AppearanceSelector, type AppearanceSelectorLabels } from '@open-mercato/core/modules/dictionaries/components/AppearanceSelector'
import { renderDictionaryColor, renderDictionaryIcon, ICON_SUGGESTIONS } from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'

type Pipeline = {
  id: string
  name: string
  isDefault: boolean
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
  | { mode: 'edit'; pipeline: Pipeline }
  | null

type StageDialogState =
  | { mode: 'create' }
  | { mode: 'edit'; stage: PipelineStage }
  | null

export default function PipelineStagesPage() {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const [pipelines, setPipelines] = React.useState<Pipeline[]>([])
  const [selectedPipelineId, setSelectedPipelineId] = React.useState<string | null>(null)
  const [stages, setStages] = React.useState<PipelineStage[]>([])
  const [loadingPipelines, setLoadingPipelines] = React.useState(true)
  const [loadingStages, setLoadingStages] = React.useState(false)
  const [pipelineDialog, setPipelineDialog] = React.useState<PipelineDialogState>(null)
  const [stageDialog, setStageDialog] = React.useState<StageDialogState>(null)
  const [pipelineName, setPipelineName] = React.useState('')
  const [pipelineIsDefault, setPipelineIsDefault] = React.useState(false)
  const [stageName, setStageName] = React.useState('')
  const [stageColor, setStageColor] = React.useState<string | null>(null)
  const [stageIcon, setStageIcon] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)

  const selectedPipeline = React.useMemo(
    () => pipelines.find((p) => p.id === selectedPipelineId) ?? null,
    [pipelines, selectedPipelineId],
  )

  const loadPipelines = React.useCallback(async () => {
    setLoadingPipelines(true)
    try {
      const result = await apiCall<{ items: Pipeline[] }>('/api/customers/pipelines')
      if (result.ok && result.result?.items) {
        const items = result.result.items
        setPipelines(items)
        if (!selectedPipelineId && items.length > 0) {
          const defaultPipeline = items.find((p) => p.isDefault) ?? items[0]
          setSelectedPipelineId(defaultPipeline.id)
        }
      }
    } catch {
      flash(t('customers.config.pipelineStages.errorLoadPipelines', 'Failed to load pipelines'), 'error')
    } finally {
      setLoadingPipelines(false)
    }
  }, [selectedPipelineId, t])

  const loadStages = React.useCallback(async (pipelineId: string) => {
    setLoadingStages(true)
    try {
      const result = await apiCall<{ items: PipelineStage[] }>(
        `/api/customers/pipeline-stages?pipelineId=${encodeURIComponent(pipelineId)}`
      )
      if (result.ok && result.result?.items) {
        setStages(result.result.items)
      }
    } catch {
      flash(t('customers.config.pipelineStages.errorLoadStages', 'Failed to load pipeline stages'), 'error')
    } finally {
      setLoadingStages(false)
    }
  }, [t])

  React.useEffect(() => {
    void loadPipelines()
  }, [loadPipelines])

  React.useEffect(() => {
    if (selectedPipelineId) {
      void loadStages(selectedPipelineId)
    } else {
      setStages([])
    }
  }, [selectedPipelineId, loadStages])

  function openCreatePipeline() {
    setPipelineName('')
    setPipelineIsDefault(false)
    setPipelineDialog({ mode: 'create' })
  }

  function openEditPipeline(pipeline: Pipeline) {
    setPipelineName(pipeline.name)
    setPipelineIsDefault(pipeline.isDefault)
    setPipelineDialog({ mode: 'edit', pipeline })
  }

  async function savePipeline() {
    if (!pipelineName.trim()) return
    setSaving(true)
    try {
      if (pipelineDialog?.mode === 'create') {
        const result = await apiCall<{ id: string }>('/api/customers/pipelines', {
          method: 'POST',
          body: JSON.stringify({ name: pipelineName.trim(), isDefault: pipelineIsDefault }),
          headers: { 'Content-Type': 'application/json' },
        })
        if (!result.ok) {
          flash(t('customers.config.pipelineStages.errorCreatePipeline', 'Failed to create pipeline'), 'error')
          return
        }
        flash(t('customers.config.pipelineStages.createdPipeline', 'Pipeline created'), 'success')
        const newId = result.result?.id ?? null
        await loadPipelines()
        if (newId) setSelectedPipelineId(newId)
      } else if (pipelineDialog?.mode === 'edit') {
        const result = await apiCall('/api/customers/pipelines', {
          method: 'PUT',
          body: JSON.stringify({ id: pipelineDialog.pipeline.id, name: pipelineName.trim(), isDefault: pipelineIsDefault }),
          headers: { 'Content-Type': 'application/json' },
        })
        if (!result.ok) {
          flash(t('customers.config.pipelineStages.errorUpdatePipeline', 'Failed to update pipeline'), 'error')
          return
        }
        flash(t('customers.config.pipelineStages.updatedPipeline', 'Pipeline updated'), 'success')
        await loadPipelines()
      }
      setPipelineDialog(null)
    } finally {
      setSaving(false)
    }
  }

  async function deletePipeline(pipeline: Pipeline) {
    const confirmed = await confirm({
      title: t('customers.config.pipelineStages.deletePipelineTitle', 'Delete pipeline?'),
      text: t(
        'customers.config.pipelineStages.deletePipelineDesc',
        'This pipeline and all its stages will be permanently removed. Deals assigned to it will lose their pipeline assignment.',
      ),
      confirmText: t('customers.config.pipelineStages.deletePipelineConfirm', 'Delete'),
      variant: 'destructive',
    })
    if (!confirmed) return
    const result = await apiCall('/api/customers/pipelines', {
      method: 'DELETE',
      body: JSON.stringify({ id: pipeline.id }),
      headers: { 'Content-Type': 'application/json' },
    })
    if (!result.ok) {
      const error = (result.result as { error?: string })?.error
      flash(error ?? t('customers.config.pipelineStages.errorDeletePipeline', 'Failed to delete pipeline'), 'error')
      return
    }
    flash(t('customers.config.pipelineStages.deletedPipeline', 'Pipeline deleted'), 'success')
    if (selectedPipelineId === pipeline.id) setSelectedPipelineId(null)
    await loadPipelines()
  }

  function openCreateStage() {
    setStageName('')
    setStageColor(null)
    setStageIcon(null)
    setStageDialog({ mode: 'create' })
  }

  function openEditStage(stage: PipelineStage) {
    setStageName(stage.label)
    setStageColor(stage.color)
    setStageIcon(stage.icon)
    setStageDialog({ mode: 'edit', stage })
  }

  async function saveStage() {
    if (!stageName.trim() || !selectedPipelineId) return
    setSaving(true)
    try {
      if (stageDialog?.mode === 'create') {
        const result = await apiCall('/api/customers/pipeline-stages', {
          method: 'POST',
          body: JSON.stringify({ pipelineId: selectedPipelineId, label: stageName.trim(), color: stageColor, icon: stageIcon }),
          headers: { 'Content-Type': 'application/json' },
        })
        if (!result.ok) {
          flash(t('customers.config.pipelineStages.errorCreateStage', 'Failed to create stage'), 'error')
          return
        }
        flash(t('customers.config.pipelineStages.createdStage', 'Stage created'), 'success')
      } else if (stageDialog?.mode === 'edit') {
        const result = await apiCall('/api/customers/pipeline-stages', {
          method: 'PUT',
          body: JSON.stringify({ id: stageDialog.stage.id, label: stageName.trim(), color: stageColor, icon: stageIcon }),
          headers: { 'Content-Type': 'application/json' },
        })
        if (!result.ok) {
          flash(t('customers.config.pipelineStages.errorUpdateStage', 'Failed to update stage'), 'error')
          return
        }
        flash(t('customers.config.pipelineStages.updatedStage', 'Stage updated'), 'success')
      }
      setStageDialog(null)
      await loadStages(selectedPipelineId)
    } finally {
      setSaving(false)
    }
  }

  async function deleteStage(stage: PipelineStage) {
    const confirmed = await confirm({
      title: t('customers.config.pipelineStages.deleteStagTitle', 'Delete stage?'),
      text: t(
        'customers.config.pipelineStages.deleteStageDesc',
        'This stage will be permanently removed. Deals assigned to it will lose their stage assignment.',
      ),
      confirmText: t('customers.config.pipelineStages.deleteStageConfirm', 'Delete'),
      variant: 'destructive',
    })
    if (!confirmed) return
    const result = await apiCall('/api/customers/pipeline-stages', {
      method: 'DELETE',
      body: JSON.stringify({ id: stage.id }),
      headers: { 'Content-Type': 'application/json' },
    })
    if (!result.ok) {
      const error = (result.result as { error?: string })?.error
      flash(error ?? t('customers.config.pipelineStages.errorDeleteStage', 'Failed to delete stage'), 'error')
      return
    }
    flash(t('customers.config.pipelineStages.deletedStage', 'Stage deleted'), 'success')
    if (selectedPipelineId) await loadStages(selectedPipelineId)
  }

  async function moveStage(index: number, direction: 'up' | 'down') {
    const nextIndex = direction === 'up' ? index - 1 : index + 1
    if (nextIndex < 0 || nextIndex >= stages.length) return

    const reordered = [...stages]
    const [moved] = reordered.splice(index, 1)
    reordered.splice(nextIndex, 0, moved)

    const updated = reordered.map((stage, i) => ({ ...stage, order: i }))
    setStages(updated)

    const result = await apiCall('/api/customers/pipeline-stages/reorder', {
      method: 'POST',
      body: JSON.stringify({ stages: updated.map((s) => ({ id: s.id, order: s.order })) }),
      headers: { 'Content-Type': 'application/json' },
    })
    if (!result.ok) {
      flash(t('customers.config.pipelineStages.errorReorder', 'Failed to reorder stages'), 'error')
      if (selectedPipelineId) await loadStages(selectedPipelineId)
    }
  }

  const appearanceLabels = React.useMemo<AppearanceSelectorLabels>(() => ({
    colorLabel: t('customers.config.pipelineStages.colorLabel', 'Color'),
    colorHelp: t('customers.config.pipelineStages.colorHelp', 'Pick a highlight color for this entry.'),
    colorClearLabel: t('customers.config.pipelineStages.colorClear', 'Remove color'),
    iconLabel: t('customers.config.pipelineStages.iconLabel', 'Icon'),
    iconPlaceholder: t('customers.config.pipelineStages.iconPlaceholder', 'Type an emoji or pick one of the suggestions.'),
    iconPickerTriggerLabel: t('customers.config.pipelineStages.iconBrowse', 'Browse icons and emojis'),
    iconSearchPlaceholder: t('customers.config.pipelineStages.iconSearchPlaceholder', 'Search icons or emojis…'),
    iconSearchEmptyLabel: t('customers.config.pipelineStages.iconSearchEmpty', 'No icons match your search.'),
    iconSuggestionsLabel: t('customers.config.pipelineStages.iconSuggestions', 'Suggestions'),
    iconClearLabel: t('customers.config.pipelineStages.iconClear', 'Remove icon'),
    previewEmptyLabel: t('customers.config.pipelineStages.previewEmpty', 'None'),
  }), [t])

  return (
    <Page>
      <PageBody>
        <div className="space-y-6 max-w-2xl">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">
              {t('customers.config.pipelineStages.title', 'Pipeline stages')}
            </h2>
            <a
              href="/backend/customers/deals/pipeline"
              className="text-sm text-muted-foreground hover:underline"
            >
              {t('customers.config.pipelineStages.viewBoard', 'View pipeline board')} →
            </a>
          </div>

          {loadingPipelines ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner size="sm" />
              {t('customers.config.pipelineStages.loadingPipelines', 'Loading pipelines…')}
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <select
                  className="flex h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  value={selectedPipelineId ?? ''}
                  onChange={(e) => setSelectedPipelineId(e.target.value || null)}
                >
                  {pipelines.length === 0 && (
                    <option value="">
                      {t('customers.config.pipelineStages.noPipelines', 'No pipelines yet')}
                    </option>
                  )}
                  {pipelines.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}{p.isDefault ? ` (${t('customers.config.pipelineStages.default', 'default')})` : ''}
                    </option>
                  ))}
                </select>
                {selectedPipeline && (
                  <>
                    <Button variant="outline" size="sm" onClick={() => openEditPipeline(selectedPipeline)}>
                      {t('customers.config.pipelineStages.editPipeline', 'Edit')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive"
                      onClick={() => deletePipeline(selectedPipeline)}
                    >
                      {t('customers.config.pipelineStages.deletePipeline', 'Delete')}
                    </Button>
                  </>
                )}
                <Button variant="outline" size="sm" onClick={openCreatePipeline}>
                  {t('customers.config.pipelineStages.addPipeline', '+ Add pipeline')}
                </Button>
              </div>

              {selectedPipelineId && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium text-muted-foreground">
                      {t('customers.config.pipelineStages.stagesTitle', 'Stages')}
                    </h3>
                    <Button size="sm" onClick={openCreateStage}>
                      {t('customers.config.pipelineStages.addStage', '+ Add stage')}
                    </Button>
                  </div>

                  {loadingStages ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Spinner size="sm" />
                      {t('customers.config.pipelineStages.loadingStages', 'Loading stages…')}
                    </div>
                  ) : stages.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {t('customers.config.pipelineStages.noStages', 'No stages yet. Add your first stage.')}
                    </p>
                  ) : (
                    <div className="divide-y rounded-md border">
                      {stages.map((stage, index) => (
                        <div key={stage.id} className="flex items-center gap-3 px-4 py-3">
                          <div className="flex flex-col gap-1">
                            <button
                              type="button"
                              className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                              onClick={() => moveStage(index, 'up')}
                              disabled={index === 0}
                              aria-label={t('customers.config.pipelineStages.moveUp', 'Move up')}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                              onClick={() => moveStage(index, 'down')}
                              disabled={index === stages.length - 1}
                              aria-label={t('customers.config.pipelineStages.moveDown', 'Move down')}
                            >
                              ↓
                            </button>
                          </div>
                          <span className="flex-1 text-sm flex items-center gap-2">
                            {stage.color ? renderDictionaryColor(stage.color) : null}
                            {stage.icon ? renderDictionaryIcon(stage.icon) : null}
                            {stage.label}
                          </span>
                          <Button variant="ghost" size="sm" onClick={() => openEditStage(stage)}>
                            {t('customers.config.pipelineStages.editStage', 'Edit')}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive"
                            onClick={() => deleteStage(stage)}
                          >
                            {t('customers.config.pipelineStages.deleteStage', 'Delete')}
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <Dialog open={pipelineDialog !== null} onOpenChange={(open) => { if (!open) setPipelineDialog(null) }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {pipelineDialog?.mode === 'create'
                  ? t('customers.config.pipelineStages.createPipelineTitle', 'Create pipeline')
                  : t('customers.config.pipelineStages.editPipelineTitle', 'Edit pipeline')}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1">
                <label className="text-sm font-medium">
                  {t('customers.config.pipelineStages.pipelineName', 'Name')}
                </label>
                <Input
                  value={pipelineName}
                  onChange={(e) => setPipelineName(e.target.value)}
                  placeholder={t('customers.config.pipelineStages.pipelineNamePlaceholder', 'e.g. Sales Pipeline')}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void savePipeline() } }}
                  autoFocus
                />
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={pipelineIsDefault}
                  onChange={(e) => setPipelineIsDefault(e.target.checked)}
                />
                {t('customers.config.pipelineStages.setAsDefault', 'Set as default pipeline')}
              </label>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPipelineDialog(null)} disabled={saving}>
                {t('customers.config.pipelineStages.cancel', 'Cancel')}
              </Button>
              <Button onClick={() => void savePipeline()} disabled={saving || !pipelineName.trim()}>
                {saving ? <Spinner size="sm" /> : t('customers.config.pipelineStages.save', 'Save')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={stageDialog !== null} onOpenChange={(open) => { if (!open) setStageDialog(null) }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {stageDialog?.mode === 'create'
                  ? t('customers.config.pipelineStages.createStageTitle', 'Create stage')
                  : t('customers.config.pipelineStages.editStageTitle', 'Edit stage')}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1">
                <label className="text-sm font-medium">
                  {t('customers.config.pipelineStages.stageName', 'Stage name')}
                </label>
                <Input
                  value={stageName}
                  onChange={(e) => setStageName(e.target.value)}
                  placeholder={t('customers.config.pipelineStages.stageNamePlaceholder', 'e.g. Qualification')}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void saveStage() } }}
                  autoFocus
                />
              </div>
              <AppearanceSelector
                color={stageColor}
                icon={stageIcon}
                onColorChange={setStageColor}
                onIconChange={setStageIcon}
                labels={appearanceLabels}
                iconSuggestions={ICON_SUGGESTIONS}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStageDialog(null)} disabled={saving}>
                {t('customers.config.pipelineStages.cancel', 'Cancel')}
              </Button>
              <Button onClick={() => void saveStage()} disabled={saving || !stageName.trim()}>
                {saving ? <Spinner size="sm" /> : t('customers.config.pipelineStages.save', 'Save')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
