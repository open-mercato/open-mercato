"use client"

/**
 * The tenant's OTel export settings: whether its agent runs are sent to the
 * deployment's OpenTelemetry backend, whether user ids travel with them, and
 * which agents are exported. The deployment configuration is shown read-only
 * as booleans and the protocol only — never the endpoint, headers or trace
 * link template. "Send test span" checks the endpoint and records the outcome
 * as the export health shown below it.
 *
 * Saves are optimistic-locked on the config row's `updatedAt` returned by GET.
 */

import * as React from 'react'
import { Send, Trash2 } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Label } from '@open-mercato/ui/primitives/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { apiCall, readApiResultOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { hasFeature } from '@open-mercato/shared/security/features'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { formatDateTime } from '../../../components/types'
import {
  parseAgentOptions,
  withMissingAgentOptions,
  type AgentOption,
} from '../../../lib/trace/captureSettingsForm'
import {
  addAllowlistAgent,
  canAddAllowlistAgent,
  formSignature,
  formToSettings,
  parseOtelExportSettingsResponse,
  parseOtelExportTestResponse,
  removeAllowlistAgent,
  settingsToForm,
  type OtelExportDeploymentView,
  type OtelExportHealthView,
  type OtelExportSettingsForm,
} from '../../../lib/trace/otel/exportSettingsForm'

const SETTINGS_URL = '/api/agent_orchestrator/otel-export/settings'
const TEST_URL = '/api/agent_orchestrator/otel-export/test'
const AGENTS_URL = '/api/agent_orchestrator/agents'
const CONTEXT_ID = 'agent_orchestrator.otel_export.settings'

type TestOutcome =
  | { kind: 'ok'; httpStatus: number | null; latencyMs: number }
  | { kind: 'failed'; errorCode: string }
  | { kind: 'disabled' }
  | { kind: 'rateLimited' }
  | { kind: 'error' }

function FactBadge({ label, value, variant }: { label: string; value: string; variant: StatusBadgeVariant }) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <StatusBadge variant={variant}>{value}</StatusBadge>
    </div>
  )
}

