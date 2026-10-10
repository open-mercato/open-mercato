"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { KpiCard } from '@open-mercato/ui/backend/charts'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { LoadingMessage, TabEmptyState } from '@open-mercato/ui/backend/detail'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { FormField } from '@open-mercato/ui/primitives/form-field'
import { Input } from '@open-mercato/ui/primitives/input'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { XRAY_SETTINGS_PAGE_PATH, xrayAnalyticsUrl } from '../../../lib/client/xray/api'
import { formatActivityKey, formatCount, formatPercent } from '../../../lib/client/xray/format'
import { useXrayResource } from '../../../lib/client/xray/hooks'
import type { XrayConformanceModel, XrayConformanceResponse } from '../../../lib/client/xray/types'
import { XrayErrorNotice } from '../XrayErrorNotice'
import { XrayResultMeta } from '../XrayResultMeta'
import type { XrayTabProps } from './shared'

type Deviation = XrayConformanceModel['deviations'][number]

const SEQUENCE_MAX_LENGTH = 4000

export function parseSequenceInput(value: string): string[] {
  return value.split(',').map((key) => key.trim()).filter((key) => key.length > 0)
}

function ModelResult({ model }: { model: XrayConformanceModel }) {
  const t = useT()
  const locale = useLocale()
  const columns = React.useMemo<ColumnDef<Deviation>[]>(() => [
    { accessorKey: 'kind', header: t('insights.xray.ui.conformance.columns.kind'), cell: ({ row }) => t(`insights.xray.ui.conformance.deviation.${row.original.kind}`) },
    { id: 'from', header: t('insights.xray.ui.conformance.columns.from'), cell: ({ row }) => (row.original.from ? formatActivityKey(row.original.from, t) : '—') },
    { id: 'to', header: t('insights.xray.ui.conformance.columns.to'), cell: ({ row }) => (row.original.to ? formatActivityKey(row.original.to, t) : '—') },
    { accessorKey: 'cases', header: t('insights.xray.ui.conformance.columns.cases'), cell: ({ row }) => formatCount(row.original.cases, locale) },
  ], [locale, t])
  const sourceLabel = model.source.kind === 'sequence'
    ? t('insights.xray.ui.conformance.sourceSequence')
    : t('insights.xray.ui.conformance.sourceWorkflow', { version: model.source.version ?? '—' })
  return (
    <section className="space-y-3 rounded-lg border border-border p-4" aria-label={sourceLabel} data-testid="xray-conformance-model">
      <h3 className="text-sm font-semibold">{sourceLabel}</h3>
      <div className="grid gap-4 md:grid-cols-3">
        <KpiCard
          title={t('insights.xray.ui.conformance.fitness')}
          value={model.fitness}
          formatValue={(value) => formatPercent(value, locale, 1)}
          footer={(
            <p className="text-xs text-muted-foreground">
              {model.fitness === null
                ? t('insights.xray.ui.stats.hiddenOrEmpty')
                : t('insights.xray.ui.conformance.fitnessLowerBound', { value: formatPercent(model.fitnessLowerBound ?? 0, locale, 1) })}
              {model.lowConfidence ? ` ${t('insights.xray.ui.stats.lowConfidenceShort')}` : ''}
            </p>
          )}
        />
        <KpiCard
          title={t('insights.xray.ui.conformance.conforming')}
          value={model.conformingCases}
          formatValue={(value) => t('insights.xray.ui.conformance.ofCases', { value: formatCount(value, locale), n: formatCount(model.n, locale) })}
          footer={model.conformingCases === null ? <p className="text-xs text-muted-foreground">{t('insights.xray.ui.stats.hiddenOrEmpty')}</p> : undefined}
        />
        <KpiCard
          title={t('insights.xray.ui.conformance.transitions')}
          value={model.transitions ? model.transitions.allowed : null}
          formatValue={(value) => t('insights.xray.ui.conformance.ofTransitions', { value: formatCount(value, locale), total: formatCount(model.transitions?.total ?? 0, locale) })}
          footer={model.transitions === null ? <p className="text-xs text-muted-foreground">{t('insights.xray.ui.stats.hiddenOrEmpty')}</p> : undefined}
        />
      </div>
      <DataTable<Deviation>
        embedded
        columns={columns}
        data={model.deviations}
        emptyState={<EmptyState variant="subtle" size="sm" title={t('insights.xray.ui.conformance.noDeviations')} />}
      />
    </section>
  )
}

