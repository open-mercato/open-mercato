"use client"

import * as React from 'react'
import { Sparkles } from 'lucide-react'
import type { DashboardLayoutItem, DashboardWidgetSetupProps } from '@open-mercato/shared/modules/dashboard/widgets'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Label } from '@open-mercato/ui/primitives/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { StepIndicator, type StepIndicatorStep, type StepIndicatorStatus } from '@open-mercato/ui/primitives/step-indicator'
import { DateRangeSelect } from '@open-mercato/ui/backend/date-range'
import { WidgetDataBatchProvider } from '@open-mercato/ui/backend/dashboard/widgetData'
import CustomMetricWidgetClient from './widget.client'
import { DEFAULT_SETTINGS, hydrateSettings, type CustomMetricSettings, type CustomMetricVisualization } from './config'
import {
  DEFAULT_DATE_RANGE_PRESET,
  GRANULARITY_OPTIONS,
  VISUALIZATIONS,
  buildRequest,
  clampLimit,
  findField,
  generateCustomMetricConfig,
  groupFields,
  metricFields,
  normalizeSettings,
  useCustomMetricCatalog,
} from './lib'
import type { AggregateFunction, DateGranularity } from '../../../lib/aggregations'

const STEP_IDS = ['source', 'measure', 'visualize', 'refine'] as const
const STEP_COUNT = STEP_IDS.length
const PREVIEW_LAYOUT: DashboardLayoutItem = { id: 'custom-metric-preview', widgetId: 'dashboards.analytics.customMetric', order: 0 }
const noop = () => {}

function stepStatus(index: number, current: number): StepIndicatorStatus {
  if (index === current) return 'current'
  return index < current ? 'complete' : 'pending'
}

