"use client"

import * as React from 'react'
import { z } from 'zod'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { XRAY_API_BASE, XRAY_PAGE_BASE } from '../../lib/client/xray/api'
import {
  loadWorkflowDefinitionOptions,
  resolveWorkflowDefinitionLabel,
  saveXraySettings,
  useXrayResource,
} from '../../lib/client/xray/hooks'
import type { XraySettings, XraySettingsResponse, XraySettingsUpdate } from '../../lib/client/xray/types'
import { XrayActivityStepMapEditor, XRAY_STEP_MAP_MAX_ROWS } from './XrayActivityStepMapEditor'
import { XrayErrorNotice } from './XrayErrorNotice'
import { XrayStatusPanel } from './XrayStatusPanel'

export const XRAY_SETTINGS_FORM_ID = 'insights-xray-settings'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type XraySettingsFormValues = {
  enabled: boolean
  retentionDays: number
  kAnonymity: number
  debounceSeconds: number
  individualsEnabled: boolean
  timeZone: string
  suggestionMinSupport: number | string | null
  conformanceWorkflowId: string | null
  activityStepMap: Record<string, string> | null
  updatedAt: string | null
}

function integerField(min: number, max: number, message: string) {
  return z.coerce.number({ error: message }).int(message).min(min, message).max(max, message)
}

function emptyToNull(value: unknown): unknown {
  return value === '' || value === undefined ? null : value
}

/** Client-side validation mirroring the API limits (messages are i18n keys, translated by CrudForm). */
export const xraySettingsFormSchema = z.object({
  enabled: z.boolean(),
  retentionDays: integerField(7, 3650, 'insights.xray.ui.settings.errors.retentionDays'),
  kAnonymity: integerField(5, 1000, 'insights.xray.ui.settings.errors.kAnonymity'),
  debounceSeconds: integerField(0, 86400, 'insights.xray.ui.settings.errors.debounceSeconds'),
  individualsEnabled: z.boolean(),
  timeZone: z.string().trim().min(1, 'insights.xray.ui.settings.errors.timeZone').max(64, 'insights.xray.ui.settings.errors.timeZone'),
  suggestionMinSupport: z.preprocess(
    emptyToNull,
    integerField(5, 100000, 'insights.xray.ui.settings.errors.suggestionMinSupport').nullable(),
  ),
  conformanceWorkflowId: z.preprocess(
    emptyToNull,
    z.string().regex(UUID_PATTERN, 'insights.xray.ui.settings.errors.conformanceWorkflowId').nullable(),
  ),
  activityStepMap: z
    .record(z.string(), z.string())
    .nullable()
    .optional()
    .refine((value) => !value || Object.keys(value).length <= XRAY_STEP_MAP_MAX_ROWS, { message: 'insights.xray.ui.settings.errors.stepMap' }),
}).passthrough()

function valuesOf(settings: XraySettings): XraySettingsFormValues {
  return {
    enabled: settings.enabled,
    retentionDays: settings.retentionDays,
    kAnonymity: settings.kAnonymity,
    debounceSeconds: settings.debounceSeconds,
    individualsEnabled: settings.individualsEnabled,
    timeZone: settings.timeZone,
    suggestionMinSupport: settings.suggestionMinSupport,
    conformanceWorkflowId: settings.conformanceWorkflowId,
    activityStepMap: settings.activityStepMap,
    updatedAt: settings.updatedAt,
  }
}

function optionalInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null
}

/** The PUT body of the settings form (only declared keys; empty optional values become `null`). */
export function settingsPayloadOf(values: Partial<XraySettingsFormValues>): XraySettingsUpdate {
  const workflowId = typeof values.conformanceWorkflowId === 'string' && values.conformanceWorkflowId.trim().length > 0
    ? values.conformanceWorkflowId.trim()
    : null
  const stepMap = values.activityStepMap && Object.keys(values.activityStepMap).length > 0 ? values.activityStepMap : null
  return {
    enabled: values.enabled === true,
    retentionDays: Number(values.retentionDays),
    kAnonymity: Number(values.kAnonymity),
    debounceSeconds: Number(values.debounceSeconds),
    individualsEnabled: values.individualsEnabled === true,
    timeZone: String(values.timeZone ?? '').trim(),
    suggestionMinSupport: optionalInteger(values.suggestionMinSupport),
    conformanceWorkflowId: workflowId,
    activityStepMap: stepMap,
  }
}

function supportedTimeZones(): string[] {
  try {
    const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] }
    const zones = typeof intl.supportedValuesOf === 'function' ? intl.supportedValuesOf('timeZone') : []
    return zones.includes('UTC') ? zones : ['UTC', ...zones]
  } catch {
    return ['UTC']
  }
}

/**
 * The organization's Process X-Ray settings (CrudForm; the optimistic-lock header comes from the
 * loaded `updatedAt`, a concurrent change answers 409 on the conflict bar) and the projection
 * status with the "Backfill history" action.
 */
