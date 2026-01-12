'use client'

import { useState, useEffect } from 'react'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

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
    baseCurrency: string
  }
}

export default function CurrencyFetchingConfig({ translations: t }: Props) {
  const [configs, setConfigs] = useState<FetchConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [fetching, setFetching] = useState<string | null>(null)
  const [initializing, setInitializing] = useState(false)
  const [baseCurrency, setBaseCurrency] = useState<string | null>(null)

  // Available providers that should be configured
  const availableProviders = ['NBP', 'Raiffeisen Bank Polska']

  useEffect(() => {
    loadConfigs()
    loadBaseCurrency()
  }, [])

  async function loadConfigs() {
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
  }

  async function loadBaseCurrency() {
    try {
      const { result } = await apiCall<{ items: Array<{ code: string }> }>('/api/currencies/currencies?isBase=true')
      if (result?.items && result.items.length > 0) {
        setBaseCurrency(result.items[0].code)
      }
    } catch (err: any) {
      console.error('Failed to load base currency:', err)
    }
  }

  async function initializeMissingProviders(providers: string[]) {
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
  }

  async function createProviderConfig(provider: string) {
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
  }

  async function toggleEnabled(configId: string, currentValue: boolean) {
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
  }

  async function updateSyncTime(configId: string, syncTime: string) {
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
  }

  async function fetchNow(provider: string) {
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
  }

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
      <Page>
        <PageHeader title={t.title} />
        <PageBody>
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
            <span className="ml-3">
              {initializing ? 'Initializing providers...' : t.loading}
            </span>
          </div>
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageHeader title={t.title} />
      <PageBody>
        <div className="space-y-6">
          {configs.map((config) => (
            <div
              key={config.id}
              className="border rounded-lg p-6 bg-white shadow-sm"
            >
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h3 className="text-lg font-semibold">
                    {getProviderName(config.provider)}
                  </h3>
                  <p className="text-sm text-gray-600 mt-1">
                    {getProviderDescription(config.provider)}
                  </p>
                  {baseCurrency && (
                    <div className="mt-2 inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium bg-indigo-100 text-indigo-800">
                      {t.baseCurrency}: {baseCurrency}
                    </div>
                  )}
                </div>

                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.isEnabled}
                    onChange={() => toggleEnabled(config.id, config.isEnabled)}
                    className="w-5 h-5"
                  />
                  <span className="font-medium">
                    {config.isEnabled ? t.enabled : t.disabled}
                  </span>
                </label>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t.syncTime}
                  </label>
                  <input
                    type="time"
                    value={config.syncTime || '09:00'}
                    onChange={(e) => updateSyncTime(config.id, e.target.value)}
                    className="border rounded px-3 py-2 w-full"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t.lastSync}
                  </label>
                  <div className="flex items-center space-x-2">
                    <span className="text-sm text-gray-600">
                      {formatLastSync(config.lastSyncAt)}
                    </span>
                    {getStatusBadge(config.lastSyncStatus)}
                  </div>
                </div>
              </div>

              {config.lastSyncCount !== null && (
                <div className="text-sm text-gray-600 mb-4">
                  {t.lastSyncCount}: <strong>{config.lastSyncCount}</strong>{' '}
                  rates
                </div>
              )}

              {config.lastSyncMessage &&
                config.lastSyncStatus === 'error' && (
                  <div className="text-sm text-red-600 mb-4 bg-red-50 p-2 rounded">
                    {config.lastSyncMessage}
                  </div>
                )}

              <button
                onClick={() => fetchNow(config.provider)}
                disabled={fetching === config.provider}
                className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
              >
                {fetching === config.provider ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Fetching...
                  </>
                ) : (
                  t.fetchNow
                )}
              </button>
            </div>
          ))}

          {configs.length === 0 && (
            <div className="text-center py-12">
              <div className="text-gray-500 mb-4">
                No currency providers configured yet.
              </div>
              <button
                onClick={() => initializeMissingProviders(availableProviders)}
                className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700"
              >
                Initialize Providers
              </button>
            </div>
          )}
        </div>
      </PageBody>
    </Page>
  )
}
