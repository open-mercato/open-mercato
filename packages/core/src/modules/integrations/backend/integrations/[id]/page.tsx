"use client"
import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { z } from 'zod'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { WebhookSetupGuide } from '@open-mercato/ui/backend/WebhookSetupGuide'
import { InjectionSpot, useInjectionWidgets } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
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
import { cn } from '@open-mercato/shared/lib/utils'
import { LEGACY_INTEGRATION_DETAIL_TABS_SPOT_ID, type CredentialFieldType, type IntegrationCredentialField } from '@open-mercato/shared/modules/integrations/types'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { Activity, AlertTriangle, Bell, Calendar, CheckCircle2, ChevronDown, ChevronRight, CreditCard, FileText, HardDrive, Key, MessageSquare, RefreshCw, Settings, Truck, Webhook, XCircle, Zap } from 'lucide-react'
import { IntegrationScheduleTab } from '../../../../data_sync/components/IntegrationScheduleTab'
import {
  buildIntegrationDetailInjectedTabs,
  filterIntegrationDetailWidgetsByKind,
  type IntegrationDetailInjectedTab,
  resolveIntegrationDetailWidgetSpotId,
  resolveRequestedIntegrationDetailTab,
} from '../detail-page-widgets'

type CredentialField = IntegrationCredentialField
type BuiltInIntegrationDetailTab = 'credentials' | 'version' | 'health' | 'logs' | 'data-sync-schedule'
type IntegrationDetailTab = BuiltInIntegrationDetailTab | string

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
    providerKey?: string | null
    bundleId?: string
    docsUrl?: string
    apiVersions?: ApiVersion[]
    detailPage?: {
      widgetSpotId?: string
    }
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

