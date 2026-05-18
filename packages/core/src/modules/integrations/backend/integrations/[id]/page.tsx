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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Input } from '@open-mercato/ui/primitives/input'
import { PasswordInput } from '@open-mercato/ui/primitives/password-input'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'
import { JsonDisplay } from '@open-mercato/ui/backend/JsonDisplay'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import {
  LEGACY_INTEGRATION_DETAIL_TABS_SPOT_ID,
  type CredentialFieldType,
  type IntegrationCredentialField,
  type IntegrationDetailBuiltInTab,
} from '@open-mercato/shared/modules/integrations/types'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { LogList, type LogListEntry } from '@open-mercato/ui/backend/LogList'
import { Activity, AlertTriangle, Bell, Calendar, CheckCircle2, CreditCard, FileText, FileX, HardDrive, Key, MessageSquare, RefreshCw, Settings, Truck, Webhook, XCircle, Zap } from 'lucide-react'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
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

type IntegrationLogAnalytics = {
  lastActivityAt: string | null
  totalCount: number
  errorCount: number
  errorRate: number
  dailyCounts: number[]
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
      hiddenTabs?: IntegrationDetailBuiltInTab[]
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
    lastHealthLatencyMs: number | null
    enabledAt: string | null
  }
  hasCredentials: boolean
  healthStatus: 'healthy' | 'degraded' | 'unhealthy' | 'unconfigured'
  analytics: IntegrationLogAnalytics
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
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unconfigured'
  message: string | null
  details: Record<string, unknown> | null
  checkedAt: string
  latencyMs: number | null
}

type DataSyncRunDetail = {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  progressJobId?: string | null
  createdCount?: number
  updatedCount?: number
  skippedCount?: number
  failedCount?: number
  progressJob?: {
    progressPercent?: number | null
    processedCount?: number | null
    totalCount?: number | null
  } | null
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
  unconfigured: 'bg-zinc-100 text-zinc-700',
}

const HEALTH_STATUS_ICONS: Record<string, React.ElementType> = {
  healthy: CheckCircle2,
  degraded: AlertTriangle,
  unhealthy: XCircle,
  unconfigured: AlertTriangle,
}

function formatRunStatusLabel(status: DataSyncRunDetail['status'], t: ReturnType<typeof useT>): string {
  switch (status) {
    case 'pending':
      return t('integrations.detail.runActivity.status.pending', 'Pending')
    case 'running':
      return t('integrations.detail.runActivity.status.running', 'Running')
    case 'completed':
      return t('integrations.detail.runActivity.status.completed', 'Completed')
    case 'failed':
      return t('integrations.detail.runActivity.status.failed', 'Failed')
    case 'cancelled':
      return t('integrations.detail.runActivity.status.cancelled', 'Cancelled')
    default:
      return status
  }
}

function RunActivityStrip({
  run,
  refreshedAt,
  isRefreshing,
  onRefresh,
  t,
}: {
  run: DataSyncRunDetail | null
  refreshedAt: string | null
  isRefreshing: boolean
  onRefresh: () => void
  t: ReturnType<typeof useT>
}) {
  if (!run) return null

  const progress = typeof run.progressJob?.progressPercent === 'number' ? run.progressJob.progressPercent : 0
  const processed = typeof run.progressJob?.processedCount === 'number' ? run.progressJob.processedCount : 0
  const total = typeof run.progressJob?.totalCount === 'number' ? run.progressJob.totalCount : null
  const statusClass = run.status === 'completed'
    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    : run.status === 'failed'
      ? 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300'
      : run.status === 'cancelled'
        ? 'border-zinc-500/30 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300'
        : 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300'

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/20 px-4 py-3 text-sm">
      <Badge variant="outline" className={cn('gap-1.5', statusClass)}>
        <RefreshCw className={cn('h-3.5 w-3.5', run.status === 'running' ? 'animate-spin' : '')} />
        {formatRunStatusLabel(run.status, t)}
      </Badge>
      <span className="text-muted-foreground">
        {t('integrations.detail.runActivity.processed', 'Processed')}: <span className="font-medium text-foreground">{processed}{total !== null ? ` / ${total}` : ''}</span>
      </span>
      <span className="text-muted-foreground">
        {t('integrations.detail.runActivity.progress', 'Progress')}: <span className="font-medium text-foreground">{progress}%</span>
      </span>
      {refreshedAt ? (
        <span className="text-muted-foreground">
          {t('integrations.detail.runActivity.lastRefreshed', 'Last refreshed')}: {new Date(refreshedAt).toLocaleTimeString()}
        </span>
      ) : null}
      <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={onRefresh} disabled={isRefreshing}>
        {isRefreshing ? <Spinner className="mr-2 h-4 w-4" /> : <RefreshCw className="mr-2 h-4 w-4" />}
        {t('integrations.detail.runActivity.refresh', 'Refresh')}
      </Button>
    </div>
  )
}

