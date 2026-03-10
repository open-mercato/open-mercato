"use client"
import * as React from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Card, CardHeader, CardTitle, CardContent } from '@open-mercato/ui/primitives/card'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Input } from '@open-mercato/ui/primitives/input'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { CredentialFieldType, IntegrationCredentialField } from '@open-mercato/shared/modules/integrations/types'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'

type CredentialField = IntegrationCredentialField

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
  level: 'info' | 'warn' | 'error'
  message: string
  createdAt: string
  code?: string
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

export default function IntegrationDetailPage() {
  const params = useParams<{ id: string }>()
  const integrationId = params?.id
  const t = useT()

  const [detail, setDetail] = React.useState<IntegrationDetail | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const [credValues, setCredValues] = React.useState<Record<string, unknown>>({})
  const [isSavingCreds, setIsSavingCreds] = React.useState(false)

  const [logs, setLogs] = React.useState<LogEntry[]>([])
  const [logLevel, setLogLevel] = React.useState<string>('')
  const [isLoadingLogs, setIsLoadingLogs] = React.useState(false)

  const [isCheckingHealth, setIsCheckingHealth] = React.useState(false)
  const [isTogglingState, setIsTogglingState] = React.useState(false)

  const loadDetail = React.useCallback(async () => {
    if (!integrationId) return
    setIsLoading(true)
    setError(null)
    const call = await apiCall<IntegrationDetail>(
      `/api/integrations/${encodeURIComponent(integrationId)}`,
      undefined,
      { fallback: null },
    )
    if (!call.ok || !call.result) {
      setError(t('integrations.detail.loadError'))
      setIsLoading(false)
      return
    }
    setDetail(call.result)
    setIsLoading(false)
  }, [integrationId, t])

  const loadCredentials = React.useCallback(async () => {
    if (!integrationId) return
    const call = await apiCall<{ credentials: Record<string, unknown> }>(
      `/api/integrations/${encodeURIComponent(integrationId)}/credentials`,
      undefined,
      { fallback: null },
    )
    if (call.ok && call.result?.credentials) {
      setCredValues(call.result.credentials)
    }
  }, [integrationId])

  const loadLogs = React.useCallback(async () => {
    if (!integrationId) return
    setIsLoadingLogs(true)
    const params = new URLSearchParams({ integrationId, pageSize: '50' })
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
  }, [integrationId, logLevel])

  React.useEffect(() => { void loadDetail() }, [loadDetail])
  React.useEffect(() => { void loadCredentials() }, [loadCredentials])
  React.useEffect(() => { void loadLogs() }, [loadLogs])

  const handleToggleState = React.useCallback(async (enabled: boolean) => {
    setIsTogglingState(true)
    const call = await apiCall(`/api/integrations/${encodeURIComponent(integrationId)}/state`, {
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
  }, [integrationId, t])

  const handleSaveCredentials = React.useCallback(async () => {
    setIsSavingCreds(true)
    const call = await apiCall(`/api/integrations/${encodeURIComponent(integrationId)}/credentials`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credentials: credValues }),
    }, { fallback: null })
    if (call.ok) {
      flash(t('integrations.detail.credentials.saved'), 'success')
    } else {
      flash(t('integrations.detail.credentials.saveError'), 'error')
    }
    setIsSavingCreds(false)
  }, [integrationId, credValues, t])

  const handleVersionChange = React.useCallback(async (version: string) => {
    const call = await apiCall(`/api/integrations/${encodeURIComponent(integrationId)}/version`, {
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
  }, [integrationId, t])

  const handleHealthCheck = React.useCallback(async () => {
    setIsCheckingHealth(true)
    const call = await apiCall<{ status: string; checkedAt: string }>(
      `/api/integrations/${encodeURIComponent(integrationId)}/health`,
      { method: 'POST' },
      { fallback: null },
    )
    if (call.ok && call.result) {
      setDetail((prev) => prev ? {
        ...prev,
        state: {
          ...prev.state,
          lastHealthStatus: call.result!.status,
          lastHealthCheckedAt: call.result!.checkedAt,
        },
      } : prev)
    } else {
      flash(t('integrations.detail.health.checkError'), 'error')
    }
    setIsCheckingHealth(false)
  }, [integrationId, t])

  if (isLoading) return <Page><PageBody><LoadingMessage label={t('integrations.detail.title')} /></PageBody></Page>
  if (error || !detail) return <Page><PageBody><ErrorMessage label={error ?? t('integrations.detail.loadError')} /></PageBody></Page>

  const { integration, state } = detail
  const credFields = integration.credentials?.fields ?? detail.bundle?.credentials?.fields ?? []
  const hasVersions = Boolean(integration.apiVersions?.length)

  return (
    <Page>
      <PageBody className="space-y-6">
        <div>
          <Link href="/backend/integrations" className="text-sm text-muted-foreground hover:underline">
            {t('integrations.detail.back')}
          </Link>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">{integration.title}</h1>
            {integration.description && (
              <p className="text-muted-foreground mt-1">{integration.description}</p>
            )}
            <div className="flex gap-2 mt-2">
              {integration.category && <Badge variant="secondary">{integration.category}</Badge>}
              {integration.hub && <Badge variant="outline">{integration.hub}</Badge>}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">
              {state.isEnabled ? t('integrations.detail.enable') : t('integrations.detail.disable')}
            </span>
            <Switch
              checked={state.isEnabled}
              disabled={isTogglingState}
              onCheckedChange={(checked) => void handleToggleState(checked)}
            />
          </div>
        </div>

        <Tabs defaultValue="credentials">
          <TabsList>
            <TabsTrigger value="credentials">{t('integrations.detail.tabs.credentials')}</TabsTrigger>
            {hasVersions && <TabsTrigger value="version">{t('integrations.detail.tabs.version')}</TabsTrigger>}
            <TabsTrigger value="health">{t('integrations.detail.tabs.health')}</TabsTrigger>
            <TabsTrigger value="logs">{t('integrations.detail.tabs.logs')}</TabsTrigger>
          </TabsList>

          <TabsContent value="credentials" className="space-y-4 mt-4">
            {detail.bundle && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
                {t('integrations.detail.credentials.bundleShared', { bundle: detail.bundle.title })}
              </div>
            )}
            {credFields.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t('integrations.detail.credentials.notConfigured')}</p>
            ) : (
              <Card>
                <CardContent className="pt-6 space-y-4">
                  {credFields.filter(isEditableCredentialField).map((field) => (
                    <div key={field.key} className="space-y-1.5">
                      <label className="text-sm font-medium">
                        {field.label}{field.required && <span className="text-red-500 ml-0.5">*</span>}
                      </label>
                      {field.type === 'select' && field.options ? (
                        <select
                          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                          value={(credValues[field.key] as string) ?? ''}
                          onChange={(e) => setCredValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                        >
                          <option value="">—</option>
                          {field.options.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      ) : field.type === 'boolean' ? (
                        <Switch
                          checked={Boolean(credValues[field.key])}
                          onCheckedChange={(checked) => setCredValues((prev) => ({ ...prev, [field.key]: checked }))}
                        />
                      ) : (
                        <Input
                          type={field.type === 'secret' ? 'password' : 'text'}
                          placeholder={field.placeholder}
                          value={(credValues[field.key] as string) ?? ''}
                          onChange={(e) => setCredValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                        />
                      )}
                    </div>
                  ))}
                  <Button type="button" onClick={() => void handleSaveCredentials()} disabled={isSavingCreds}>
                    {isSavingCreds ? <Spinner className="mr-2 h-4 w-4" /> : null}
                    {t('integrations.detail.credentials.save')}
                  </Button>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {hasVersions && (
            <TabsContent value="version" className="space-y-4 mt-4">
              <Card>
                <CardHeader>
                  <CardTitle>{t('integrations.detail.version.select')}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {integration.apiVersions!.map((v) => {
                    const isSelected = (state.apiVersion ?? integration.apiVersions!.find((x) => x.status === 'stable')?.id) === v.id
                    return (
                      <div
                        key={v.id}
                        className={`flex items-center justify-between rounded-lg border p-3 cursor-pointer transition-colors ${isSelected ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}`}
                        onClick={() => void handleVersionChange(v.id)}
                      >
                        <div>
                          <span className="font-medium text-sm">{v.label ?? v.id}</span>
                          <Badge
                            variant={v.status === 'stable' ? 'default' : v.status === 'deprecated' ? 'destructive' : 'secondary'}
                            className="ml-2"
                          >
                            {t(`integrations.detail.version.${v.status}`)}
                          </Badge>
                          {v.status === 'deprecated' && v.sunsetAt && (
                            <span className="text-xs text-muted-foreground ml-2">
                              {t('integrations.detail.version.sunsetAt', { date: new Date(v.sunsetAt).toLocaleDateString() })}
                            </span>
                          )}
                        </div>
                        {isSelected && <Badge variant="outline">{t('integrations.detail.version.current')}</Badge>}
                      </div>
                    )
                  })}
                </CardContent>
              </Card>
            </TabsContent>
          )}

          <TabsContent value="health" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>{t('integrations.detail.health.title')}</CardTitle>
                  <Button type="button" variant="outline" size="sm" onClick={() => void handleHealthCheck()} disabled={isCheckingHealth}>
                    {isCheckingHealth ? <Spinner className="mr-2 h-4 w-4" /> : null}
                    {isCheckingHealth ? t('integrations.detail.health.checking') : t('integrations.detail.health.check')}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium">{t('integrations.detail.health.title')}:</span>
                  {state.lastHealthStatus ? (
                    <Badge className={HEALTH_STATUS_STYLES[state.lastHealthStatus] ?? ''}>
                      {t(`integrations.detail.health.${state.lastHealthStatus}`)}
                    </Badge>
                  ) : (
                    <span className="text-sm text-muted-foreground">{t('integrations.detail.health.unknown')}</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {state.lastHealthCheckedAt
                    ? t('integrations.detail.health.lastChecked', { date: new Date(state.lastHealthCheckedAt).toLocaleString() })
                    : t('integrations.detail.health.neverChecked')
                  }
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="logs" className="space-y-4 mt-4">
            <div className="flex items-center gap-3">
              <select
                className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                value={logLevel}
                onChange={(e) => setLogLevel(e.target.value)}
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
              <p className="text-muted-foreground text-sm py-4">{t('integrations.detail.logs.empty')}</p>
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
                    {logs.map((log) => (
                      <tr key={log.id} className="border-b last:border-0">
                        <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">
                          {new Date(log.createdAt).toLocaleString()}
                        </td>
                        <td className="px-4 py-2">
                          <Badge variant="secondary" className={LOG_LEVEL_STYLES[log.level] ?? ''}>
                            {log.level}
                          </Badge>
                        </td>
                        <td className="px-4 py-2">{log.message}</td>
                      </tr>
                    ))}
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
