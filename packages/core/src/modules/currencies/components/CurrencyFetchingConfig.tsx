'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'

interface FetchConfig {
  id: string
  provider: string
  isEnabled: boolean
  syncTime: string | null
  lastSyncAt: string | null
  lastSyncStatus: string | null
  lastSyncMessage: string | null
  lastSyncCount: number | null
}

interface Props {
  translations: {
    title: string
    enabled: string
    disabled: string
    syncTime: string
    lastSync: string
    lastSyncStatus: string
    lastSyncCount: string
    fetchNow: string
    syncSuccess: string
    syncError: string
    providerNbp: string
    providerRaiffeisen: string
    loading: string
    testConnection: string
  }
}

export default function CurrencyFetchingConfig({ translations: t }: Props) {
  const [configs, setConfigs] = useState<FetchConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [fetching, setFetching] = useState<string | null>(null)
  const [initializing, setInitializing] = useState(false)

  // Available providers that should be configured
  const availableProviders = useMemo(() => ['NBP', 'Raiffeisen Bank Polska'], [])

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
      flash(err.message || 'Failed to load configurations', 'error')
    } finally {
      setLoading(false)
    }
  }, [availableProviders])

  const createProviderConfig = useCallback(async (provider: string) => {
    try {
      await apiCall('/api/currencies/fetch-configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          isEnabled: false,
          syncTime: '09:00',
        }),
      })
    } catch (err: any) {
      // Ignore errors for duplicate providers
      if (!err.message?.includes('already configured')) {
        throw err
      }
    }
  }, [])

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
      console.error('Failed to initialize providers:', err)
    } finally {
      setInitializing(false)
    }
  }, [createProviderConfig])

  const toggleEnabled = useCallback(async (configId: string, currentValue: boolean) => {
    try {
      const { result } = await apiCall('/api/currencies/fetch-configs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: configId,
          isEnabled: !currentValue,
        }),
      })

      if (result?.config) {
        setConfigs((prev) =>
          prev.map((c) => (c.id === configId ? (result.config as FetchConfig) : c))
        )
        flash(currentValue ? 'Provider disabled' : 'Provider enabled', 'success')
      }
    } catch (err: any) {
      flash(err.message || 'Failed to update configuration', 'error')
    }
  }, [])

  const updateSyncTime = useCallback(async (configId: string, syncTime: string) => {
    try {
      const { result } = await apiCall('/api/currencies/fetch-configs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: configId,
          syncTime: syncTime || null,
        }),
      })

      if (result?.config) {
        setConfigs((prev) =>
          prev.map((c) => (c.id === configId ? (result.config as FetchConfig) : c))
        )
      }
    } catch (err: any) {
      flash(err.message || 'Failed to update sync time', 'error')
    }
  }, [])

  const fetchNow = useCallback(async (provider: string) => {
    setFetching(provider)

    try {
      const { result } = await apiCall('/api/currencies/fetch-rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providers: [provider],
        }),
      })

      if (result) {
        const byProvider = result.byProvider as Record<string, { count: number; errors?: string[] }>
        const count = byProvider?.[provider]?.count || 0
        flash(`${t.syncSuccess}: ${count} rates fetched`, 'success')
        await loadConfigs()
      }
    } catch (err: any) {
      flash(err.message || t.syncError, 'error')
    } finally {
      setFetching(null)
    }
  }, [t.syncSuccess, t.syncError, loadConfigs])

  useEffect(() => {
    loadConfigs()
  }, [loadConfigs])

  function formatLastSync(date: string | null): string {
    if (!date) return 'Never'
    return new Date(date).toLocaleString()
  }

  function getStatusBadge(status: string | null) {
    if (!status) return null

    const styles: Record<string, string> = {
      success: 'bg-green-100 text-green-800 px-2 py-1 rounded text-xs',
      error: 'bg-red-100 text-red-800 px-2 py-1 rounded text-xs',
      partial: 'bg-yellow-100 text-yellow-800 px-2 py-1 rounded text-xs',
    }

    return (
      <span className={styles[status] || styles.error}>
        {status}
      </span>
    )
  }

  function getProviderName(provider: string): string {
    if (provider === 'NBP') return t.providerNbp
    if (provider === 'Raiffeisen Bank Polska') return t.providerRaiffeisen
    return provider
  }

  function getProviderDescription(provider: string): string {
    if (provider === 'NBP') {
      return '~13 currencies with buy/sell rates from Polish National Bank'
    }
    if (provider === 'Raiffeisen Bank Polska') {
      return '4 major currencies (EUR, USD, CHF, GBP) with buy/sell rates'
    }
    return ''
  }

  if (loading || initializing) {
    return (
      <section className="space-y-3 rounded-lg border bg-background p-4">
        <header className="space-y-2">
          <h2 className="text-xl font-semibold">{t.title}</h2>
          <p className="text-sm text-muted-foreground">
            Manage automatic currency exchange rate fetching from external providers
          </p>
        </header>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" />
          {initializing ? 'Initializing providers...' : t.loading}
        </div>
      </section>
    )
  }

  return (
    <section className="space-y-6 rounded-lg border bg-background p-4">
      <header className="space-y-2">
        <h2 className="text-xl font-semibold">{t.title}</h2>
        <p className="text-sm text-muted-foreground">
          Manage automatic currency exchange rate fetching from external providers
        </p>
      </header>

      <div className="space-y-3">
        {configs.map((config) => (
          <div
            key={config.id}
            className="rounded-lg border bg-card p-4"
          >
            <div className="flex items-start justify-between gap-4 mb-3">
              <div className="flex-1">
                <h3 className="text-sm font-medium">
                  {getProviderName(config.provider)}
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {getProviderDescription(config.provider)}
                </p>
              </div>

              <label className="flex items-center gap-2 cursor-pointer text-xs">
                <input
                  type="checkbox"
                  checked={config.isEnabled}
                  onChange={() => toggleEnabled(config.id, config.isEnabled)}
                  className="h-4 w-4"
                />
                <span className="font-medium">
                  {config.isEnabled ? t.enabled : t.disabled}
                </span>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">
                  {t.syncTime}
                </label>
                <input
                  type="time"
                  value={config.syncTime || '09:00'}
                  onChange={(e) => updateSyncTime(config.id, e.target.value)}
                  className="w-full rounded border bg-background px-2 py-1.5 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs text-muted-foreground mb-1">
                  {t.lastSync}
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {formatLastSync(config.lastSyncAt)}
                  </span>
                  {getStatusBadge(config.lastSyncStatus)}
                </div>
              </div>
            </div>

            {config.lastSyncCount !== null && (
              <div className="text-xs text-muted-foreground mb-3">
                {t.lastSyncCount}: <span className="font-medium">{config.lastSyncCount}</span> rates
              </div>
            )}

            {config.lastSyncMessage && config.lastSyncStatus === 'error' && (
              <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700 mb-3">
                {config.lastSyncMessage}
              </div>
            )}

            <Button
              onClick={() => fetchNow(config.provider)}
              disabled={fetching === config.provider}
              size="sm"
            >
              {fetching === config.provider ? (
                <>
                  <Spinner className="mr-2 h-3 w-3" />
                  Fetching...
                </>
              ) : (
                t.fetchNow
              )}
            </Button>
          </div>
        ))}

        {configs.length === 0 && (
          <div className="rounded border bg-background/70 p-6 text-center">
            <p className="text-sm text-muted-foreground mb-3">
              No currency providers configured yet.
            </p>
            <Button
              onClick={() => initializeMissingProviders(availableProviders)}
            >
              Initialize Providers
            </Button>
          </div>
        )}
      </div>
    </section>
  )
}