const HEALTH_STATUS_ICONS: Record<string, React.ElementType> = {
  healthy: CheckCircle2,
  degraded: AlertTriangle,
  unhealthy: XCircle,
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

function isAkeneoSettingsTab(tab: IntegrationDetailInjectedTab): boolean {
  return tab.id.includes('sync_akeneo') || tab.label.toLowerCase().includes('akeneo')
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

  const detailWidgetSpotId = React.useMemo(
    () => resolveIntegrationDetailWidgetSpotId(detail?.integration ?? null, LEGACY_INTEGRATION_DETAIL_TABS_SPOT_ID),
    [detail?.integration],
  )
  const mutationContextId = React.useMemo(
    () => `integrations.detail:${integrationId ?? 'unknown'}`,
    [integrationId],
  )
  const { runMutation, retryLastMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: mutationContextId,
    spotId: detailWidgetSpotId,
  })
  const refreshDetail = React.useCallback(async () => {
    await loadDetail()
    await loadCredentials()
  }, [loadCredentials, loadDetail])
  const refreshLogs = React.useCallback(async () => {
    await loadLogs()
  }, [loadLogs])
  const injectionContext = React.useMemo(
    () => ({
      formId: mutationContextId,
      integrationDetailWidgetSpotId: detailWidgetSpotId,
      resourceKind: 'integrations.integration',
      resourceId: integrationId ?? detail?.integration.id,
      integrationId: integrationId ?? detail?.integration.id,
      integration: detail?.integration ?? null,
      detail,
      state: detail?.state ?? null,
      credentialValues: credValues,
      latestHealthResult,
      activeTab,
      setActiveTab,
      refreshDetail,
      refreshLogs,
      retryLastMutation,
    }),
    [
      activeTab,
      credValues,
      detail,
      detailWidgetSpotId,
      integrationId,
      latestHealthResult,
      mutationContextId,
      refreshDetail,
      refreshLogs,
      retryLastMutation,
    ],
  )
  const { widgets: detailWidgets } = useInjectionWidgets(detailWidgetSpotId, {
    context: injectionContext,
    triggerOnLoad: true,
  })
  const stackedDetailWidgets = React.useMemo(
    () => filterIntegrationDetailWidgetsByKind(detailWidgets, 'stack'),
    [detailWidgets],
  )
  const groupedDetailWidgets = React.useMemo(
    () => filterIntegrationDetailWidgetsByKind(detailWidgets, 'group'),
    [detailWidgets],
  )
  const injectedTabs = React.useMemo(
    () => buildIntegrationDetailInjectedTabs(
      detailWidgets,
      (widget) => (
        widget.placement?.groupLabel
          ? t(widget.placement.groupLabel, widget.module.metadata.title ?? widget.widgetId)
          : (widget.module.metadata.title ?? widget.widgetId)
      ),
    ),
    [detailWidgets, t],
  )
  const hasDataSyncScheduleTab = Boolean(
    detail?.integration.hub === 'data_sync'
      && detail?.integration.providerKey
      && detail.integration.providerKey.trim().length > 0,
  )
  const customTabIds = React.useMemo(
    () => [
      ...(hasDataSyncScheduleTab ? ['data-sync-schedule'] : []),
      ...injectedTabs.map((tab) => tab.id),
    ],
    [hasDataSyncScheduleTab, injectedTabs],
  )
  const runMutationWithContext = React.useCallback(
    async <T,>({
      operation,
      mutationPayload,
      actionId,
      tabId,
      operationType = 'update',
    }: {
      operation: () => Promise<T>
      mutationPayload?: Record<string, unknown>
      actionId: string
      tabId?: string
      operationType?: 'create' | 'update' | 'delete'
    }): Promise<T> => {
      return runMutation({
        operation,
        mutationPayload,
        context: {
          ...injectionContext,
          operation: operationType,
          actionId,
          activeTab: tabId ?? activeTab,
        },
      })
    },
    [activeTab, injectionContext, runMutation],
  )

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
    try {
      const call = await runMutationWithContext({
        actionId: 'toggle-state',
        mutationPayload: { integrationId: currentIntegrationId, isEnabled: enabled },
        operation: () => apiCall(`/api/integrations/${encodeURIComponent(currentIntegrationId)}/state`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isEnabled: enabled }),
        }, { fallback: null }),
      })
      if (call.ok) {
        setDetail((prev) => prev ? { ...prev, state: { ...prev.state, isEnabled: enabled } } : prev)
        flash(t('integrations.detail.stateUpdated'), 'success')
      } else {
        flash(t('integrations.detail.stateError'), 'error')
      }
    } catch {
      flash(t('integrations.detail.stateError'), 'error')
    } finally {
      setIsTogglingState(false)
    }
  }, [resolveCurrentIntegrationId, runMutationWithContext, t])

  const handleSaveCredentials = React.useCallback(async (values: Record<string, unknown>) => {
    const currentIntegrationId = resolveCurrentIntegrationId()
    if (!currentIntegrationId) return
    setIsSavingCredentials(true)
    try {
      const call = await runMutationWithContext({
        actionId: 'save-credentials',
        tabId: 'credentials',
        mutationPayload: { integrationId: currentIntegrationId, credentials: values },
        operation: () => apiCall(`/api/integrations/${encodeURIComponent(currentIntegrationId)}/credentials`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credentials: values }),
        }, { fallback: null }),
      })

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
  }, [resolveCurrentIntegrationId, runMutationWithContext, t])

  const handleVersionChange = React.useCallback(async (version: string) => {
    const currentIntegrationId = resolveCurrentIntegrationId()
    if (!currentIntegrationId) return
    try {
      const call = await runMutationWithContext({
        actionId: 'change-version',
        tabId: 'version',
        mutationPayload: { integrationId: currentIntegrationId, apiVersion: version },
        operation: () => apiCall(`/api/integrations/${encodeURIComponent(currentIntegrationId)}/version`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiVersion: version }),
        }, { fallback: null }),
      })
      if (call.ok) {
        setDetail((prev) => prev ? { ...prev, state: { ...prev.state, apiVersion: version } } : prev)
        flash(t('integrations.detail.version.saved'), 'success')
      } else {
        flash(t('integrations.detail.version.saveError'), 'error')
      }
    } catch {
      flash(t('integrations.detail.version.saveError'), 'error')
    }
  }, [resolveCurrentIntegrationId, runMutationWithContext, t])

  const handleHealthCheck = React.useCallback(async () => {
    const currentIntegrationId = resolveCurrentIntegrationId()
    if (!currentIntegrationId) return
    setIsCheckingHealth(true)
    try {
      const call = await runMutationWithContext({
        actionId: 'run-health-check',
        tabId: 'health',
        mutationPayload: { integrationId: currentIntegrationId },
        operation: () => apiCall<HealthCheckResponse>(
          `/api/integrations/${encodeURIComponent(currentIntegrationId)}/health`,
          { method: 'POST' },
          { fallback: null },
        ),
      })
      const result = call.result
      if (call.ok && result) {
        setLatestHealthResult(result)
        setDetail((prev) => prev ? {
          ...prev,
          state: {
            ...prev.state,
            lastHealthStatus: result.status,
            lastHealthCheckedAt: result.checkedAt,
          },
        } : prev)
        void refreshLogs()
      } else {
        flash(t('integrations.detail.health.checkError'), 'error')
      }
    } catch {
      flash(t('integrations.detail.health.checkError'), 'error')
    } finally {
      setIsCheckingHealth(false)
    }
  }, [refreshLogs, resolveCurrentIntegrationId, runMutationWithContext, t])

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
    setActiveTab(resolveRequestedIntegrationDetailTab(searchParams?.get('tab'), hasVersions, customTabIds))
  }, [customTabIds, hasVersions, searchParams])

  const handleTabChange = React.useCallback((nextValue: string) => {
    const currentIntegrationId = resolveCurrentIntegrationId()
    const nextTab = resolveRequestedIntegrationDetailTab(nextValue, hasVersions, customTabIds)
    setActiveTab(nextTab)
    if (!currentIntegrationId) return
    const basePath = `/backend/integrations/${encodeURIComponent(currentIntegrationId)}`
    router.replace(nextTab === 'credentials' ? basePath : `${basePath}?tab=${encodeURIComponent(nextTab)}`)
  }, [customTabIds, hasVersions, resolveCurrentIntegrationId, router])

  if (isLoading) return <Page><PageBody><LoadingMessage label={t('integrations.detail.title')} /></PageBody></Page>
  if (error || !detail) return <Page><PageBody><ErrorMessage label={error ?? t('integrations.detail.loadError')} /></PageBody></Page>

  const resolvedIntegration = detail.integration
  const resolvedState = detail.state
  const CategoryIcon = resolvedIntegration.category ? CATEGORY_ICONS[resolvedIntegration.category] : null
  const HealthStatusIcon = resolvedState.lastHealthStatus ? HEALTH_STATUS_ICONS[resolvedState.lastHealthStatus] : null
  const prioritizedInjectedTabs = resolvedIntegration.id === 'sync_akeneo'
    ? [...injectedTabs].sort((left, right) => {
      const leftPriority = isAkeneoSettingsTab(left) ? 1 : 0
      const rightPriority = isAkeneoSettingsTab(right) ? 1 : 0
      if (leftPriority !== rightPriority) return rightPriority - leftPriority
      return 0
    })
    : injectedTabs
  const leadingInjectedTab = resolvedIntegration.id === 'sync_akeneo'
    ? prioritizedInjectedTabs.find(isAkeneoSettingsTab) ?? null
    : null
  const trailingInjectedTabs = leadingInjectedTab
    ? prioritizedInjectedTabs.filter((tab) => tab.id !== leadingInjectedTab.id)
    : prioritizedInjectedTabs
  const StateIcon = resolvedState.isEnabled ? CheckCircle2 : XCircle
  const stateBadgeClass = resolvedState.isEnabled
    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
    : 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300'

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
            <div className="space-y-2">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {t('integrations.detail.state.label', 'State')}
              </p>
              <Badge variant="outline" className={cn('gap-1.5 rounded-full px-3 py-1 text-xs font-medium', stateBadgeClass)}>
                <StateIcon className="h-3.5 w-3.5" />
                {resolvedState.isEnabled
                  ? t('integrations.detail.state.enabled', 'Enabled')
                  : t('integrations.detail.state.disabled', 'Disabled')}
              </Badge>
            </div>
            <Switch
              checked={resolvedState.isEnabled}
              disabled={isTogglingState}
              onCheckedChange={(checked) => void handleToggleState(checked)}
            />
          </div>
        </section>

        {stackedDetailWidgets.length > 0 ? (
          <section className="space-y-4">
            <InjectionSpot
              spotId={detailWidgetSpotId}
              context={injectionContext}
              data={detail}
              onDataChange={(next) => setDetail(next as IntegrationDetail)}
              widgetsOverride={stackedDetailWidgets}
            />
          </section>
        ) : null}

        {groupedDetailWidgets.length > 0 ? (
          <section className="grid gap-4 lg:grid-cols-2">
            {groupedDetailWidgets.map((widget) => (
              <Card
                key={widget.widgetId}
                className={widget.placement?.column === 2 ? 'lg:col-start-2' : undefined}
              >
                <CardHeader>
                  <CardTitle>
                    {widget.placement?.groupLabel
                      ? t(widget.placement.groupLabel, widget.module.metadata.title)
                      : widget.module.metadata.title}
                  </CardTitle>
                  {widget.placement?.groupDescription ? (
                    <p className="text-sm text-muted-foreground">
                      {widget.placement.groupDescription}
                    </p>
                  ) : null}
                </CardHeader>
                <CardContent>
                  <widget.module.Widget
                    context={injectionContext}
                    data={detail}
                    onDataChange={(next) => setDetail(next as IntegrationDetail)}
                  />
                </CardContent>
              </Card>
            ))}
          </section>
        ) : null}

        <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-5">
          <TabsList className="h-auto w-full justify-start overflow-x-auto rounded-none border-b border-border bg-transparent p-0">
            <TabsTrigger
              value="credentials"
              className="mr-8 h-auto rounded-none border-b-2 border-transparent bg-transparent px-0 py-2.5 text-sm font-medium text-muted-foreground shadow-none transition-colors hover:bg-transparent hover:text-foreground aria-selected:border-foreground aria-selected:bg-transparent aria-selected:text-foreground aria-selected:shadow-none last:mr-0"
            >
              <span className="inline-flex items-center gap-2">
                <Key className="h-4 w-4" />
                <span>{t('integrations.detail.tabs.credentials')}</span>
              </span>
            </TabsTrigger>
            {leadingInjectedTab ? (
              <TabsTrigger
                value={leadingInjectedTab.id}
                className="mr-8 h-auto rounded-none border-b-2 border-transparent bg-transparent px-0 py-2.5 text-sm font-medium text-muted-foreground shadow-none transition-colors hover:bg-transparent hover:text-foreground aria-selected:border-foreground aria-selected:bg-transparent aria-selected:text-foreground aria-selected:shadow-none last:mr-0"
              >
                <span className="inline-flex items-center gap-2">
                  <Settings className="h-4 w-4" />
                  <span>{leadingInjectedTab.label}</span>
                </span>
              </TabsTrigger>
            ) : null}
            {hasVersions ? (
              <TabsTrigger
                value="version"
                className="mr-8 h-auto rounded-none border-b-2 border-transparent bg-transparent px-0 py-2.5 text-sm font-medium text-muted-foreground shadow-none transition-colors hover:bg-transparent hover:text-foreground aria-selected:border-foreground aria-selected:bg-transparent aria-selected:text-foreground aria-selected:shadow-none last:mr-0"
              >
                <span className="inline-flex items-center gap-2">
                  <RefreshCw className="h-4 w-4" />
                  <span>{t('integrations.detail.tabs.version')}</span>
                </span>
              </TabsTrigger>
            ) : null}
            {hasDataSyncScheduleTab ? (
              <TabsTrigger
                value="data-sync-schedule"
                className="mr-8 h-auto rounded-none border-b-2 border-transparent bg-transparent px-0 py-2.5 text-sm font-medium text-muted-foreground shadow-none transition-colors hover:bg-transparent hover:text-foreground aria-selected:border-foreground aria-selected:bg-transparent aria-selected:text-foreground aria-selected:shadow-none last:mr-0"
              >
                <span className="inline-flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  <span>{t('data_sync.integrationTab.title', 'Sync schedules')}</span>
                </span>
              </TabsTrigger>
            ) : null}
            <TabsTrigger
              value="health"
              className="mr-8 h-auto rounded-none border-b-2 border-transparent bg-transparent px-0 py-2.5 text-sm font-medium text-muted-foreground shadow-none transition-colors hover:bg-transparent hover:text-foreground aria-selected:border-foreground aria-selected:bg-transparent aria-selected:text-foreground aria-selected:shadow-none last:mr-0"
            >
              <span className="inline-flex items-center gap-2">
                <Activity className="h-4 w-4" />
                <span>{t('integrations.detail.tabs.health')}</span>
              </span>
            </TabsTrigger>
            <TabsTrigger
              value="logs"
              className="mr-8 h-auto rounded-none border-b-2 border-transparent bg-transparent px-0 py-2.5 text-sm font-medium text-muted-foreground shadow-none transition-colors hover:bg-transparent hover:text-foreground aria-selected:border-foreground aria-selected:bg-transparent aria-selected:text-foreground aria-selected:shadow-none last:mr-0"
            >
              <span className="inline-flex items-center gap-2">
                <FileText className="h-4 w-4" />
                <span>{t('integrations.detail.tabs.logs')}</span>
              </span>
            </TabsTrigger>
            {trailingInjectedTabs.map((tab) => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                className="mr-8 h-auto rounded-none border-b-2 border-transparent bg-transparent px-0 py-2.5 text-sm font-medium text-muted-foreground shadow-none transition-colors hover:bg-transparent hover:text-foreground aria-selected:border-foreground aria-selected:bg-transparent aria-selected:text-foreground aria-selected:shadow-none last:mr-0"
              >
                <span className="inline-flex items-center gap-2">
                  <Settings className="h-4 w-4" />
                  <span>{tab.label}</span>
                </span>
              </TabsTrigger>
            ))}
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

          {hasDataSyncScheduleTab ? (
            <TabsContent value="data-sync-schedule" className="mt-0">
              <IntegrationScheduleTab
                integrationId={resolvedIntegration.id}
                hasCredentials={detail.hasCredentials}
                isEnabled={resolvedState.isEnabled}
              />
            </TabsContent>
          ) : null}

          <TabsContent value="health" className="mt-0 space-y-4">
            <Card className="gap-4 py-4">
              <CardHeader className="px-5">
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
              <CardContent className="space-y-3 px-5">
                <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/20 px-4 py-3">
                  {resolvedState.lastHealthStatus ? (
                    <Badge className={`gap-1.5 ${HEALTH_STATUS_STYLES[resolvedState.lastHealthStatus] ?? ''}`}>
                      {HealthStatusIcon ? <HealthStatusIcon className="h-3.5 w-3.5" /> : null}
                      {t(`integrations.detail.health.${resolvedState.lastHealthStatus}`)}
                    </Badge>
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <AlertTriangle className="h-4 w-4" />
                      <span>{t('integrations.detail.health.unknown')}</span>
                    </div>
                  )}
                  {healthStatusDescription ? (
                    <p className="min-w-0 flex-1 text-sm text-muted-foreground">{healthStatusDescription}</p>
                  ) : null}
                  <p className="text-xs text-muted-foreground md:ml-auto">
                    {resolvedState.lastHealthCheckedAt
                      ? t('integrations.detail.health.lastChecked', { date: new Date(resolvedState.lastHealthCheckedAt).toLocaleString() })
                      : t('integrations.detail.health.neverChecked')
                    }
                  </p>
                </div>
                {healthMessage || healthDetailEntries.length > 0 ? (
                  <div className={`grid gap-3 ${healthMessage && healthDetailEntries.length > 0 ? 'xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]' : ''}`}>
                    {healthMessage ? (
                      <div className="rounded-lg border px-4 py-3">
                        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                          {t('integrations.detail.health.lastResult', 'Last result')}
                        </p>
                        <p className="mt-1.5 text-sm">{healthMessage}</p>
                      </div>
                    ) : null}
                    {healthDetailEntries.length > 0 ? (
                      <div className="rounded-lg border px-4 py-3">
                        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                          {t('integrations.detail.health.details', 'Details')}
                        </p>
                        <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2">
                          {healthDetailEntries.map(([key, value]) => (
                            <div key={key}>
                              <dt className="text-xs font-medium text-muted-foreground">{formatLogDetailLabel(key)}</dt>
                              <dd className="mt-0.5 text-sm">{formatHealthValue(value)}</dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="logs" className="mt-0 space-y-4">
            <div className="flex items-center gap-3">
              <div className="relative inline-flex">
                <select
                  className="h-11 min-w-40 appearance-none rounded-xl border border-border bg-card pl-4 pr-11 text-sm font-medium text-foreground shadow-sm transition-colors focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                  value={logLevel}
                  onChange={(event) => setLogLevel(event.target.value)}
                >
                  <option value="">{t('integrations.detail.logs.level.all')}</option>
                  <option value="info">{t('integrations.detail.logs.level.info')}</option>
                  <option value="warn">{t('integrations.detail.logs.level.warn')}</option>
                  <option value="error">{t('integrations.detail.logs.level.error')}</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              </div>
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

          {injectedTabs.map((tab) => (
            <TabsContent key={tab.id} value={tab.id} className="mt-0 space-y-4">
              <InjectionSpot
                spotId={detailWidgetSpotId}
                context={injectionContext}
                data={detail}
                onDataChange={(next) => setDetail(next as IntegrationDetail)}
                widgetsOverride={tab.widgets}
              />
            </TabsContent>
          ))}
        </Tabs>
      </PageBody>
    </Page>
  )
}
