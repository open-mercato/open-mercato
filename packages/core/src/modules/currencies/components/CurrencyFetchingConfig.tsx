'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader, extractOptimisticLockConflict } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { TimeInput } from '@open-mercato/ui/backend/inputs/TimeInput'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('currencies').child({ component: 'CurrencyFetchingConfig' })

interface FetchConfig {
  id: string
  provider: string
  isEnabled: boolean
  syncTime: string | null
  lastSyncAt: string | null
  lastSyncStatus: string | null
  lastSyncMessage: string | null
  lastSyncCount: number | null
  updatedAt?: string | null
}

const STATUS_BADGE_VARIANT: Record<string, StatusBadgeVariant> = {
  success: 'success',
  error: 'error',
  partial: 'warning',
}

export default function CurrencyFetchingConfig() {
  const t = useT()
  const [configs, setConfigs] = useState<FetchConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [fetching, setFetching] = useState<string | null>(null)
  const [initializing, setInitializing] = useState(false)

  // Available providers that should be configured
  const availableProviders = useMemo(() => ['NBP', 'Raiffeisen Bank Polska'], [])

  const mutationContextId = 'currencies-fetch-configs:mutation'
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId?: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: mutationContextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const createProviderConfig = useCallback(async (provider: string) => {
    try {
      await runMutation({
        operation: () => apiCall('/api/currencies/fetch-configs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider,
            isEnabled: false,
            syncTime: '09:00',
          }),
        }),
        context: {
          formId: mutationContextId,
          resourceKind: 'currencies.fetch_config',
          retryLastMutation,
        },
        mutationPayload: { provider, isEnabled: false, syncTime: '09:00' },
      })
    } catch (err: any) {
      // Ignore errors for duplicate providers
      if (!err.message?.includes('already configured')) {
        throw err
      }
    }
  }, [mutationContextId, retryLastMutation, runMutation])

  const initializeMissingProviders = useCallback(async (providers: string[]) => {
    setInitializing(true)
    try {
      for (const provider of providers) {
        await createProviderConfig(provider)
      }
      // Reload configs after initialization
      const { result } = await apiCall('/api/currencies/fetch-configs')
      if (result?.configs) {
        setConfigs(result.configs as FetchConfig[])
      }
    } catch (err: any) {
      logger.error('Failed to initialize providers', { err })
    } finally {
      setInitializing(false)
    }
  }, [createProviderConfig])

  const loadConfigs = useCallback(async () => {
    try {
      const { result } = await apiCall('/api/currencies/fetch-configs')

      if (result?.configs) {
        const existingConfigs = result.configs as FetchConfig[]
        setConfigs(existingConfigs)

        // Check if we need to initialize any missing providers
        const existingProviders = existingConfigs.map((c) => c.provider)
        const missingProviders = availableProviders.filter(
          (p) => !existingProviders.includes(p)
        )

        // Auto-initialize missing providers
        if (missingProviders.length > 0) {
          await initializeMissingProviders(missingProviders)
        }
      }
    } catch (err: any) {
      flash(err.message || t('currencies.fetch.error_load_configs'), 'error')
    } finally {
      setLoading(false)
    }
  }, [availableProviders, initializeMissingProviders, t])

  const toggleEnabled = useCallback(async (configId: string, currentValue: boolean, updatedAt?: string | null) => {
    try {
      const call = await runMutation({
        operation: async () => {
          const response = await withScopedApiRequestHeaders(
            buildOptimisticLockHeader(updatedAt),
            () =>
              apiCall('/api/currencies/fetch-configs', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  id: configId,
                  isEnabled: !currentValue,
                }),
              }),
          )
          if (!response.ok) {
            throw Object.assign(new Error('[internal] currencies.fetchConfig.toggle failed'), {
              status: response.status,
              ...((response.result as Record<string, unknown> | null) ?? {}),
            })
          }
          return response
        },
        context: {
          formId: mutationContextId,
          resourceKind: 'currencies.fetch_config',
          resourceId: configId,
          retryLastMutation,
        },
        mutationPayload: { id: configId, isEnabled: !currentValue },
      })

      const result = call.result as { config?: FetchConfig } | null
      if (result?.config) {
        setConfigs((prev) =>
          prev.map((c) => (c.id === configId ? (result.config as FetchConfig) : c))
        )
        flash(
          currentValue
            ? t('currencies.fetch.provider_disabled')
            : t('currencies.fetch.provider_enabled'),
          'success'
        )
      }
    } catch (err: any) {
      if (extractOptimisticLockConflict(err)) return
      flash(err.message || t('currencies.fetch.error_update_config'), 'error')
    }
  }, [mutationContextId, retryLastMutation, runMutation, t])

  const updateSyncTime = useCallback(async (configId: string, syncTime: string, updatedAt?: string | null) => {
    try {
      const call = await runMutation({
        operation: async () => {
          const response = await withScopedApiRequestHeaders(
            buildOptimisticLockHeader(updatedAt),
            () =>
              apiCall('/api/currencies/fetch-configs', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  id: configId,
                  syncTime: syncTime || null,
                }),
              }),
          )
          if (!response.ok) {
            throw Object.assign(new Error('[internal] currencies.fetchConfig.updateSyncTime failed'), {
              status: response.status,
              ...((response.result as Record<string, unknown> | null) ?? {}),
            })
          }
          return response
        },
        context: {
          formId: mutationContextId,
          resourceKind: 'currencies.fetch_config',
          resourceId: configId,
          retryLastMutation,
        },
        mutationPayload: { id: configId, syncTime: syncTime || null },
      })

      const result = call.result as { config?: FetchConfig } | null
      if (result?.config) {
        setConfigs((prev) =>
          prev.map((c) => (c.id === configId ? (result.config as FetchConfig) : c))
        )
      }
    } catch (err: any) {
      if (extractOptimisticLockConflict(err)) return
      flash(err.message || t('currencies.fetch.error_update_sync_time'), 'error')
    }
  }, [mutationContextId, retryLastMutation, runMutation, t])

  const fetchNow = useCallback(async (provider: string) => {
    setFetching(provider)

    try {
      const call = await runMutation({
        operation: () => apiCall('/api/currencies/fetch-rates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            providers: [provider],
          }),
        }),
        context: {
          formId: mutationContextId,
          resourceKind: 'currencies.fetch_rates',
          retryLastMutation,
        },
        mutationPayload: { providers: [provider] },
      })

      const result = call.result as { byProvider?: Record<string, { count: number; errors?: string[] }> } | null
      if (result) {
        const byProvider = result.byProvider as Record<string, { count: number; errors?: string[] }>
        const count = byProvider?.[provider]?.count || 0

        if (count === 0) {
          flash(t('currencies.fetch.sync_no_rates'), 'warning')
        } else {
          flash(t('currencies.fetch.sync_success', { count }), 'success')
        }
        await loadConfigs()
      }
    } catch (err: any) {
      flash(err.message || t('currencies.fetch.sync_error'), 'error')
    } finally {
      setFetching(null)
    }
  }, [mutationContextId, retryLastMutation, runMutation, t, loadConfigs])

  useEffect(() => {
    loadConfigs()
  }, [loadConfigs])

  function formatLastSync(date: string | null): string {
    if (!date) return t('currencies.fetch.last_sync_never')
    return new Date(date).toLocaleString()
  }

  function getStatusBadge(status: string | null) {
    if (!status) return null

    return (
      <StatusBadge variant={STATUS_BADGE_VARIANT[status] ?? 'neutral'}>
        {status}
      </StatusBadge>
    )
  }

  function getProviderName(provider: string): string {
    if (provider === 'NBP') return t('currencies.fetch.provider_nbp')
    if (provider === 'Raiffeisen Bank Polska') return t('currencies.fetch.provider_raiffeisen')
    return provider
  }

  function getProviderDescription(provider: string): string {
    if (provider === 'NBP') {
      return t('currencies.fetch.provider_nbp_description')
    }
    if (provider === 'Raiffeisen Bank Polska') {
      return t('currencies.fetch.provider_raiffeisen_description')
    }
    return ''
  }

  if (loading || initializing) {
    return (
      <section className="space-y-3 rounded-lg border bg-background p-4">
        <header className="space-y-2">
          <h2 className="text-xl font-semibold">{t('currencies.fetch.title')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('currencies.fetch.description')}
          </p>
        </header>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" />
          {initializing ? t('currencies.fetch.initializing_providers') : t('currencies.fetch.loading')}
        </div>
      </section>
    )
  }

  return (
    <section className="space-y-6 rounded-lg border bg-background p-4">
      <header className="space-y-2">
        <h2 className="text-xl font-semibold">{t('currencies.fetch.title')}</h2>
        <p className="text-sm text-muted-foreground">
          {t('currencies.fetch.description')}
        </p>
      </header>

      <div className="space-y-3">
        {configs.map((config) => (
          <div
            key={config.id}
            className="rounded-lg border bg-card p-4"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <h3 className="text-sm font-medium">
                  {getProviderName(config.provider)}
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {getProviderDescription(config.provider)}
                </p>
              </div>

              <Switch
                checked={config.isEnabled}
                onCheckedChange={() => toggleEnabled(config.id, config.isEnabled, config.updatedAt)}
              />
            </div>

            {config.isEnabled && (
              <>
                <div className="flex items-baseline gap-3 flex-wrap mt-3">
                  <div className="flex items-baseline gap-2">
                    <label className="text-xs text-muted-foreground whitespace-nowrap">
                      {t('currencies.fetch.sync_time')}:
                    </label>
                    <TimeInput
                      value={config.syncTime || '09:00'}
                      onChange={(time) => updateSyncTime(config.id, time, config.updatedAt)}
                    />
                  </div>

                  <div className="flex items-baseline gap-2">
                    <label className="text-xs text-muted-foreground whitespace-nowrap">
                      {t('currencies.fetch.last_sync')}:
                    </label>
                    <span className="text-xs text-muted-foreground">
                      {formatLastSync(config.lastSyncAt)}
                    </span>
                    {getStatusBadge(config.lastSyncStatus)}
                  </div>

                  <Button
                    type="button"
                    onClick={() => fetchNow(config.provider)}
                    disabled={fetching === config.provider}
                    size="default"
                    className="ml-auto min-w-32"
                  >
                    {fetching === config.provider ? (
                      <div>
                        <Spinner className="mr-1.5" size='sm' />
                        {t('currencies.fetch.fetching')}
                      </div>
                    ) : (
                      t('currencies.fetch.fetch_now')
                    )}
                  </Button>
                </div>

                {config.lastSyncCount !== null && (
                  <div className="text-xs text-muted-foreground mt-2">
                    {t('currencies.fetch.last_sync_count')}: <span className="font-medium">{config.lastSyncCount}</span>
                  </div>
                )}

                {config.lastSyncMessage && config.lastSyncStatus === 'error' && (
                  <Alert status="error" style="lighter" size="xs" className="mt-2">
                    {config.lastSyncMessage}
                  </Alert>
                )}
              </>
            )}
          </div>
        ))}

        {configs.length === 0 && (
          <div className="rounded border bg-background/80 p-6 text-center">
            <p className="text-sm text-muted-foreground">
              {t('currencies.fetch.no_providers')}
            </p>
            <Button
              type="button"
              onClick={() => initializeMissingProviders(availableProviders)}
            >
              {t('currencies.fetch.initialize_providers')}
            </Button>
          </div>
        )}
      </div>
    </section>
  )
}