const CustomMetricSetupWizard: React.FC<DashboardWidgetSetupProps<CustomMetricSettings>> = ({
  open,
  initialSettings,
  context,
  onComplete,
  onCancel,
}) => {
  const t = useT()
  const { catalog, loading: catalogLoading } = useCustomMetricCatalog()
  const [step, setStep] = React.useState(0)
  const [draft, setDraft] = React.useState<CustomMetricSettings>(() => hydrateSettings(initialSettings))
  const [previewDraft, setPreviewDraft] = React.useState<CustomMetricSettings>(draft)

  const isEdit = React.useMemo(() => hydrateSettings(initialSettings).entityType != null, [initialSettings])

  React.useEffect(() => {
    if (!open) return
    setStep(0)
    setDraft(hydrateSettings(initialSettings))
  }, [open, initialSettings])

  React.useEffect(() => {
    if (catalog.length) setDraft((current) => normalizeSettings(current, catalog))
  }, [catalog])

  React.useEffect(() => {
    const handle = setTimeout(() => setPreviewDraft(draft), 250)
    return () => clearTimeout(handle)
  }, [draft])

  const updateDraft = React.useCallback((next: CustomMetricSettings) => {
    setDraft(normalizeSettings(next, catalog))
  }, [catalog])

  const [aiOpen, setAiOpen] = React.useState(false)
  const [aiPrompt, setAiPrompt] = React.useState('')
  const [aiLoading, setAiLoading] = React.useState(false)
  const [aiError, setAiError] = React.useState<string | null>(null)
  const [aiUnavailable, setAiUnavailable] = React.useState(false)

  const handleGenerate = React.useCallback(async () => {
    const prompt = aiPrompt.trim()
    if (!prompt || aiLoading) return
    setAiLoading(true)
    setAiError(null)
    try {
      const result = await generateCustomMetricConfig(prompt)
      if (!result.aiAvailable) {
        setAiUnavailable(true)
        return
      }
      if (!result.config) {
        setAiError(t('dashboards.widgets.customMetric.ai.noResult'))
        return
      }
      updateDraft(hydrateSettings({ ...DEFAULT_SETTINGS, ...result.config }))
      setStep(STEP_COUNT - 1)
    } catch {
      setAiError(t('dashboards.widgets.customMetric.ai.error'))
    } finally {
      setAiLoading(false)
    }
  }, [aiLoading, aiPrompt, t, updateDraft])

  const entity = React.useMemo(
    () => catalog.find((item) => item.entityType === draft.entityType) ?? null,
    [catalog, draft.entityType],
  )
  const request = React.useMemo(() => buildRequest(draft, entity, context), [context, draft, entity])
  const canFinish = request !== null

  const finish = React.useCallback(() => {
    if (request !== null) onComplete(draft)
  }, [draft, onComplete, request])

  const handleKeyDown = React.useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      finish()
    }
  }, [finish])

  const steps: StepIndicatorStep[] = STEP_IDS.map((id, index) => ({
    id,
    label: t(`dashboards.widgets.customMetric.wizard.step.${id}`),
    status: stepStatus(index, step),
  }))

  const metricOptions = metricFields(entity, draft.aggregate)
  const aggregateOptions = findField(entity, draft.metricField)?.aggregates ?? ['count']
  const currentGroupFields = groupFields(entity, draft.visualization)
  const selectedGroup = findField(entity, draft.groupByField)
  const showPreset = draft.dateRangeMode === 'custom' || !context.dateRange
  const hasTimestampGroup = groupFields(entity, 'line').length > 0
  const hasBarGroup = groupFields(entity, 'bar').length > 0
  const hasCategoricalGroup = groupFields(entity, 'donut').length > 0
  const noSources = !catalogLoading && catalog.length === 0
  const nextDisabled = step === 0 && !draft.entityType

  const labelClass = 'text-xs font-semibold uppercase text-muted-foreground'

  const sourceStep = (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t('dashboards.widgets.customMetric.wizard.sourceHint')}</p>
      {catalogLoading ? <div className="flex justify-center py-3"><Spinner className="size-5 text-muted-foreground" /></div> : null}
      {noSources ? <p className="text-sm text-muted-foreground">{t('dashboards.widgets.customMetric.wizard.sourceEmpty')}</p> : null}
      <div className="space-y-1.5">
        <Label htmlFor="wizard-entity" className={labelClass}>{t('dashboards.widgets.customMetric.settings.entity')}</Label>
        <Select value={draft.entityType ?? undefined} onValueChange={(value) => { if (!value) return; updateDraft({ ...draft, entityType: value, metricField: null, aggregate: 'count', groupByField: null, granularity: null }) }}>
          <SelectTrigger id="wizard-entity" size="sm"><SelectValue placeholder={t('dashboards.widgets.customMetric.settings.entity')} /></SelectTrigger>
          <SelectContent>{catalog.map((item) => <SelectItem key={item.entityType} value={item.entityType}>{item.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>
    </div>
  )

  const measureStep = (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t('dashboards.widgets.customMetric.wizard.measureHint')}</p>
      <div className="space-y-1.5">
        <Label htmlFor="wizard-aggregate" className={labelClass}>{t('dashboards.widgets.customMetric.settings.aggregate')}</Label>
        <Select value={draft.aggregate} onValueChange={(value) => updateDraft({ ...draft, aggregate: value as AggregateFunction })}>
          <SelectTrigger id="wizard-aggregate" size="sm"><SelectValue /></SelectTrigger>
          <SelectContent>{aggregateOptions.map((aggregate) => <SelectItem key={aggregate} value={aggregate}>{t(`dashboards.widgets.customMetric.settings.aggregate.${aggregate}`)}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="wizard-field" className={labelClass}>{t('dashboards.widgets.customMetric.settings.field')}</Label>
        <Select value={draft.metricField ?? undefined} disabled={!entity} onValueChange={(value) => { if (!value) return; updateDraft({ ...draft, metricField: value }) }}>
          <SelectTrigger id="wizard-field" size="sm"><SelectValue placeholder={t('dashboards.widgets.customMetric.settings.field')} /></SelectTrigger>
          <SelectContent>{metricOptions.map((field) => <SelectItem key={field.field} value={field.field}>{field.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>
    </div>
  )

  const visualizeStep = (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t('dashboards.widgets.customMetric.wizard.visualizeHint')}</p>
      <div className="space-y-1.5">
        <Label htmlFor="wizard-visualization" className={labelClass}>{t('dashboards.widgets.customMetric.settings.visualization')}</Label>
        <Select value={draft.visualization} onValueChange={(value) => updateDraft({ ...draft, visualization: value as CustomMetricVisualization })}>
          <SelectTrigger id="wizard-visualization" size="sm"><SelectValue /></SelectTrigger>
          <SelectContent>{VISUALIZATIONS.map((visualization) => <SelectItem key={visualization} value={visualization} disabled={(visualization === 'line' && !hasTimestampGroup) || (visualization === 'bar' && !hasBarGroup) || ((visualization === 'donut' || visualization === 'table') && !hasCategoricalGroup)}>{t(`dashboards.widgets.customMetric.settings.visualization.${visualization}`)}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      {draft.visualization !== 'kpi' ? (
        <div className="space-y-1.5">
          <Label htmlFor="wizard-group-by" className={labelClass}>{t('dashboards.widgets.customMetric.settings.groupBy')}</Label>
          <Select value={draft.groupByField ?? undefined} disabled={!currentGroupFields.length} onValueChange={(value) => { if (!value) return; updateDraft({ ...draft, groupByField: value }) }}>
            <SelectTrigger id="wizard-group-by" size="sm"><SelectValue placeholder={t('dashboards.widgets.customMetric.settings.groupBy')} /></SelectTrigger>
            <SelectContent>{currentGroupFields.map((field) => <SelectItem key={field.field} value={field.field}>{field.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      ) : null}
      {selectedGroup?.kind === 'timestamp' ? (
        <div className="space-y-1.5">
          <Label htmlFor="wizard-granularity" className={labelClass}>{t('dashboards.widgets.customMetric.settings.granularity')}</Label>
          <Select value={draft.granularity ?? 'day'} onValueChange={(value) => updateDraft({ ...draft, granularity: value as DateGranularity })}>
            <SelectTrigger id="wizard-granularity" size="sm"><SelectValue /></SelectTrigger>
            <SelectContent>{GRANULARITY_OPTIONS.map((granularity) => <SelectItem key={granularity} value={granularity}>{t(`dashboards.analytics.granularity.${granularity}`)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      ) : null}
      {(draft.visualization === 'bar' || draft.visualization === 'donut' || draft.visualization === 'table') && selectedGroup?.kind !== 'timestamp' ? (
        <div className="space-y-1.5">
          <Label htmlFor="wizard-limit" className={labelClass}>{t('dashboards.widgets.customMetric.settings.limit')}</Label>
          <Input id="wizard-limit" type="number" min={1} max={20} className="w-24" value={draft.limit} onChange={(event) => updateDraft({ ...draft, limit: clampLimit(Number(event.target.value)) })} />
        </div>
      ) : null}
    </div>
  )

  const refineStep = (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t('dashboards.widgets.customMetric.wizard.refineHint')}</p>
      <div className="space-y-1.5">
        <Label htmlFor="wizard-date-range-mode" className={labelClass}>{t('dashboards.widgets.dateRange.mode.label')}</Label>
        <Select value={draft.dateRangeMode} onValueChange={(value) => updateDraft({ ...draft, dateRangeMode: value as 'global' | 'custom' })}>
          <SelectTrigger id="wizard-date-range-mode" size="sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="global">{t('dashboards.widgets.dateRange.mode.global')}</SelectItem>
            <SelectItem value="custom">{t('dashboards.widgets.dateRange.mode.custom')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {showPreset ? <DateRangeSelect id="wizard-date-range" value={draft.dateRangePreset ?? DEFAULT_DATE_RANGE_PRESET} onChange={(dateRangePreset) => updateDraft({ ...draft, dateRangePreset })} /> : null}
      <div className="space-y-1.5">
        <Label htmlFor="wizard-title" className={labelClass}>{t('dashboards.widgets.customMetric.settings.title')}</Label>
        <Input id="wizard-title" value={draft.title} placeholder={t('dashboards.widgets.customMetric.settings.titlePlaceholder')} onChange={(event) => updateDraft({ ...draft, title: event.target.value })} />
      </div>
    </div>
  )

  const stepContent = [sourceStep, measureStep, visualizeStep, refineStep][step]

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel() }}>
      <DialogContent size="xl" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{isEdit ? t('dashboards.widgets.customMetric.wizard.editTitle') : t('dashboards.widgets.customMetric.wizard.createTitle')}</DialogTitle>
        </DialogHeader>
        <StepIndicator steps={steps} />
        {!noSources ? (
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            {aiOpen ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Sparkles className="size-4 text-brand-violet" />
                  <span className="text-sm font-semibold text-foreground">{t('dashboards.widgets.customMetric.ai.title')}</span>
                </div>
                <Textarea
                  value={aiPrompt}
                  rows={2}
                  placeholder={t('dashboards.widgets.customMetric.ai.placeholder')}
                  disabled={aiLoading || aiUnavailable}
                  onChange={(event) => setAiPrompt(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault()
                      event.stopPropagation()
                      handleGenerate().catch(() => {})
                    }
                  }}
                />
                {aiUnavailable ? (
                  <p className="text-xs text-muted-foreground">{t('dashboards.widgets.customMetric.ai.unavailable')}</p>
                ) : null}
                {aiError ? <p className="text-xs text-status-error-text">{aiError}</p> : null}
                <div className="flex items-center justify-end gap-2">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setAiOpen(false)}>
                    {t('dashboards.widgets.customMetric.ai.hide')}
                  </Button>
                  <Button type="button" size="sm" disabled={aiLoading || aiUnavailable || !aiPrompt.trim()} onClick={() => handleGenerate().catch(() => {})}>
                    {aiLoading ? <Spinner className="size-4" /> : <Sparkles className="size-4" />}
                    <span className="ml-2">{t('dashboards.widgets.customMetric.ai.generate')}</span>
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full justify-start gap-2"
                onClick={() => setAiOpen(true)}
              >
                <Sparkles className="size-4 text-brand-violet" />
                <span className="font-medium">{t('dashboards.widgets.customMetric.ai.cta')}</span>
                <span className="text-xs font-normal text-muted-foreground">{t('dashboards.widgets.customMetric.ai.ctaHint')}</span>
              </Button>
            )}
          </div>
        ) : null}
        <div className="grid gap-6 md:grid-cols-2">
          <div className="text-sm">{stepContent}</div>
          <div className="space-y-2">
            <p className="text-overline font-semibold uppercase tracking-widest text-muted-foreground">{t('dashboards.widgets.customMetric.wizard.previewTitle')}</p>
            <div className="min-h-48 rounded-xl border border-border bg-card p-4">
              <WidgetDataBatchProvider>
                <CustomMetricWidgetClient mode="view" layout={PREVIEW_LAYOUT} settings={previewDraft} context={context} onSettingsChange={noop} refreshToken={0} />
              </WidgetDataBatchProvider>
            </div>
          </div>
        </div>
        <DialogFooter>
          <div className="mr-auto">
            {step > 0 ? <Button type="button" variant="outline" onClick={() => setStep((value) => Math.max(0, value - 1))}>{t('dashboards.widgets.customMetric.wizard.back')}</Button> : null}
          </div>
          <Button type="button" variant="outline" onClick={onCancel}>{t('dashboards.widgets.customMetric.wizard.cancel')}</Button>
          {step < STEP_COUNT - 1 ? (
            <Button type="button" disabled={nextDisabled} onClick={() => setStep((value) => Math.min(STEP_COUNT - 1, value + 1))}>{t('dashboards.widgets.customMetric.wizard.next')}</Button>
          ) : (
            <Button type="button" disabled={!canFinish} onClick={finish}>{isEdit ? t('dashboards.widgets.customMetric.wizard.finishEdit') : t('dashboards.widgets.customMetric.wizard.finishCreate')}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default CustomMetricSetupWizard