function DetailLogSparkline({ counts, className }: { counts: number[]; className?: string }) {
  const max = Math.max(1, ...counts)
  const w = 120
  const h = 36
  const step = counts.length > 1 ? w / (counts.length - 1) : w
  const points = counts.map((count, index) => {
    const x = index * step
    const y = h - (count / max) * (h - 4) - 2
    return `${x},${y}`
  }).join(' ')
  return (
    <svg width={w} height={h} className={className} aria-hidden>
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={points}
        className="text-muted-foreground/80"
      />
    </svg>
  )
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
          <PasswordInput
            id={id}
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

  const [isCheckingHealth, setIsCheckingHealth] = React.useState(false)
  const [isTogglingState, setIsTogglingState] = React.useState(false)
  const [latestHealthResult, setLatestHealthResult] = React.useState<HealthCheckResponse | null>(null)
  const [activeRunDetail, setActiveRunDetail] = React.useState<DataSyncRunDetail | null>(null)
  const [activeRunRefreshedAt, setActiveRunRefreshedAt] = React.useState<string | null>(null)
  const [isRefreshingRunActivity, setIsRefreshingRunActivity] = React.useState(false)
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
  const refreshHealthSnapshot = React.useCallback(async () => {
    await loadDetail()
  }, [loadDetail])
  const runIdFromUrl = searchParams?.get('runId') ?? null
  const refreshRunActivity = React.useCallback(async (options?: { showLoading?: boolean }) => {
    if (!runIdFromUrl) {
      setActiveRunDetail(null)
      setActiveRunRefreshedAt(null)
      return null
    }
    if (options?.showLoading) setIsRefreshingRunActivity(true)
    try {
      const call = await apiCall<DataSyncRunDetail>(
        `/api/data_sync/runs/${encodeURIComponent(runIdFromUrl)}`,
        undefined,
        { fallback: null },
      )
      await loadLogs()
      await loadDetail()
      if (call.ok && call.result) {
        setActiveRunDetail(call.result)
        setActiveRunRefreshedAt(new Date().toISOString())
        return call.result
      }
      return null
    } finally {
      if (options?.showLoading) setIsRefreshingRunActivity(false)
    }
  }, [loadDetail, loadLogs, runIdFromUrl])
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
      refreshHealthSnapshot,
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
      refreshHealthSnapshot,
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
        setDetail((prev) => prev ? {
          ...prev,
          state: {
            ...prev.state,
            isEnabled: enabled,
            enabledAt: enabled ? new Date().toISOString() : prev.state.enabledAt,
          },
        } : prev)
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
          healthStatus: result.status,
          state: {
            ...prev.state,
            lastHealthStatus: result.status === 'unconfigured' ? prev.state.lastHealthStatus : result.status,
            lastHealthCheckedAt: result.status === 'unconfigured' ? prev.state.lastHealthCheckedAt : result.checkedAt,
            lastHealthLatencyMs: result.latencyMs ?? prev.state.lastHealthLatencyMs,
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
  const latestOperationalLog = React.useMemo(
    () => logs.find((log) => (
      typeof log.payload?.operationalStatus === 'string'
      || typeof log.payload?.summary === 'string'
    )) ?? null,
    [logs],
  )
  const healthMessage =
    latestHealthResult?.message ??
    (typeof latestHealthLog?.payload?.message === 'string'
      ? latestHealthLog.payload.message
      : typeof latestOperationalLog?.payload?.summary === 'string'
        ? latestOperationalLog.payload.summary
        : null)
  const healthDetailsSource = latestHealthResult?.details ?? extractHealthDetails(latestHealthLog?.payload ?? latestOperationalLog?.payload)
  const healthDetails = latestHealthLog?.code
    ? { ...healthDetailsSource, code: latestHealthLog.code }
    : healthDetailsSource
  const healthDetailEntries = Object.entries(healthDetails)
  const resolvedIntegration = detail?.integration ?? null
  const resolvedState = detail?.state ?? null
  const displayHealthStatus =
    latestHealthResult?.status ?? detail?.healthStatus ?? resolvedState?.lastHealthStatus ?? 'unconfigured'

  const healthStatusDescription = displayHealthStatus && displayHealthStatus !== 'unconfigured'
    ? t(
      `integrations.detail.health.meaning.${displayHealthStatus}`,
      displayHealthStatus === 'healthy'
        ? 'The provider responded successfully using the current credentials.'
        : displayHealthStatus === 'degraded'
          ? 'The provider responded, but reported warnings or limited functionality.'
          : integration?.id === 'gateway_stripe'
            ? 'Stripe rejected the last check. This usually means the secret key is invalid, missing required permissions, revoked, or Stripe was temporarily unavailable.'
            : 'The last check failed. This usually means invalid credentials, missing permissions, or a provider outage.',
    )
    : displayHealthStatus === 'unconfigured'
      ? t(
        'integrations.detail.health.meaning.unconfigured',
        'Credentials or a health check are not configured, or the integration has not been probed yet.',
      )
      : null

  const CategoryIcon = resolvedIntegration?.category ? CATEGORY_ICONS[resolvedIntegration.category] : null
  const HealthStatusIcon = HEALTH_STATUS_ICONS[displayHealthStatus] ?? null
  const prioritizedInjectedTabs = resolvedIntegration?.id === 'sync_akeneo'
    ? [...injectedTabs].sort((left, right) => {
      const leftPriority = isAkeneoSettingsTab(left) ? 1 : 0
      const rightPriority = isAkeneoSettingsTab(right) ? 1 : 0
      if (leftPriority !== rightPriority) return rightPriority - leftPriority
      return 0
    })
    : injectedTabs
  const leadingInjectedTab = resolvedIntegration?.id === 'sync_akeneo'
    ? prioritizedInjectedTabs.find(isAkeneoSettingsTab) ?? null
    : null
  const trailingInjectedTabs = leadingInjectedTab
    ? prioritizedInjectedTabs.filter((tab) => tab.id !== leadingInjectedTab.id)
    : prioritizedInjectedTabs
  const hiddenBuiltInTabs = new Set(resolvedIntegration?.detailPage?.hiddenTabs ?? [])
  const showCredentialsTab = !hiddenBuiltInTabs.has('credentials')
  const showVersionTab = hasVersions && !hiddenBuiltInTabs.has('version')
  const showDataSyncScheduleTab = hasDataSyncScheduleTab && !hiddenBuiltInTabs.has('data-sync-schedule')
  const showHealthTab = !hiddenBuiltInTabs.has('health')
  const showLogsTab = !hiddenBuiltInTabs.has('logs')
  const visibleTabIds = [
    ...(showCredentialsTab ? ['credentials'] : []),
    ...(leadingInjectedTab ? [leadingInjectedTab.id] : []),
    ...(showVersionTab ? ['version'] : []),
    ...(showDataSyncScheduleTab ? ['data-sync-schedule'] : []),
    ...(showHealthTab ? ['health'] : []),
    ...(showLogsTab ? ['logs'] : []),
    ...trailingInjectedTabs.map((tab) => tab.id),
  ] satisfies IntegrationDetailTab[]
  const StateIcon = resolvedState?.isEnabled ? CheckCircle2 : XCircle
  const stateBadgeClass = resolvedState?.isEnabled
    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
    : 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300'

  const showCredentialActions = showCredentialsTab && activeTab === 'credentials' && credentialFormFields.length > 0

  React.useEffect(() => {
    setActiveTab(resolveRequestedIntegrationDetailTab(searchParams?.get('tab'), visibleTabIds))
  }, [searchParams, visibleTabIds])

  const handleTabChange = React.useCallback((nextValue: string) => {
    const currentIntegrationId = resolveCurrentIntegrationId()
    const nextTab = resolveRequestedIntegrationDetailTab(nextValue, visibleTabIds)
    setActiveTab(nextTab)
    if (!currentIntegrationId) return
    const basePath = `/backend/integrations/${encodeURIComponent(currentIntegrationId)}`
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    if (nextTab === 'credentials') params.delete('tab')
    else params.set('tab', nextTab)
    const query = params.toString()
    router.replace(query ? `${basePath}?${query}` : basePath)
  }, [resolveCurrentIntegrationId, router, searchParams, visibleTabIds])

  React.useEffect(() => {
    if (!runIdFromUrl) {
      setActiveRunDetail(null)
      setActiveRunRefreshedAt(null)
      return
    }
    if (activeTab !== 'logs' && activeTab !== 'health') return

    let cancelled = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const poll = async () => {
      const detail = await refreshRunActivity()
      if (cancelled) return

      const status = detail?.status ?? null
      if (status === 'pending' || status === 'running') {
        timeoutId = setTimeout(() => {
          void poll()
        }, 4_000)
      }
    }

    void poll()

    return () => {
      cancelled = true
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [activeTab, refreshRunActivity, runIdFromUrl])

  if (isLoading) return <Page><PageBody><LoadingMessage label={t('integrations.detail.title')} /></PageBody></Page>
  if (error || !detail || !resolvedIntegration || !resolvedState) {
    return <Page><PageBody><ErrorMessage label={error ?? t('integrations.detail.loadError')} /></PageBody></Page>
  }

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

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('integrations.detail.analytics.title')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-1 text-sm text-muted-foreground">
              <p>
                {t('integrations.detail.analytics.totalEvents', { count: detail.analytics.totalCount })}
              </p>
              <p>
                {t('integrations.detail.analytics.errorRate', {
                  rate: `${Math.round(detail.analytics.errorRate * 1000) / 10}%`,
                })}
              </p>
              <p>
                {detail.analytics.lastActivityAt
                  ? `${t('integrations.detail.analytics.lastActivity')}: ${new Date(detail.analytics.lastActivityAt).toLocaleString()}`
                  : t('integrations.detail.analytics.never')}
              </p>
            </div>
            <DetailLogSparkline counts={detail.analytics.dailyCounts} />
          </CardContent>
        </Card>

        <section className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-2">
              <p className="text-overline uppercase tracking-wide text-muted-foreground">
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
            {showCredentialsTab ? (
              <TabsTrigger
                value="credentials"
                className="mr-8 h-auto rounded-none border-b-2 border-transparent bg-transparent px-0 py-2.5 text-sm font-medium text-muted-foreground shadow-none transition-colors hover:bg-transparent hover:text-foreground aria-selected:border-foreground aria-selected:bg-transparent aria-selected:text-foreground aria-selected:shadow-none last:mr-0"
              >
                <span className="inline-flex items-center gap-2">
                  <Key className="h-4 w-4" />
                  <span>{t('integrations.detail.tabs.credentials')}</span>
                </span>
              </TabsTrigger>
            ) : null}
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
            {showVersionTab ? (
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
            {showDataSyncScheduleTab ? (
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
            {showHealthTab ? (
              <TabsTrigger
                value="health"
                className="mr-8 h-auto rounded-none border-b-2 border-transparent bg-transparent px-0 py-2.5 text-sm font-medium text-muted-foreground shadow-none transition-colors hover:bg-transparent hover:text-foreground aria-selected:border-foreground aria-selected:bg-transparent aria-selected:text-foreground aria-selected:shadow-none last:mr-0"
              >
                <span className="inline-flex items-center gap-2">
                  <Activity className="h-4 w-4" />
                  <span>{t('integrations.detail.tabs.health')}</span>
                </span>
              </TabsTrigger>
            ) : null}
            {showLogsTab ? (
              <TabsTrigger
                value="logs"
                className="mr-8 h-auto rounded-none border-b-2 border-transparent bg-transparent px-0 py-2.5 text-sm font-medium text-muted-foreground shadow-none transition-colors hover:bg-transparent hover:text-foreground aria-selected:border-foreground aria-selected:bg-transparent aria-selected:text-foreground aria-selected:shadow-none last:mr-0"
              >
                <span className="inline-flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  <span>{t('integrations.detail.tabs.logs')}</span>
                </span>
              </TabsTrigger>
            ) : null}
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

          {showCredentialsTab ? (
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
          ) : null}

          {showVersionTab ? (
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

          {showDataSyncScheduleTab ? (
            <TabsContent value="data-sync-schedule" className="mt-0">
              <IntegrationScheduleTab
                integrationId={resolvedIntegration.id}
                hasCredentials={detail.hasCredentials}
                isEnabled={resolvedState.isEnabled}
              />
            </TabsContent>
          ) : null}

          {showHealthTab ? (
            <TabsContent value="health" className="mt-0 space-y-4">
              <RunActivityStrip
                run={activeRunDetail}
                refreshedAt={activeRunRefreshedAt}
                isRefreshing={isRefreshingRunActivity}
                onRefresh={() => void refreshRunActivity({ showLoading: true })}
                t={t}
              />
              <Card className="gap-4 py-4">
                <CardHeader className="px-5">
                  <div className="flex items-center justify-between">
                    <CardTitle>{t('integrations.detail.health.title')}</CardTitle>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void refreshRunActivity({ showLoading: true })}
                        disabled={isRefreshingRunActivity || !runIdFromUrl}
                      >
                        {isRefreshingRunActivity ? <Spinner className="mr-2 h-4 w-4" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                        {t('integrations.detail.runActivity.refresh', 'Refresh')}
                      </Button>
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
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 px-5">
                  <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/20 px-4 py-3">
                    {displayHealthStatus ? (
                      <Badge className={`gap-1.5 ${HEALTH_STATUS_STYLES[displayHealthStatus] ?? ''}`}>
                        {HealthStatusIcon ? <HealthStatusIcon className="h-3.5 w-3.5" /> : null}
                        {t(`integrations.detail.health.${displayHealthStatus}`)}
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
                          <p className="text-overline font-medium uppercase tracking-widest text-muted-foreground">
                            {t('integrations.detail.health.lastResult', 'Last result')}
                          </p>
                          <p className="mt-1.5 text-sm">{healthMessage}</p>
                        </div>
                      ) : null}
                      {healthDetailEntries.length > 0 ? (
                        <div className="rounded-lg border px-4 py-3">
                          <p className="text-overline font-medium uppercase tracking-widest text-muted-foreground">
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
          ) : null}

          {showLogsTab ? (
            <TabsContent value="logs" className="mt-0 space-y-4">
            <RunActivityStrip
              run={activeRunDetail}
              refreshedAt={activeRunRefreshedAt}
              isRefreshing={isRefreshingRunActivity}
              onRefresh={() => void refreshRunActivity({ showLoading: true })}
              t={t}
            />
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex">
                <Select
                  value={logLevel || undefined}
                  onValueChange={(value) => setLogLevel(value ?? '')}
                >
                  <SelectTrigger size="lg" className="min-w-40">
                    <SelectValue placeholder={t('integrations.detail.logs.level.all')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="info">{t('integrations.detail.logs.level.info')}</SelectItem>
                    <SelectItem value="warn">{t('integrations.detail.logs.level.warn')}</SelectItem>
                    <SelectItem value="error">{t('integrations.detail.logs.level.error')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void refreshRunActivity({ showLoading: true })}
                disabled={isRefreshingRunActivity || !runIdFromUrl}
              >
                {isRefreshingRunActivity ? <Spinner className="mr-2 h-4 w-4" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                {t('integrations.detail.runActivity.refresh', 'Refresh')}
              </Button>
            </div>
            {isLoadingLogs ? (
              <div className="flex justify-center py-8"><Spinner /></div>
            ) : (
              <LogList
                entries={logs.map<LogListEntry>((log) => {
                  const metadataEntries = [
                    ['Time', new Date(log.createdAt).toLocaleString()],
                    ['Level', log.level],
                    ['Code', log.code ?? null],
                    ['Run ID', log.runId ?? null],
                    ['Entity Type', log.scopeEntityType ?? null],
                    ['Entity ID', log.scopeEntityId ?? null],
                  ].filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim().length > 0)
                  const { inlineEntries, nestedEntries } = splitLogPayload(log.payload)

                  return {
                    id: log.id,
                    time: new Date(log.createdAt).toLocaleString(),
                    level: log.level,
                    message: log.message,
                    body: (
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
                                    <dt className="text-overline font-medium uppercase tracking-wide text-muted-foreground">
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
                                    <dt className="text-overline font-medium uppercase tracking-wide text-muted-foreground">
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
                            <EmptyState
                              size="sm"
                              icon={<FileX className="h-8 w-8" aria-hidden="true" />}
                              title={t('integrations.detail.logs.details.noPayload', 'No structured payload was stored for this log entry.')}
                            />
                          ) : null}
                        </div>
                      </div>
                    ),
                  }
                })}
                emptyMessage={t('integrations.detail.logs.empty')}
              />
            )}
            </TabsContent>
          ) : null}

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