export function XraySettingsPageClient() {
  const t = useT()
  const resource = useXrayResource<XraySettingsResponse>(`${XRAY_API_BASE}/settings`)
  const settings = resource.data?.result ?? null
  const initialValues = React.useMemo(() => (settings ? valuesOf(settings) : null), [settings])
  const timeZones = React.useMemo(() => supportedTimeZones(), [])

  const fields = React.useMemo<CrudField[]>(() => [
    { id: 'enabled', type: 'checkbox', label: t('insights.xray.ui.settings.fields.enabled'), description: t('insights.xray.ui.settings.fields.enabledHelp') },
    { id: 'retentionDays', type: 'number', label: t('insights.xray.ui.settings.fields.retentionDays'), description: t('insights.xray.ui.settings.fields.retentionDaysHelp'), required: true },
    { id: 'kAnonymity', type: 'number', label: t('insights.xray.ui.settings.fields.kAnonymity'), description: t('insights.xray.ui.settings.fields.kAnonymityHelp'), required: true },
    { id: 'debounceSeconds', type: 'number', label: t('insights.xray.ui.settings.fields.debounceSeconds'), description: t('insights.xray.ui.settings.fields.debounceSecondsHelp'), required: true },
    {
      id: 'timeZone',
      type: 'combobox',
      label: t('insights.xray.ui.settings.fields.timeZone'),
      description: t('insights.xray.ui.settings.fields.timeZoneHelp'),
      required: true,
      allowCustomValues: false,
      options: timeZones.map((zone) => ({ value: zone, label: zone })),
    },
    {
      id: 'individualsEnabled',
      type: 'checkbox',
      label: t('insights.xray.ui.settings.fields.individualsEnabled'),
      description: t('insights.xray.ui.settings.fields.individualsEnabledHelp'),
    },
    {
      id: 'individualsWarning',
      type: 'custom',
      label: '',
      visibleWhen: { field: 'individualsEnabled', equals: true },
      component: () => (
        <Alert status="warning" size="default" data-testid="xray-individuals-warning">
          <AlertTitle>{t('insights.xray.ui.settings.individualsWarningTitle')}</AlertTitle>
          <AlertDescription>{t('insights.xray.ui.settings.individualsWarning')}</AlertDescription>
        </Alert>
      ),
    },
    {
      id: 'suggestionMinSupport',
      type: 'number',
      label: t('insights.xray.ui.settings.fields.suggestionMinSupport'),
      description: t('insights.xray.ui.settings.fields.suggestionMinSupportHelp'),
    },
    {
      id: 'conformanceWorkflowId',
      type: 'combobox',
      label: t('insights.xray.ui.settings.fields.conformanceWorkflowId'),
      description: t('insights.xray.ui.settings.fields.conformanceWorkflowIdHelp'),
      allowCustomValues: false,
      loadOptions: loadWorkflowDefinitionOptions,
      resolveLabel: resolveWorkflowDefinitionLabel,
    },
    {
      id: 'activityStepMap',
      type: 'custom',
      label: t('insights.xray.ui.settings.fields.activityStepMap'),
      description: t('insights.xray.ui.settings.fields.activityStepMapHelp'),
      rendersOwnError: true,
      component: ({ value, setValue, disabled, error }) => (
        <XrayActivityStepMapEditor value={value} onChange={setValue} disabled={disabled} error={error ? t(error) : undefined} />
      ),
    },
  ], [t, timeZones])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    { id: 'projection', title: t('insights.xray.ui.settings.groups.projection'), column: 1, fields: ['enabled', 'retentionDays', 'debounceSeconds', 'timeZone'] },
    { id: 'privacy', title: t('insights.xray.ui.settings.groups.privacy'), column: 2, fields: ['kAnonymity', 'individualsEnabled', 'individualsWarning'] },
    { id: 'suggestions', title: t('insights.xray.ui.settings.groups.suggestions'), column: 2, fields: ['suggestionMinSupport'] },
    { id: 'conformance', title: t('insights.xray.ui.settings.groups.conformance'), column: 1, fields: ['conformanceWorkflowId', 'activityStepMap'] },
  ], [t])

  const handleSubmit = React.useCallback(async (values: XraySettingsFormValues) => {
    await saveXraySettings(settingsPayloadOf(values), t('insights.xray.ui.settings.saveFailed'))
    flash(t('insights.xray.ui.settings.saved'), 'success')
    resource.reload()
  }, [resource, t])

  return (
    <div className="space-y-8" data-testid="xray-settings-page">
      {resource.loading && !settings ? <LoadingMessage label={t('insights.xray.ui.settings.loading')} /> : null}
      {resource.error ? <XrayErrorNotice error={resource.error} onRetry={resource.reload} /> : null}
      {initialValues ? (
        <CrudForm<XraySettingsFormValues>
          key={initialValues.updatedAt ?? 'new'}
          formId={XRAY_SETTINGS_FORM_ID}
          title={t('insights.xray.ui.settings.title')}
          backHref={XRAY_PAGE_BASE}
          cancelHref={XRAY_PAGE_BASE}
          fields={fields}
          groups={groups}
          schema={xraySettingsFormSchema as unknown as z.ZodType<XraySettingsFormValues>}
          initialValues={initialValues}
          submitLabel={t('insights.xray.ui.settings.save')}
          onSubmit={handleSubmit}
        />
      ) : null}
      <XrayStatusPanel />
    </div>
  )
}
