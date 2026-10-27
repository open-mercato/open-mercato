"use client"

/**
 * The tenant's trace capture policy: how much of each model call agent runs
 * record (nothing, metadata, or full content), for how long, and per-agent
 * overrides for debugging one agent without raising capture for all of them.
 *
 * The deployment default and ceiling come from environment variables and are
 * shown read-only; a tenant level above the ceiling is clamped at run time, so
 * the page says so instead of letting the admin believe it took effect.
 *
 * Saves are optimistic-locked on the config row's `updatedAt` returned by GET.
 */

import * as React from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { DateTimePicker } from '@open-mercato/ui/backend/inputs/DateTimePicker'
import { apiCall, readApiResultOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { hasFeature } from '@open-mercato/shared/security/features'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { TRACE_CAPTURE_LEVELS, TRACE_CAPTURE_PER_AGENT_MAX } from '../../../data/validators'
import {
  INHERIT_EVAL_LEVEL,
  RETENTION_DAYS_MAX,
  RETENTION_DAYS_MIN,
  formExceedsCeiling,
  formRequestsFullCapture,
  formSignature,
  formToPolicy,
  isOverrideExpired,
  parseAgentOptions,
  parseTraceCaptureSettingsResponse,
  policyToForm,
  validateTraceCaptureForm,
  withMissingAgentOptions,
  type AgentOption,
  type EvalLevelChoice,
  type TraceCaptureFormErrors,
  type TraceCaptureLevel,
  type TraceCaptureOverrideRow,
  type TraceCaptureSettingsForm,
} from '../../../lib/trace/captureSettingsForm'

const SETTINGS_URL = '/api/agent_orchestrator/trace-capture/settings'
const AGENTS_URL = '/api/agent_orchestrator/agents'
const CONTEXT_ID = 'agent_orchestrator.trace_capture.settings'

type Deployment = { deploymentDefault: TraceCaptureLevel; deploymentCeiling: TraceCaptureLevel }

type Translate = ReturnType<typeof useT>

function levelLabel(t: Translate, level: TraceCaptureLevel): string {
  return t(`agent_orchestrator.settings.traceCapture.level.${level}`, level)
}

function LevelSelect({
  value,
  disabled,
  onChange,
  includeInherit,
  ariaLabel,
}: {
  value: EvalLevelChoice
  disabled: boolean
  onChange: (next: EvalLevelChoice) => void
  includeInherit?: boolean
  ariaLabel: string
}) {
  const t = useT()
  return (
    <Select value={value} disabled={disabled} onValueChange={(next) => onChange(next as EvalLevelChoice)}>
      <SelectTrigger aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {includeInherit ? (
          <SelectItem value={INHERIT_EVAL_LEVEL}>
            {t('agent_orchestrator.settings.traceCapture.evalLevelInherit', 'Same as the tenant level')}
          </SelectItem>
        ) : null}
        {TRACE_CAPTURE_LEVELS.map((level) => (
          <SelectItem key={level} value={level}>
            {levelLabel(t, level)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

let rowCounter = 0

function nextRowKey(): string {
  rowCounter += 1
  return `new-${rowCounter}`
}

export default function TraceCaptureSettingsPage() {
  const t = useT()
  const [form, setForm] = React.useState<TraceCaptureSettingsForm | null>(null)
  const [baselineSignature, setBaselineSignature] = React.useState<string>('')
  const [source, setSource] = React.useState<'tenant' | 'default'>('default')
  const [deployment, setDeployment] = React.useState<Deployment | null>(null)
  const [updatedAt, setUpdatedAt] = React.useState<string | null>(null)
  const [agentOptions, setAgentOptions] = React.useState<AgentOption[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [isSaving, setIsSaving] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [showErrors, setShowErrors] = React.useState(false)
  const { runMutation, retryLastMutation } = useGuardedMutation<{ retryLastMutation: () => Promise<boolean> }>({
    contextId: CONTEXT_ID,
  })

  const { payload: chromePayload } = useBackendChrome()
  const granted = chromePayload?.grantedFeatures
  const canManage =
    hasFeature(granted, 'agent_orchestrator.agents.manage') &&
    hasFeature(granted, 'agent_orchestrator.trace.view_content')

  const applyResponse = React.useCallback((value: unknown): boolean => {
    const parsed = parseTraceCaptureSettingsResponse(value)
    if (!parsed) return false
    const nextForm = policyToForm(parsed.policy)
    setForm(nextForm)
    setBaselineSignature(formSignature(nextForm))
    setSource(parsed.source)
    setDeployment({ deploymentDefault: parsed.deploymentDefault, deploymentCeiling: parsed.deploymentCeiling })
    setUpdatedAt(parsed.updatedAt)
    setShowErrors(false)
    return true
  }, [])

  const load = React.useCallback(async () => {
    setIsLoading(true)
    const loadErrorLabel = t(
      'agent_orchestrator.settings.traceCapture.loadError',
      'Could not load the trace capture policy.',
    )
    try {
      const [settingsCall, agentsCall] = await Promise.all([
        apiCall<unknown>(SETTINGS_URL),
        apiCall<unknown>(AGENTS_URL).catch(() => null),
      ])
      if (!settingsCall.ok || !applyResponse(settingsCall.result)) {
        setLoadError(loadErrorLabel)
        return
      }
      setAgentOptions(agentsCall && agentsCall.ok ? parseAgentOptions(agentsCall.result) : [])
      setLoadError(null)
    } catch {
      setLoadError(loadErrorLabel)
    } finally {
      setIsLoading(false)
    }
  }, [applyResponse, t])

  React.useEffect(() => {
    void load()
  }, [load])

  const errors: TraceCaptureFormErrors = React.useMemo(
    () => (form ? validateTraceCaptureForm(form) : { overrides: {} }),
    [form],
  )

  const save = React.useCallback(async () => {
    if (!form) return
    const result = formToPolicy(form)
    if (!result.ok) {
      setShowErrors(true)
      return
    }
    setIsSaving(true)
    try {
      const response = await runMutation({
        context: { retryLastMutation },
        mutationPayload: result.policy,
        operation: () =>
          withScopedApiRequestHeaders(buildOptimisticLockHeader(updatedAt), () =>
            readApiResultOrThrow<unknown>(SETTINGS_URL, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(result.policy),
            }),
          ),
      })
      if (!applyResponse(response)) {
        await load()
      }
      flash(t('agent_orchestrator.settings.traceCapture.saved', 'Saved.'), 'success')
    } catch (error) {
      if (!surfaceRecordConflict(error, t, { onRefresh: () => void load() })) {
        flash(
          t('agent_orchestrator.settings.traceCapture.saveError', 'Could not save the trace capture policy.'),
          'error',
        )
      }
    } finally {
      setIsSaving(false)
    }
  }, [applyResponse, form, load, retryLastMutation, runMutation, t, updatedAt])

  if (isLoading && !form) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage
            label={t('agent_orchestrator.settings.traceCapture.loading', 'Loading the trace capture policy…')}
          />
        </PageBody>
      </Page>
    )
  }
  if (loadError) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={loadError} />
        </PageBody>
      </Page>
    )
  }
  if (!form || !deployment) return null

  const isDirty = formSignature(form) !== baselineSignature
  const update = (patch: Partial<TraceCaptureSettingsForm>) => setForm({ ...form, ...patch })
  const updateRow = (key: string, patch: Partial<TraceCaptureOverrideRow>) =>
    update({ overrides: form.overrides.map((row) => (row.key === key ? { ...row, ...patch } : row)) })
  const removeRow = (key: string) => update({ overrides: form.overrides.filter((row) => row.key !== key) })
  const addRow = () =>
    update({
      overrides: [...form.overrides, { key: nextRowKey(), agentId: '', level: 'metadata', until: null }],
    })
  const options = withMissingAgentOptions(
    agentOptions,
    form.overrides.map((row) => row.agentId),
  )
  const now = new Date()
  const overrideErrorLabel = (code: string): string =>
    code === 'agentDuplicate'
      ? t('agent_orchestrator.settings.traceCapture.errors.agentDuplicate', 'This agent already has an override.')
      : t('agent_orchestrator.settings.traceCapture.errors.agentRequired', 'Choose an agent.')

  return (
    <Page>
      <PageHeader
        title={t('agent_orchestrator.settings.traceCapture.title', 'Trace capture')}
        description={t(
          'agent_orchestrator.settings.traceCapture.description',
          'How much of each model call agent runs record in their traces, and for how long.',
        )}
        actions={
          isDirty ? (
            <StatusBadge variant="warning" dot>
              {t('agent_orchestrator.settings.traceCapture.unsaved', 'Unsaved changes')}
            </StatusBadge>
          ) : source === 'tenant' ? (
            <StatusBadge variant="info" dot>
              {t('agent_orchestrator.settings.traceCapture.sourceTenant', 'Saved for this tenant')}
            </StatusBadge>
          ) : (
            <StatusBadge variant="neutral" dot>
              {t('agent_orchestrator.settings.traceCapture.sourceDefault', 'Inherited default')}
            </StatusBadge>
          )
        }
      />

      <PageBody>
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t('agent_orchestrator.settings.traceCapture.deployment', 'Deployment limits')}</CardTitle>
              <CardDescription>
                {t(
                  'agent_orchestrator.settings.traceCapture.deploymentHint',
                  'Set by the operator of this installation. The default applies when no tenant policy is saved; nothing records more than the ceiling.',
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-6 text-sm">
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">
                  {t('agent_orchestrator.settings.traceCapture.deploymentDefault', 'Default level')}
                </div>
                <StatusBadge variant="neutral">{levelLabel(t, deployment.deploymentDefault)}</StatusBadge>
              </div>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">
                  {t('agent_orchestrator.settings.traceCapture.deploymentCeiling', 'Ceiling')}
                </div>
                <StatusBadge variant="neutral">{levelLabel(t, deployment.deploymentCeiling)}</StatusBadge>
              </div>
            </CardContent>
          </Card>

          {formRequestsFullCapture(form) ? (
            <Alert status="information" style="light">
              <AlertTitle>
                {t('agent_orchestrator.settings.traceCapture.fullNoticeTitle', 'Content capture is not available yet')}
              </AlertTitle>
              <AlertDescription>
                {t(
                  'agent_orchestrator.settings.traceCapture.fullNotice',
                  'Recording prompts and responses arrives with a later release. Until then, runs set to full record metadata only.',
                )}
              </AlertDescription>
            </Alert>
          ) : null}

          {formExceedsCeiling(form, deployment.deploymentCeiling) ? (
            <Alert status="warning" style="light">
              <AlertDescription>
                {t(
                  'agent_orchestrator.settings.traceCapture.ceilingNotice',
                  'Some levels here are above the deployment ceiling. Runs record at the ceiling instead.',
                )}
              </AlertDescription>
            </Alert>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>{t('agent_orchestrator.settings.traceCapture.policy', 'Capture policy')}</CardTitle>
              <CardDescription>
                {t(
                  'agent_orchestrator.settings.traceCapture.policyHint',
                  'Metadata records models, parameters, token usage, cost and content hashes — never the prompts or responses themselves.',
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>{t('agent_orchestrator.settings.traceCapture.levelLabel', 'Capture level')}</Label>
                  <LevelSelect
                    value={form.level}
                    disabled={!canManage}
                    ariaLabel={t('agent_orchestrator.settings.traceCapture.levelLabel', 'Capture level')}
                    onChange={(next) => {
                      if (next !== INHERIT_EVAL_LEVEL) update({ level: next })
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('agent_orchestrator.settings.traceCapture.evalLevel', 'Level for eval runs')}</Label>
                  <LevelSelect
                    value={form.evalLevel}
                    includeInherit
                    disabled={!canManage}
                    ariaLabel={t('agent_orchestrator.settings.traceCapture.evalLevel', 'Level for eval runs')}
                    onChange={(next) => update({ evalLevel: next })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="trace-capture-retention">
                    {t('agent_orchestrator.settings.traceCapture.retentionDays', 'Retention (days)')}
                  </Label>
                  <Input
                    id="trace-capture-retention"
                    type="number"
                    inputMode="numeric"
                    min={RETENTION_DAYS_MIN}
                    max={RETENTION_DAYS_MAX}
                    value={form.retentionDays}
                    disabled={!canManage}
                    onChange={(event) => update({ retentionDays: event.target.value })}
                  />
                  {showErrors && errors.retentionDays ? (
                    <p className="text-xs text-status-error-text">
                      {t(
                        'agent_orchestrator.settings.traceCapture.errors.retentionInvalid',
                        'Enter a whole number of days between 1 and 3650.',
                      )}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Switch
                  checked={form.redactPii}
                  disabled={!canManage}
                  onCheckedChange={(next) => update({ redactPii: next })}
                />
                <div className="min-w-0">
                  <Label>{t('agent_orchestrator.settings.traceCapture.redactPii', 'Redact personal data')}</Label>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t(
                      'agent_orchestrator.settings.traceCapture.redactPiiHint',
                      'Masks email addresses and secrets in captured content before it is stored.',
                    )}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Switch checked={form.includeProviderBody} disabled />
                <div className="min-w-0">
                  <Label>
                    {t('agent_orchestrator.settings.traceCapture.includeProviderBody', 'Include raw provider bodies')}
                  </Label>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t(
                      'agent_orchestrator.settings.traceCapture.includeProviderBodyHint',
                      'Not available yet: arrives together with content capture.',
                    )}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('agent_orchestrator.settings.traceCapture.overrides', 'Per-agent overrides')}</CardTitle>
              <CardDescription>
                {t(
                  'agent_orchestrator.settings.traceCapture.overridesHint',
                  'Raise or lower capture for one agent, optionally until a date — useful while debugging it. An expired override is ignored.',
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {form.overrides.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t('agent_orchestrator.settings.traceCapture.overridesEmpty', 'No overrides. Every agent uses the levels above.')}
                </p>
              ) : null}
              {form.overrides.map((row) => {
                const rowError = errors.overrides[row.key]
                const takenElsewhere = new Set(
                  form.overrides.filter((other) => other.key !== row.key).map((other) => other.agentId),
                )
                return (
                  <div key={row.key} className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="min-w-48 flex-1">
                        <Select
                          value={row.agentId || undefined}
                          disabled={!canManage}
                          onValueChange={(next) => updateRow(row.key, { agentId: next })}
                        >
                          <SelectTrigger aria-label={t('agent_orchestrator.settings.traceCapture.agent', 'Agent')}>
                            <SelectValue
                              placeholder={t('agent_orchestrator.settings.traceCapture.agentPlaceholder', 'Choose an agent')}
                            />
                          </SelectTrigger>
                          <SelectContent>
                            {options
                              .filter((option) => option.id === row.agentId || !takenElsewhere.has(option.id))
                              .map((option) => (
                                <SelectItem key={option.id} value={option.id}>
                                  {option.label}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="w-40">
                        <LevelSelect
                          value={row.level}
                          disabled={!canManage}
                          ariaLabel={t('agent_orchestrator.settings.traceCapture.levelLabel', 'Capture level')}
                          onChange={(next) => {
                            if (next !== INHERIT_EVAL_LEVEL) updateRow(row.key, { level: next })
                          }}
                        />
                      </div>
                      <div className="w-56">
                        <DateTimePicker
                          value={row.until}
                          disabled={!canManage}
                          placeholder={t('agent_orchestrator.settings.traceCapture.untilPlaceholder', 'No end date')}
                          aria-label={t('agent_orchestrator.settings.traceCapture.until', 'Until')}
                          onChange={(next) => updateRow(row.key, { until: next })}
                        />
                      </div>
                      {isOverrideExpired(row, now) ? (
                        <StatusBadge variant="neutral">
                          {t('agent_orchestrator.settings.traceCapture.expired', 'Expired')}
                        </StatusBadge>
                      ) : null}
                      {canManage ? (
                        <IconButton
                          variant="ghost"
                          aria-label={t('agent_orchestrator.settings.traceCapture.removeOverride', 'Remove override')}
                          onClick={() => removeRow(row.key)}
                        >
                          <Trash2 className="size-4" />
                        </IconButton>
                      ) : null}
                    </div>
                    {showErrors && rowError ? (
                      <p className="text-xs text-status-error-text">{overrideErrorLabel(rowError)}</p>
                    ) : null}
                  </div>
                )
              })}
              {canManage ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={addRow}
                  disabled={form.overrides.length >= TRACE_CAPTURE_PER_AGENT_MAX}
                >
                  <Plus className="mr-2 size-4" />
                  {t('agent_orchestrator.settings.traceCapture.addOverride', 'Add override')}
                </Button>
              ) : null}
            </CardContent>
          </Card>

          {canManage ? (
            <div className="flex justify-end">
              <Button type="button" onClick={() => void save()} disabled={!isDirty || isSaving}>
                {isSaving ? <Spinner className="mr-2 size-4" /> : null}
                {t('agent_orchestrator.settings.traceCapture.save', 'Save')}
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t(
                'agent_orchestrator.settings.traceCapture.readOnly',
                'You can see this policy but not change it. Changing it needs agent management and trace content access.',
              )}
            </p>
          )}
        </div>
      </PageBody>
    </Page>
  )
}