export function XrayConformanceTab({ processKey, window, filters, onClearActorFilters, canManage }: XrayTabProps & { canManage: boolean }) {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const [mode, setMode] = React.useState<'workflow' | 'sequence'>('workflow')
  const [sequenceDraft, setSequenceDraft] = React.useState('')
  const [sequence, setSequence] = React.useState<string[]>([])
  const extra = mode === 'sequence' && sequence.length > 0 ? { sequence: sequence.join(',') } : {}
  const url = mode === 'sequence' && sequence.length === 0 ? null : xrayAnalyticsUrl(processKey, 'conformance', window, filters, extra)
  const resource = useXrayResource<XrayConformanceResponse>(url)

  const modeSwitch = (
    <SegmentedControl
      value={mode}
      onValueChange={(next) => { if (next === 'workflow' || next === 'sequence') setMode(next) }}
      size="sm"
      aria-label={t('insights.xray.ui.conformance.modeLabel')}
    >
      <SegmentedControlItem value="workflow">{t('insights.xray.ui.conformance.modeWorkflow')}</SegmentedControlItem>
      <SegmentedControlItem value="sequence">{t('insights.xray.ui.conformance.modeSequence')}</SegmentedControlItem>
    </SegmentedControl>
  )

  const sequenceForm = mode === 'sequence' ? (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        setSequence(parseSequenceInput(sequenceDraft))
      }}
    >
      <FormField className="min-w-0 flex-1" label={t('insights.xray.ui.conformance.sequenceLabel')} description={t('insights.xray.ui.conformance.sequenceHelp')}>
        <Input value={sequenceDraft} maxLength={SEQUENCE_MAX_LENGTH} onChange={(event) => setSequenceDraft(event.target.value)} />
      </FormField>
      <Button type="submit" variant="outline" disabled={parseSequenceInput(sequenceDraft).length === 0}>
        {t('insights.xray.ui.conformance.compare')}
      </Button>
    </form>
  ) : null

  let body: React.ReactNode = null
  if (!url) {
    body = <TabEmptyState title={t('insights.xray.ui.conformance.sequenceEmptyTitle')} description={t('insights.xray.ui.conformance.sequenceEmptyDescription')} />
  } else if (resource.loading && !resource.data) {
    body = <LoadingMessage label={t('insights.xray.ui.loading')} />
  } else if (resource.error?.code === 'conformance_model_missing') {
    body = (
      <TabEmptyState
        title={t('insights.xray.ui.conformance.noModelTitle')}
        description={canManage ? t('insights.xray.ui.conformance.noModelManage') : t('insights.xray.ui.conformance.noModelView')}
        action={canManage ? { label: t('insights.xray.ui.conformance.openSettings'), onClick: () => router.push(XRAY_SETTINGS_PAGE_PATH) } : undefined}
      />
    )
  } else if (resource.error) {
    body = <XrayErrorNotice error={resource.error} onClearActorFilters={onClearActorFilters} onRetry={resource.reload} />
  } else if (resource.data) {
    const data = resource.data
    body = (
      <div className="space-y-4" aria-busy={resource.loading}>
        <XrayResultMeta meta={data} nLabelKey="insights.xray.ui.meta.completedCases" />
        {data.status === 'refused' ? (
          <Alert status="information" size="default" data-testid="xray-conformance-refused">
            <AlertTitle>{t(`insights.xray.ui.conformance.refused.${data.reason}`)}</AlertTitle>
            <AlertDescription>
              {t('insights.xray.ui.conformance.coverage', {
                coverage: data.coverage === null ? '—' : formatPercent(data.coverage, locale),
                minimum: formatPercent(data.minCoverage, locale),
              })}
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              {t('insights.xray.ui.conformance.coverage', { coverage: formatPercent(data.coverage, locale), minimum: formatPercent(data.minCoverage, locale) })}
              {data.unresolvedCases > 0 ? ` ${t('insights.xray.ui.conformance.unresolved', { count: formatCount(data.unresolvedCases, locale) })}` : ''}
            </p>
            {data.models.map((model) => <ModelResult key={model.key} model={model} />)}
            {data.unmappedActivities.length > 0 ? (
              <p className="text-xs text-muted-foreground" data-testid="xray-conformance-unmapped">
                {t('insights.xray.ui.conformance.unmapped', {
                  activities: data.unmappedActivities.map((item) => formatActivityKey(item.activityKey, t)).join(', '),
                })}
              </p>
            ) : null}
          </>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {modeSwitch}
        {canManage && mode === 'workflow' ? (
          <Button asChild variant="ghost" size="sm">
            <Link href={XRAY_SETTINGS_PAGE_PATH}>{t('insights.xray.ui.conformance.configure')}</Link>
          </Button>
        ) : null}
      </div>
      {sequenceForm}
      {body}
    </div>
  )
}
