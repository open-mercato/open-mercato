"use client"
import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { z } from 'zod'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { WebhookSetupGuide } from '@open-mercato/ui/backend/WebhookSetupGuide'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { Card, CardHeader, CardTitle, CardContent } from '@open-mercato/ui/primitives/card'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Input } from '@open-mercato/ui/primitives/input'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'
import { JsonDisplay } from '@open-mercato/ui/backend/JsonDisplay'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { CredentialFieldType, IntegrationCredentialField } from '@open-mercato/shared/modules/integrations/types'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { Bell, ChevronDown, ChevronRight, CreditCard, HardDrive, MessageSquare, RefreshCw, Truck, Webhook, Zap } from 'lucide-react'

type CredentialField = IntegrationCredentialField
type IntegrationDetailTab = 'credentials' | 'version' | 'health' | 'logs'

const UNSUPPORTED_CREDENTIAL_FIELD_TYPES = new Set<CredentialFieldType>(['oauth', 'ssh_keypair'])

function isEditableCredentialField(field: CredentialField): boolean {
  return !UNSUPPORTED_CREDENTIAL_FIELD_TYPES.has(field.type)
}

type ApiVersion = {
  id: string
  label?: string
  status: 'stable' | 'deprecated' | 'experimental'
  sunsetAt?: string
  migrationGuide?: string
}

type IntegrationDetail = {
  integration: {
    id: string
    title: string
    description?: string
    category?: string
    hub?: string
    bundleId?: string
    docsUrl?: string
    apiVersions?: ApiVersion[]
    credentials?: { fields: CredentialField[] }
  }
  bundle?: { id: string; title: string; credentials?: { fields: CredentialField[] } }
  state: {
    isEnabled: boolean
    apiVersion: string | null
    reauthRequired: boolean
    lastHealthStatus: string | null
    lastHealthCheckedAt: string | null
  }
  hasCredentials: boolean
}

type LogEntry = {
  id: string
  runId?: string | null
  scopeEntityType?: string | null
  scopeEntityId?: string | null
  level: 'info' | 'warn' | 'error'
  message: string
  createdAt: string
  code?: string | null
  payload?: Record<string, unknown> | null
}

type IntegrationDetailPageProps = {
  params?: {
    id?: string | string[]
  }
}

type HealthCheckResponse = {
  status: 'healthy' | 'degraded' | 'unhealthy'
  message: string | null
  details: Record<string, unknown> | null
  checkedAt: string
}

const LOG_LEVEL_STYLES: Record<string, string> = {
  info: 'bg-blue-100 text-blue-800',
  warn: 'bg-yellow-100 text-yellow-800',
  error: 'bg-red-100 text-red-800',
}

const HEALTH_STATUS_STYLES: Record<string, string> = {
  healthy: 'bg-green-100 text-green-800',
  degraded: 'bg-yellow-100 text-yellow-800',
  unhealthy: 'bg-red-100 text-red-800',
}

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  payment: CreditCard,
  shipping: Truck,
  data_sync: RefreshCw,
  communication: MessageSquare,
  notification: Bell,
  storage: HardDrive,
  webhook: Webhook,
}

function resolveRouteId(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

function resolvePathnameId(pathname: string): string | undefined {
  const parts = pathname.split('/').filter(Boolean)
  const integrationId = parts.at(-1)
  if (!integrationId || integrationId === 'integrations' || integrationId === 'bundle') return undefined
  return decodeURIComponent(integrationId)
}

function resolveRequestedTab(value: string | null | undefined, hasVersions: boolean): IntegrationDetailTab {
  if (value === 'health' || value === 'logs') return value
  if (value === 'version' && hasVersions) return 'version'
  return 'credentials'
}

function buildCredentialFields(credFields: CredentialField[]): CrudField[] {
  return credFields.map((field) => {
    const shared = {
      id: field.key,
      label: field.label,
      description: field.helpDetails ? (
        <div className="space-y-1">
          {field.helpText ? <div>{field.helpText}</div> : null}
          <WebhookSetupGuide guide={field.helpDetails} buttonLabel="Show details" />
        </div>
      ) : field.helpText,
      placeholder: field.placeholder,
      required: field.required,
    }

    if (field.type === 'secret') {
      return {
        ...shared,
        type: 'custom' as const,
        component: ({ id, value, setValue, disabled }) => (
          <Input
            id={id}
            type="password"
            placeholder={field.placeholder}
            value={typeof value === 'string' ? value : ''}
            onChange={(event) => setValue(event.target.value)}
            disabled={disabled}
          />
        ),
      }
    }

    if (field.type === 'select' && field.options) {
      return {
        ...shared,
        type: 'select' as const,
        options: field.options,
      }
    }

    if (field.type === 'boolean') {
      return {
        ...shared,
        type: 'checkbox' as const,
      }
    }

    return {
      ...shared,
      type: 'text' as const,
    }
  })
}

function isHealthLog(log: LogEntry): boolean {
  return log.message === 'Health check passed' || log.message.startsWith('Health check:')
}

function extractHealthDetails(payload: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!payload) return {}
  return Object.fromEntries(
    Object.entries(payload).filter(([key, value]) => key !== 'status' && key !== 'message' && value !== undefined && value !== null),
  )
}

function formatHealthValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (value instanceof Date) return value.toLocaleString()
  return JSON.stringify(value)
}

function formatTypeLabel(value: string): string {
  return value.split('_').filter(Boolean).map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' ')
}

function isPrimitiveLogValue(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

function formatLogDetailLabel(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ')
}

function formatLogPrimitiveValue(value: string | number | boolean | null): string {
  if (value === null) return 'None'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}

function splitLogPayload(payload: Record<string, unknown> | null | undefined) {
  if (!payload) {
    return {
      inlineEntries: [] as Array<[string, string | number | boolean | null]>,
      nestedEntries: [] as Array<[string, unknown]>,
    }
  }

  const inlineEntries: Array<[string, string | number | boolean | null]> = []
  const nestedEntries: Array<[string, unknown]> = []

  Object.entries(payload).forEach(([key, value]) => {
    if (isPrimitiveLogValue(value)) {
      inlineEntries.push([key, value])
      return
    }
    nestedEntries.push([key, value])
  })

  return { inlineEntries, nestedEntries }
}

export default function IntegrationDetailPage({ params }: IntegrationDetailPageProps) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const integrationId = resolveRouteId(params?.id) ?? resolvePathnameId(pathname)
  const t = useT()

  const [detail, setDetail] = React.useState<IntegrationDetail | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const [credValues, setCredValues] = React.useState<Record<string, unknown>>({})
  const [credentialsFormKey, setCredentialsFormKey] = React.useState(0)
  const [isSavingCredentials, setIsSavingCredentials] = React.useState(false)

  const [logs, setLogs] = React.useState<LogEntry[]>([])
  const [logLevel, setLogLevel] = React.useState<string>('')
  const [isLoadingLogs, setIsLoadingLogs] = React.useState(false)
  const [expandedLogId, setExpandedLogId] = React.useState<string | null>(null)

  const [isCheckingHealth, setIsCheckingHealth] = React.useState(false)
  const [isTogglingState, setIsTogglingState] = React.useState(false)
  const [latestHealthResult, setLatestHealthResult] = React.useState<HealthCheckResponse | null>(null)
  const [activeTab, setActiveTab] = React.useState<IntegrationDetailTab>('credentials')

  const credentialsFormId = React.useId()

  const resolveCurrentIntegrationId = React.useCallback(() => {
    return integrationId ?? (
      typeof window !== 'undefined'
        ? resolvePathnameId(window.location.pathname)
        : undefined
    )
  }, [integrationId])

  const loadDetail = React.useCallback(async () => {
    const currentIntegrationId = resolveCurrentIntegrationId()
    if (!currentIntegrationId) {
      setIsLoading(false)
      setError(t('integrations.detail.loadError', 'Failed to load integration'))
      return
    }
    setError(null)
    setIsLoading(true)
    try {
      const call = await apiCall<IntegrationDetail>(
        `/api/integrations/${encodeURIComponent(currentIntegrationId)}`,
        undefined,
        { fallback: null },
      )
      if (!call.ok || !call.result) {
        setError(t('integrations.detail.loadError', 'Failed to load integration'))
        setIsLoading(false)
        return
      }
      setDetail(call.result)
      setIsLoading(false)
    } catch {
      setError(t('integrations.detail.loadError', 'Failed to load integration'))
      setIsLoading(false)
    }
  }, [resolveCurrentIntegrationId, t])

  const loadCredentials = React.useCallback(async () => {
    const currentIntegrationId = resolveCurrentIntegrationId()
    if (!currentIntegrationId) return
    const call = await apiCall<{ credentials: Record<string, unknown> }>(
      `/api/integrations/${encodeURIComponent(currentIntegrationId)}/credentials`,
      undefined,
      { fallback: null },
    )
    if (call.ok && call.result?.credentials) {
      setCredValues(call.result.credentials)
      setCredentialsFormKey((current) => current + 1)
    }
  }, [resolveCurrentIntegrationId])

  const loadLogs = React.useCallback(async () => {
    const currentIntegrationId = resolveCurrentIntegrationId()
    if (!currentIntegrationId) return
    setIsLoadingLogs(true)
    const params = new URLSearchParams({ integrationId: currentIntegrationId, pageSize: '50' })
    if (logLevel) params.set('level', logLevel)
    const call = await apiCall<{ items: LogEntry[] }>(
      `/api/integrations/logs?${params.toString()}`,
      undefined,
      { fallback: { items: [] } },
    )
    if (call.ok && call.result) {
      setLogs(call.result.items)
    }
    setIsLoadingLogs(false)
  }, [logLevel, resolveCurrentIntegrationId])

  React.useEffect(() => { void loadDetail() }, [loadDetail])
  React.useEffect(() => { void loadCredentials() }, [loadCredentials])
  React.useEffect(() => { void loadLogs() }, [loadLogs])
  React.useEffect(() => {
    setExpandedLogId((current) => (current && logs.some((log) => log.id === current) ? current : null))
  }, [logs])

  const handleToggleState = React.useCallback(async (enabled: boolean) => {
    const currentIntegrationId = resolveCurrentIntegrationId()
    if (!currentIntegrationId) return
    setIsTogglingState(true)
    const call = await apiCall(`/api/integrations/${encodeURIComponent(currentIntegrationId)}/state`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isEnabled: enabled }),
    }, { fallback: null })
    if (call.ok) {
      setDetail((prev) => prev ? { ...prev, state: { ...prev.state, isEnabled: enabled } } : prev)
      flash(t('integrations.detail.stateUpdated'), 'success')
    } else {
      flash(t('integrations.detail.stateError'), 'error')
    }
    setIsTogglingState(false)
  }, [resolveCurrentIntegrationId, t])

  const handleSaveCredentials = React.useCallback(async (values: Record<string, unknown>) => {
    const currentIntegrationId = resolveCurrentIntegrationId()
    if (!currentIntegrationId) return
    setIsSavingCredentials(true)
    try {
      const call = await apiCall(`/api/integrations/${encodeURIComponent(currentIntegrationId)}/credentials`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentials: values }),
      }, { fallback: null })

      if (call.ok) {
        setCredValues(values)
        setCredentialsFormKey((current) => current + 1)
        flash(t('integrations.detail.credentials.saved'), 'success')
        return
      }

      const result = call.result as {
        error?: string
        details?: { fieldErrors?: Record<string, string>; formErrors?: string[] }
      } | null
      throw createCrudFormError(
        result?.error ?? t('integrations.detail.credentials.saveError', 'Failed to save credentials'),
        result?.details?.fieldErrors,
        { details: result?.details },
      )
    } finally {
      setIsSavingCredentials(false)
    }
  }, [resolveCurrentIntegrationId, t])

  const handleVersionChange = React.useCallback(async (version: string) => {
    const currentIntegrationId = resolveCurrentIntegrationId()
    if (!currentIntegrationId) return
    const call = await apiCall(`/api/integrations/${encodeURIComponent(currentIntegrationId)}/version`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiVersion: version }),
    }, { fallback: null })
    if (call.ok) {
      setDetail((prev) => prev ? { ...prev, state: { ...prev.state, apiVersion: version } } : prev)
      flash(t('integrations.detail.version.saved'), 'success')
    } else {
      flash(t('integrations.detail.version.saveError'), 'error')
    }
  }, [resolveCurrentIntegrationId, t])

  const handleHealthCheck = React.useCallback(async () => {
    const currentIntegrationId = resolveCurrentIntegrationId()
    if (!currentIntegrationId) return
    setIsCheckingHealth(true)
    const call = await apiCall<HealthCheckResponse>(
      `/api/integrations/${encodeURIComponent(currentIntegrationId)}/health`,
      { method: 'POST' },
      { fallback: null },
    )
    if (call.ok && call.result) {
      setLatestHealthResult(call.result)
      setDetail((prev) => prev ? {
        ...prev,
        state: {
          ...prev.state,
          lastHealthStatus: call.result.status,
          lastHealthCheckedAt: call.result.checkedAt,
        },
      } : prev)
      void loadLogs()
    } else {
      flash(t('integrations.detail.health.checkError'), 'error')
    }
    setIsCheckingHealth(false)
  }, [loadLogs, resolveCurrentIntegrationId, t])

  const hasVersions = Boolean(detail?.integration.apiVersions?.length)
  const integration = detail?.integration ?? null
  const state = detail?.state ?? null
  const editableCredentialFields = React.useMemo(
    () => (detail?.integration.credentials?.fields ?? detail?.bundle?.credentials?.fields ?? []).filter(isEditableCredentialField),
    [detail?.bundle?.credentials?.fields, detail?.integration.credentials?.fields],
  )
  const credentialFormFields = React.useMemo(
    () => buildCredentialFields(editableCredentialFields),
    [editableCredentialFields],
  )
  const credentialSchema = React.useMemo(() => (
    z.object({}).passthrough().superRefine((rawValues, ctx) => {
      const values = rawValues as Record<string, unknown>

      editableCredentialFields.forEach((field) => {
        const value = values[field.key]

        if (field.type === 'boolean') {
          if (value !== undefined && value !== null && typeof value !== 'boolean') {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [field.key],
              message: t('integrations.detail.credentials.validation.boolean', 'Select a valid value.'),
            })
          }
          if (field.required && typeof value !== 'boolean') {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [field.key],
              message: t('integrations.detail.credentials.validation.required', '{field} is required.', { field: field.label }),
            })
          }
          return
        }

        if (value !== undefined && value !== null && typeof value !== 'string') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field.key],
            message: t('integrations.detail.credentials.validation.text', 'Enter a valid value.'),
          })
          return
        }

        const normalizedValue = typeof value === 'string' ? value : ''

        if (field.required && normalizedValue.trim().length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field.key],
            message: t('integrations.detail.credentials.validation.required', '{field} is required.', { field: field.label }),
          })
        }

        if (normalizedValue.length > 20_000) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field.key],
            message: t('integrations.detail.credentials.validation.tooLong', 'Value is too long.'),
          })
        }

        if (
          field.type === 'select'
          && normalizedValue
          && field.options
          && !field.options.some((option) => option.value === normalizedValue)
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field.key],
            message: t('integrations.detail.credentials.validation.option', 'Select one of the available options.'),
          })
        }
      })
    })
  ) as z.ZodType<Record<string, unknown>>, [editableCredentialFields, t])
  const latestHealthLog = React.useMemo(() => logs.find(isHealthLog) ?? null, [logs])
  const healthMessage =
    latestHealthResult?.message ??
    (typeof latestHealthLog?.payload?.message === 'string' ? latestHealthLog.payload.message : null)
  const healthDetailsSource = latestHealthResult?.details ?? extractHealthDetails(latestHealthLog?.payload)
  const healthDetails = latestHealthLog?.code
    ? { ...healthDetailsSource, code: latestHealthLog.code }
    : healthDetailsSource
  const healthDetailEntries = Object.entries(healthDetails)
  const healthStatusDescription = state?.lastHealthStatus
    ? t(
      `integrations.detail.health.meaning.${state.lastHealthStatus}`,
      state.lastHealthStatus === 'healthy'
        ? 'The provider responded successfully using the current credentials.'
        : state.lastHealthStatus === 'degraded'
          ? 'The provider responded, but reported warnings or limited functionality.'
          : integration?.id === 'gateway_stripe'
            ? 'Stripe rejected the last check. This usually means the secret key is invalid, missing required permissions, revoked, or Stripe was temporarily unavailable.'
            : 'The last check failed. This usually means invalid credentials, missing permissions, or a provider outage.',
    )
    : null

  React.useEffect(() => {
    setActiveTab(resolveRequestedTab(searchParams?.get('tab'), hasVersions))
  }, [hasVersions, searchParams])

  const handleTabChange = React.useCallback((nextValue: string) => {
    const currentIntegrationId = resolveCurrentIntegrationId()
    const nextTab = resolveRequestedTab(nextValue, hasVersions)
    setActiveTab(nextTab)
    if (!currentIntegrationId) return
    const basePath = `/backend/integrations/${encodeURIComponent(currentIntegrationId)}`
    router.replace(nextTab === 'credentials' ? basePath : `${basePath}?tab=${encodeURIComponent(nextTab)}`)
  }, [hasVersions, resolveCurrentIntegrationId, router])

  if (isLoading) return <Page><PageBody><LoadingMessage label={t('integrations.detail.title')} /></PageBody></Page>
  if (error || !detail) return <Page><PageBody><ErrorMessage label={error ?? t('integrations.detail.loadError')} /></PageBody></Page>

  const resolvedIntegration = detail.integration
  const resolvedState = detail.state
  const CategoryIcon = resolvedIntegration.category ? CATEGORY_ICONS[resolvedIntegration.category] : null

  const showCredentialActions = activeTab === 'credentials' && credentialFormFields.length > 0

  return (
    <Page>
      <PageBody className="space-y-6">
        <FormHeader
          backHref="/backend/integrations"
          title={resolvedIntegration.title}
          actions={{
            cancelHref: showCredentialActions ? '/backend/integrations' : undefined,
            submit: showCredentialActions
              ? {
                formId: credentialsFormId,
                pending: isSavingCredentials,
                label: t('integrations.detail.credentials.save', 'Save credentials'),
                pendingLabel: t('ui.forms.status.saving', 'Saving...'),
              }
              : undefined,
          }}
        />

        <div className="space-y-2">
          {resolvedIntegration.description ? (
            <p className="text-sm text-muted-foreground">{resolvedIntegration.description}</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            {resolvedIntegration.category ? (
              <div className="flex items-center gap-2">
                {CategoryIcon ? <CategoryIcon className="h-4 w-4" /> : null}
                <span>{formatTypeLabel(resolvedIntegration.category)}</span>
              </div>
            ) : null}
            {resolvedIntegration.hub ? (
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground/80">
                  {t('integrations.detail.hub.label', 'Hub')}
                </span>
                <span>{formatTypeLabel(resolvedIntegration.hub)}</span>
              </div>
            ) : null}
          </div>
        </div>

        <section className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {t('integrations.detail.state.label', 'State')}
              </p>
              <p className="text-sm font-medium">
                {resolvedState.isEnabled
                  ? t('integrations.detail.state.enabled', 'Enabled')
                  : t('integrations.detail.state.disabled', 'Disabled')}
              </p>
            </div>
            <Switch
              checked={resolvedState.isEnabled}
              disabled={isTogglingState}
              onCheckedChange={(checked) => void handleToggleState(checked)}
            />
          </div>
        </section>

        <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
          <TabsList>
            <TabsTrigger value="credentials">{t('integrations.detail.tabs.credentials')}</TabsTrigger>
            {hasVersions ? <TabsTrigger value="version">{t('integrations.detail.tabs.version')}</TabsTrigger> : null}
            <TabsTrigger value="health">{t('integrations.detail.tabs.health')}</TabsTrigger>
            <TabsTrigger value="logs">{t('integrations.detail.tabs.logs')}</TabsTrigger>
          </TabsList>

          <TabsContent value="credentials" className="mt-0">
            <section className="space-y-4 rounded-lg border bg-card p-6">
              {detail.bundle ? (
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
                  {t('integrations.detail.credentials.bundleShared', { bundle: detail.bundle.title })}
                </div>
              ) : null}
              {credentialFormFields.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t('integrations.detail.credentials.notConfigured')}
                </p>
              ) : (
                <CrudForm<Record<string, unknown>>
                  key={`${resolvedIntegration.id}:${credentialsFormKey}`}
                  formId={credentialsFormId}
                  entityId="integrations.integration"
                  schema={credentialSchema}
                  fields={credentialFormFields}
                  initialValues={credValues}
                  onSubmit={handleSaveCredentials}
                  embedded
                  hideFooterActions
                />
              )}
            </section>
          </TabsContent>

          {hasVersions ? (
            <TabsContent value="version" className="mt-0 space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>{t('integrations.detail.version.select')}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {resolvedIntegration.apiVersions?.map((version) => {
                    const stableVersion = resolvedIntegration.apiVersions?.find((item) => item.status === 'stable')?.id
                    const isSelected = (resolvedState.apiVersion ?? stableVersion) === version.id
                    return (
                      <div
                        key={version.id}
                        className={`flex cursor-pointer items-center justify-between rounded-lg border p-3 transition-colors ${isSelected ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}`}
                        onClick={() => void handleVersionChange(version.id)}
                      >
                        <div>
                          <span className="text-sm font-medium">{version.label ?? version.id}</span>
                          <Badge
                            variant={version.status === 'stable' ? 'default' : version.status === 'deprecated' ? 'destructive' : 'secondary'}
                            className="ml-2"
                          >
                            {t(`integrations.detail.version.${version.status}`)}
                          </Badge>
                          {version.status === 'deprecated' && version.sunsetAt ? (
                            <span className="ml-2 text-xs text-muted-foreground">
                              {t('integrations.detail.version.sunsetAt', { date: new Date(version.sunsetAt).toLocaleDateString() })}
                            </span>
                          ) : null}
                        </div>
                        {isSelected ? <Badge variant="outline">{t('integrations.detail.version.current')}</Badge> : null}
                      </div>
                    )
                  })}
                </CardContent>
              </Card>
            </TabsContent>
          ) : null}

          <TabsContent value="health" className="mt-0 space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>{t('integrations.detail.health.title')}</CardTitle>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleHealthCheck()}
                    disabled={isCheckingHealth}
                  >
                    {isCheckingHealth ? <Spinner className="mr-2 h-4 w-4" /> : <Zap className="mr-2 h-4 w-4" />}
                    {isCheckingHealth ? t('integrations.detail.health.checking') : t('integrations.detail.health.check')}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium">{t('integrations.detail.health.title')}:</span>
                  {resolvedState.lastHealthStatus ? (
                    <Badge className={HEALTH_STATUS_STYLES[resolvedState.lastHealthStatus] ?? ''}>
                      {t(`integrations.detail.health.${resolvedState.lastHealthStatus}`)}
                    </Badge>
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      {t('integrations.detail.health.unknown')}
                    </span>
                  )}
                </div>
                {healthStatusDescription ? (
                  <p className="text-sm text-muted-foreground">{healthStatusDescription}</p>
                ) : null}
                {healthMessage ? (
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {t('integrations.detail.health.lastResult', 'Last result')}
                    </p>
                    <p className="mt-1 text-sm">{healthMessage}</p>
                  </div>
                ) : null}
                {healthDetailEntries.length > 0 ? (
                  <div className="rounded-lg border p-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {t('integrations.detail.health.details', 'Details')}
                    </p>
                    <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                      {healthDetailEntries.map(([key, value]) => (
                        <div key={key}>
                          <dt className="text-xs font-medium text-muted-foreground">{key}</dt>
                          <dd className="mt-1 text-sm">{formatHealthValue(value)}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  {resolvedState.lastHealthCheckedAt
                    ? t('integrations.detail.health.lastChecked', { date: new Date(resolvedState.lastHealthCheckedAt).toLocaleString() })
                    : t('integrations.detail.health.neverChecked')
                  }
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="logs" className="mt-0 space-y-4">
            <div className="flex items-center gap-3">
              <select
                className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                value={logLevel}
                onChange={(event) => setLogLevel(event.target.value)}
              >
                <option value="">{t('integrations.detail.logs.level.all')}</option>
                <option value="info">{t('integrations.detail.logs.level.info')}</option>
                <option value="warn">{t('integrations.detail.logs.level.warn')}</option>
                <option value="error">{t('integrations.detail.logs.level.error')}</option>
              </select>
            </div>
            {isLoadingLogs ? (
              <div className="flex justify-center py-8"><Spinner /></div>
            ) : logs.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">{t('integrations.detail.logs.empty')}</p>
            ) : (
              <div className="rounded-lg border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="px-4 py-2 text-left font-medium">{t('integrations.detail.logs.columns.time')}</th>
                      <th className="px-4 py-2 text-left font-medium">{t('integrations.detail.logs.columns.level')}</th>
                      <th className="px-4 py-2 text-left font-medium">{t('integrations.detail.logs.columns.message')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => {
                      const isExpanded = expandedLogId === log.id
                      const metadataEntries = [
                        ['Time', new Date(log.createdAt).toLocaleString()],
                        ['Level', log.level],
                        ['Code', log.code ?? null],
                        ['Run ID', log.runId ?? null],
                        ['Entity Type', log.scopeEntityType ?? null],
                        ['Entity ID', log.scopeEntityId ?? null],
                      ].filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim().length > 0)
                      const { inlineEntries, nestedEntries } = splitLogPayload(log.payload)

                      return (
                        <React.Fragment key={log.id}>
                          <tr className="border-b last:border-0">
                            <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">
                              {new Date(log.createdAt).toLocaleString()}
                            </td>
                            <td className="px-4 py-2">
                              <Badge variant="secondary" className={LOG_LEVEL_STYLES[log.level] ?? ''}>
                                {log.level}
                              </Badge>
                            </td>
                            <td className="px-4 py-2">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-auto w-full justify-start gap-2 px-0 py-0 text-left hover:bg-transparent"
                                onClick={() => setExpandedLogId((current) => (current === log.id ? null : log.id))}
                              >
                                {isExpanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                                <span className="truncate">{log.message}</span>
                              </Button>
                            </td>
                          </tr>
                          {isExpanded ? (
                            <tr className="border-b bg-muted/20 last:border-0">
                              <td colSpan={3} className="px-4 py-4">
                                <div className="space-y-4 rounded-lg border bg-card p-4">
                                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                                    <div className="space-y-4">
                                      <section className="space-y-3">
                                        <div>
                                          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                            {t('integrations.detail.logs.details.summary', 'Summary')}
                                          </p>
                                          <p className="mt-1 text-sm font-medium">{log.message}</p>
                                        </div>
                                        {metadataEntries.length > 0 ? (
                                          <dl className="grid gap-3 sm:grid-cols-2">
                                            {metadataEntries.map(([label, value]) => (
                                              <div key={label} className="rounded-md border bg-muted/30 px-3 py-2">
                                                <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                                  {label}
                                                </dt>
                                                <dd className="mt-1 break-all text-sm">{value}</dd>
                                              </div>
                                            ))}
                                          </dl>
                                        ) : null}
                                      </section>

                                      {inlineEntries.length > 0 ? (
                                        <section className="space-y-3">
                                          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                            {t('integrations.detail.logs.details.fields', 'Fields')}
                                          </p>
                                          <dl className="grid gap-3 sm:grid-cols-2">
                                            {inlineEntries.map(([key, value]) => (
                                              <div key={key} className="rounded-md border bg-muted/30 px-3 py-2">
                                                <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                                  {formatLogDetailLabel(key)}
                                                </dt>
                                                <dd className="mt-1 break-words text-sm">
                                                  {formatLogPrimitiveValue(value)}
                                                </dd>
                                              </div>
                                            ))}
                                          </dl>
                                        </section>
                                      ) : null}
                                    </div>

                                    <div className="space-y-3">
                                      {nestedEntries.map(([key, value]) => (
                                        <JsonDisplay
                                          key={key}
                                          data={value}
                                          title={formatLogDetailLabel(key)}
                                          defaultExpanded
                                          maxInitialDepth={1}
                                          theme="dark"
                                          maxHeight="16rem"
                                          className="p-4"
                                        />
                                      ))}
                                      {log.payload && nestedEntries.length === 0 ? (
                                        <JsonDisplay
                                          data={log.payload}
                                          title={t('integrations.detail.logs.details.payload', 'Payload')}
                                          defaultExpanded
                                          maxInitialDepth={1}
                                          theme="dark"
                                          maxHeight="16rem"
                                          className="p-4"
                                        />
                                      ) : null}
                                      {!log.payload ? (
                                        <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
                                          {t('integrations.detail.logs.details.noPayload', 'No structured payload was stored for this log entry.')}
                                        </div>
                                      ) : null}
                                    </div>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </React.Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </PageBody>
    </Page>
  )
}