export default function OtelExportSettingsPage() {
  const t = useT()
  const locale = useLocale()
  const [form, setForm] = React.useState<OtelExportSettingsForm | null>(null)
  const [baselineSignature, setBaselineSignature] = React.useState<string>('')
  const [source, setSource] = React.useState<'tenant' | 'default'>('default')
  const [deployment, setDeployment] = React.useState<OtelExportDeploymentView | null>(null)
  const [health, setHealth] = React.useState<OtelExportHealthView | null>(null)
  const [updatedAt, setUpdatedAt] = React.useState<string | null>(null)
  const [agentOptions, setAgentOptions] = React.useState<AgentOption[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [isSaving, setIsSaving] = React.useState(false)
  const [isTesting, setIsTesting] = React.useState(false)
  const [testOutcome, setTestOutcome] = React.useState<TestOutcome | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const { runMutation, retryLastMutation } = useGuardedMutation<{ retryLastMutation: () => Promise<boolean> }>({
    contextId: CONTEXT_ID,
  })

  const { payload: chromePayload } = useBackendChrome()
  const canManage = hasFeature(chromePayload?.grantedFeatures, 'agent_orchestrator.agents.manage')

  const applyResponse = React.useCallback((value: unknown): boolean => {
    const parsed = parseOtelExportSettingsResponse(value)
    if (!parsed) return false
    const nextForm = settingsToForm(parsed.settings)
    setForm(nextForm)
    setBaselineSignature(formSignature(nextForm))
    setSource(parsed.source)
    setDeployment(parsed.deployment)
    setHealth(parsed.health)
    setUpdatedAt(parsed.updatedAt)
    return true
  }, [])

  const load = React.useCallback(async () => {
    setIsLoading(true)
    const loadErrorLabel = t(
      'agent_orchestrator.settings.otelExport.loadError',
      'Could not load the OTel export settings.',
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

  const refreshHealth = React.useCallback(async () => {
    try {
      const call = await apiCall<unknown>(SETTINGS_URL)
      const parsed = call.ok ? parseOtelExportSettingsResponse(call.result) : null
      if (parsed) setHealth(parsed.health)
    } catch {
      return
    }
  }, [])

  const save = React.useCallback(async () => {
    if (!form) return
    const result = formToSettings(form)
    if (!result.ok) {
      flash(t('agent_orchestrator.settings.otelExport.saveError', 'Could not save the OTel export settings.'), 'error')
      return
    }
    setIsSaving(true)
    try {
      const response = await runMutation({
        context: { retryLastMutation },
        mutationPayload: result.settings,
        operation: () =>
          withScopedApiRequestHeaders(buildOptimisticLockHeader(updatedAt), () =>
            readApiResultOrThrow<unknown>(SETTINGS_URL, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(result.settings),
            }),
          ),
      })
      if (!applyResponse(response)) {
        await load()
      }
      flash(t('agent_orchestrator.settings.otelExport.saved', 'Saved.'), 'success')
    } catch (error) {
      if (!surfaceRecordConflict(error, t, { onRefresh: () => void load() })) {
        flash(t('agent_orchestrator.settings.otelExport.saveError', 'Could not save the OTel export settings.'), 'error')
      }
    } finally {
      setIsSaving(false)
    }
  }, [applyResponse, form, load, retryLastMutation, runMutation, t, updatedAt])

  const sendTestSpan = React.useCallback(async () => {
    setIsTesting(true)
    setTestOutcome(null)
    try {
      const call = await runMutation({
        context: { retryLastMutation },
        mutationPayload: {},
        operation: () => apiCall<unknown>(TEST_URL, { method: 'POST' }),
      })
      if (call.status === 409) {
        setTestOutcome({ kind: 'disabled' })
      } else if (call.status === 429) {
        setTestOutcome({ kind: 'rateLimited' })
      } else {
        const parsed = call.ok ? parseOtelExportTestResponse(call.result) : null
        if (!parsed) setTestOutcome({ kind: 'error' })
        else if (parsed.ok) setTestOutcome({ kind: 'ok', httpStatus: parsed.httpStatus, latencyMs: parsed.latencyMs })
        else setTestOutcome({ kind: 'failed', errorCode: parsed.errorCode ?? 'unknown' })
      }
    } catch {
      setTestOutcome({ kind: 'error' })
    } finally {
      setIsTesting(false)
      await refreshHealth()
    }
  }, [refreshHealth, retryLastMutation, runMutation])

  if (isLoading && !form) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage
            label={t('agent_orchestrator.settings.otelExport.loading', 'Loading the OTel export settings…')}
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
  if (!form || !deployment || !health) return null

  const isDirty = formSignature(form) !== baselineSignature
  const update = (patch: Partial<OtelExportSettingsForm>) => setForm({ ...form, ...patch })
  const options = withMissingAgentOptions(agentOptions, form.agentAllowlist)
  const optionLabel = new Map(options.map((option) => [option.id, option.label]))
  const selectableAgents = options.filter((option) => !form.agentAllowlist.includes(option.id))
  const lastSuccess = formatDateTime(health.lastSuccessAt, locale)
  const lastError = formatDateTime(health.lastErrorAt, locale)
  const neverLabel = t('agent_orchestrator.settings.otelExport.health.never', 'Never')

  return (
    <Page>
      <PageHeader
        title={t('agent_orchestrator.settings.otelExport.title', 'OTel export')}
        description={t(
          'agent_orchestrator.settings.otelExport.description',
          'Send agent run traces to the OpenTelemetry backend configured for this installation.',
        )}
        actions={
          isDirty ? (
            <StatusBadge variant="warning" dot>
              {t('agent_orchestrator.settings.otelExport.unsaved', 'Unsaved changes')}
            </StatusBadge>
          ) : source === 'tenant' ? (
            <StatusBadge variant="info" dot>
              {t('agent_orchestrator.settings.otelExport.sourceTenant', 'Saved for this tenant')}
            </StatusBadge>
          ) : (
            <StatusBadge variant="neutral" dot>
              {t('agent_orchestrator.settings.otelExport.sourceDefault', 'Inherited default')}
            </StatusBadge>
          )
        }
      />

      <PageBody>
        <div className="space-y-4">
          {!deployment.switchOn ? (
            <Alert status="information" style="light">
              <AlertTitle>
                {t('agent_orchestrator.settings.otelExport.deploymentOffTitle', 'Export is off for this installation')}
              </AlertTitle>
              <AlertDescription>
                {t(
                  'agent_orchestrator.settings.otelExport.deploymentOff',
                  'Settings saved here take effect once the operator turns OTel export on.',
                )}
              </AlertDescription>
            </Alert>
          ) : !deployment.enabled ? (
            <Alert status="warning" style="light">
              <AlertTitle>
                {t('agent_orchestrator.settings.otelExport.deploymentBrokenTitle', 'Export is switched on but cannot run')}
              </AlertTitle>
              <AlertDescription>
                {t(
                  'agent_orchestrator.settings.otelExport.deploymentBroken',
                  'The operator needs to configure an endpoint and a supported protocol before any trace is sent.',
                )}
              </AlertDescription>
            </Alert>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>{t('agent_orchestrator.settings.otelExport.deployment', 'Deployment configuration')}</CardTitle>
              <CardDescription>
                {t(
                  'agent_orchestrator.settings.otelExport.deploymentHint',
                  'Set by the operator of this installation. The endpoint and its credentials are never shown here.',
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-6 text-sm">
              <FactBadge
                label={t('agent_orchestrator.settings.otelExport.deploymentEnabled', 'Export')}
                value={
                  deployment.enabled
                    ? t('agent_orchestrator.settings.otelExport.on', 'On')
                    : t('agent_orchestrator.settings.otelExport.off', 'Off')
                }
                variant={deployment.enabled ? 'success' : 'neutral'}
              />
              <FactBadge
                label={t('agent_orchestrator.settings.otelExport.endpoint', 'Endpoint')}
                value={
                  deployment.endpointConfigured
                    ? t('agent_orchestrator.settings.otelExport.configured', 'Configured')
                    : t('agent_orchestrator.settings.otelExport.notConfigured', 'Not configured')
                }
                variant={deployment.endpointConfigured ? 'success' : 'neutral'}
              />
              <FactBadge
                label={t('agent_orchestrator.settings.otelExport.protocol', 'Protocol')}
                value={
                  deployment.protocolSupported
                    ? deployment.protocol
                    : t('agent_orchestrator.settings.otelExport.protocolUnsupported', '{protocol} (unsupported)', {
                        protocol: deployment.protocol,
                      })
                }
                variant={deployment.protocolSupported ? 'neutral' : 'warning'}
              />
              <FactBadge
                label={t('agent_orchestrator.settings.otelExport.contentAllowed', 'Content export')}
                value={
                  deployment.contentAllowed
                    ? t('agent_orchestrator.settings.otelExport.allowed', 'Allowed')
                    : t('agent_orchestrator.settings.otelExport.denied', 'Denied')
                }
                variant="neutral"
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('agent_orchestrator.settings.otelExport.settings', 'Tenant settings')}</CardTitle>
              <CardDescription>
                {t(
                  'agent_orchestrator.settings.otelExport.settingsHint',
                  'Exported traces carry models, timings, token usage, cost and outcomes — never prompts or responses.',
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-start gap-3">
                <Switch
                  id="otel-export-enabled"
                  checked={form.enabled}
                  disabled={!canManage}
                  onCheckedChange={(next) => update({ enabled: next })}
                />
                <div className="min-w-0">
                  <Label htmlFor="otel-export-enabled">
                    {t('agent_orchestrator.settings.otelExport.enabled', 'Export this tenant’s agent runs')}
                  </Label>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t(
                      'agent_orchestrator.settings.otelExport.enabledHint',
                      'Each finished run is sent shortly after it completes.',
                    )}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Switch
                  id="otel-export-user-ids"
                  checked={form.exportUserIds}
                  disabled={!canManage}
                  onCheckedChange={(next) => update({ exportUserIds: next })}
                />
                <div className="min-w-0">
                  <Label htmlFor="otel-export-user-ids">
                    {t('agent_orchestrator.settings.otelExport.exportUserIds', 'Include user ids')}
                  </Label>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t(
                      'agent_orchestrator.settings.otelExport.exportUserIdsHint',
                      'Adds the id of the user who started a run. Names and emails are never exported.',
                    )}
                  </p>
                </div>
              </div>

              <div className="space-y-1.5 sm:max-w-sm">
                <Label>{t('agent_orchestrator.settings.otelExport.content', 'Content')}</Label>
                <Select value={form.content} disabled>
                  <SelectTrigger aria-label={t('agent_orchestrator.settings.otelExport.content', 'Content')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">
                      {t('agent_orchestrator.settings.otelExport.contentNone', 'Metadata only')}
                    </SelectItem>
                    <SelectItem value="full">
                      {t('agent_orchestrator.settings.otelExport.contentFull', 'Metadata and content')}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {t(
                    'agent_orchestrator.settings.otelExport.contentHint',
                    'Exporting prompts and responses arrives with a later release.',
                  )}
                </p>
              </div>

              <div className="space-y-3">
                <div>
                  <Label>{t('agent_orchestrator.settings.otelExport.agents', 'Exported agents')}</Label>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t(
                      'agent_orchestrator.settings.otelExport.agentsHint',
                      'Limit export to the agents listed here. With no agent listed, every agent is exported.',
                    )}
                  </p>
                </div>
                {form.agentAllowlist.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t('agent_orchestrator.settings.otelExport.agentsAll', 'All agents are exported.')}
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {form.agentAllowlist.map((agentId) => (
                      <li key={agentId} className="flex items-center gap-2 text-sm">
                        <span className="min-w-0 flex-1 truncate">{optionLabel.get(agentId) ?? agentId}</span>
                        {canManage ? (
                          <IconButton
                            variant="ghost"
                            size="sm"
                            aria-label={t('agent_orchestrator.settings.otelExport.removeAgent', 'Remove agent')}
                            onClick={() => setForm(removeAllowlistAgent(form, agentId))}
                          >
                            <Trash2 className="size-4" />
                          </IconButton>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
                {canManage ? (
                  <div className="sm:max-w-sm">
                    <Select
                      value=""
                      disabled={selectableAgents.length === 0 || !canAddAllowlistAgent(form)}
                      onValueChange={(next) => setForm(addAllowlistAgent(form, next))}
                    >
                      <SelectTrigger aria-label={t('agent_orchestrator.settings.otelExport.addAgent', 'Add an agent')}>
                        <SelectValue placeholder={t('agent_orchestrator.settings.otelExport.addAgent', 'Add an agent')} />
                      </SelectTrigger>
                      <SelectContent>
                        {selectableAgents.map((option) => (
                          <SelectItem key={option.id} value={option.id}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('agent_orchestrator.settings.otelExport.health.title', 'Export health')}</CardTitle>
              <CardDescription>
                {t(
                  'agent_orchestrator.settings.otelExport.health.hint',
                  'The last time a trace or a test span reached the backend, and the last time one failed.',
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-6 text-sm">
                <FactBadge
                  label={t('agent_orchestrator.settings.otelExport.health.lastSuccess', 'Last success')}
                  value={lastSuccess ?? neverLabel}
                  variant={lastSuccess ? 'success' : 'neutral'}
                />
                <FactBadge
                  label={t('agent_orchestrator.settings.otelExport.health.lastError', 'Last error')}
                  value={
                    lastError
                      ? health.lastErrorCode
                        ? `${lastError} · ${health.lastErrorCode}`
                        : lastError
                      : neverLabel
                  }
                  variant={lastError ? 'error' : 'neutral'}
                />
              </div>

              {canManage ? (
                <div className="space-y-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void sendTestSpan()}
                    disabled={isTesting || !deployment.enabled}
                  >
                    {isTesting ? <Spinner className="mr-2 size-4" /> : <Send className="mr-2 size-4" />}
                    {t('agent_orchestrator.settings.otelExport.test.send', 'Send test span')}
                  </Button>
                  {testOutcome ? (
                    <p
                      role="status"
                      className={
                        testOutcome.kind === 'ok' ? 'text-sm text-status-success-text' : 'text-sm text-status-error-text'
                      }
                    >
                      {testOutcome.kind === 'ok'
                        ? t(
                            'agent_orchestrator.settings.otelExport.test.ok',
                            'The backend accepted the test span (HTTP {status}, {latency} ms).',
                            { status: String(testOutcome.httpStatus ?? '—'), latency: String(testOutcome.latencyMs) },
                          )
                        : testOutcome.kind === 'failed'
                          ? t(
                              'agent_orchestrator.settings.otelExport.test.failed',
                              'The backend did not accept the test span: {code}.',
                              { code: testOutcome.errorCode },
                            )
                          : testOutcome.kind === 'disabled'
                            ? t(
                                'agent_orchestrator.settings.otelExport.test.disabled',
                                'OTel export is not enabled for this installation.',
                              )
                            : testOutcome.kind === 'rateLimited'
                              ? t(
                                  'agent_orchestrator.settings.otelExport.test.rateLimited',
                                  'Wait a few seconds before sending another test span.',
                                )
                              : t('agent_orchestrator.settings.otelExport.test.error', 'Could not send the test span.')}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>

          {canManage ? (
            <div className="flex justify-end">
              <Button type="button" onClick={() => void save()} disabled={!isDirty || isSaving}>
                {isSaving ? <Spinner className="mr-2 size-4" /> : null}
                {t('agent_orchestrator.settings.otelExport.save', 'Save')}
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t(
                'agent_orchestrator.settings.otelExport.readOnly',
                'You can see these settings but not change them. Changing them needs agent management access.',
              )}
            </p>
          )}
        </div>
      </PageBody>
    </Page>
  )
}
