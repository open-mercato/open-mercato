'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { GlobalSearchSection } from './sections/GlobalSearchSection'
import { FulltextSearchSection } from './sections/FulltextSearchSection'
import { VectorSearchSection } from './sections/VectorSearchSection'

// Types
type StrategyStatus = {
  id: string
  name: string
  priority: number
  available: boolean
}

type FulltextStats = {
  numberOfDocuments: number
  isIndexing: boolean
  fieldDistribution: Record<string, number>
}

type ReindexLock = {
  type: 'fulltext' | 'vector'
  action: string
  startedAt: string
  elapsedMinutes: number
}

type SearchSettings = {
  strategies: StrategyStatus[]
  fulltextConfigured: boolean
  fulltextStats: FulltextStats | null
  vectorConfigured: boolean
  tokensEnabled: boolean
  defaultStrategies: string[]
  reindexLock: ReindexLock | null
  fulltextReindexLock: ReindexLock | null
  vectorReindexLock: ReindexLock | null
}

type SettingsResponse = {
  settings?: SearchSettings
  error?: string
}

// Embedding types
type EmbeddingProviderId = 'openai' | 'google' | 'mistral' | 'cohere' | 'bedrock' | 'ollama'

type EmbeddingProviderConfig = {
  providerId: EmbeddingProviderId
  model: string
  dimension: number
  outputDimensionality?: number
  baseUrl?: string
  updatedAt: string
}

type EmbeddingSettings = {
  openaiConfigured: boolean
  autoIndexingEnabled: boolean
  autoIndexingLocked: boolean
  lockReason: string | null
  embeddingConfig: EmbeddingProviderConfig | null
  configuredProviders: EmbeddingProviderId[]
  indexedDimension: number | null
  reindexRequired: boolean
  documentCount: number | null
}

type EmbeddingSettingsResponse = {
  settings?: EmbeddingSettings
  error?: string
}

// Full-text search config types
type FulltextEnvVarStatus = {
  set: boolean
  hint: string
}

type FulltextOptionalEnvVarStatus = {
  set: boolean
  value?: string | boolean
  default?: string | boolean
  hint: string
}

type FulltextConfigResponse = {
  driver: 'meilisearch' | null
  configured: boolean
  envVars: {
    MEILISEARCH_HOST: FulltextEnvVarStatus
    MEILISEARCH_API_KEY: FulltextEnvVarStatus
  }
  optionalEnvVars: {
    MEILISEARCH_INDEX_PREFIX: FulltextOptionalEnvVarStatus
    SEARCH_EXCLUDE_ENCRYPTED_FIELDS: FulltextOptionalEnvVarStatus
  }
}

// Vector store driver types
type VectorDriverId = 'pgvector' | 'qdrant' | 'chromadb'

type VectorDriverEnvVar = {
  name: string
  set: boolean
  hint: string
}

type VectorDriverStatus = {
  id: VectorDriverId
  name: string
  configured: boolean
  implemented: boolean
  envVars: VectorDriverEnvVar[]
}

type VectorStoreConfigResponse = {
  currentDriver: VectorDriverId
  configured: boolean
  drivers: VectorDriverStatus[]
}

const normalizeErrorMessage = (error: unknown, fallback: string): string => {
  if (typeof error === 'string' && error.trim().length) return error.trim()
  if (error instanceof Error && error.message.trim().length) return error.message.trim()
  return fallback
}

export function SearchSettingsPageClient() {
  const t = useT()

  // Main settings state
  const [settings, setSettings] = React.useState<SearchSettings | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  // Embedding settings state
  const [embeddingSettings, setEmbeddingSettings] = React.useState<EmbeddingSettings | null>(null)
  const [embeddingLoading, setEmbeddingLoading] = React.useState(true)

  // Global search settings state
  const [globalSearchStrategies, setGlobalSearchStrategies] = React.useState<Set<string>>(() => new Set(['fulltext', 'vector', 'tokens']))
  const [globalSearchInitial, setGlobalSearchInitial] = React.useState<Set<string>>(() => new Set(['fulltext', 'vector', 'tokens']))
  const [globalSearchLoading, setGlobalSearchLoading] = React.useState(true)
  const [globalSearchSaving, setGlobalSearchSaving] = React.useState(false)

  // Full-text search config state
  const [fulltextConfig, setFulltextConfig] = React.useState<FulltextConfigResponse | null>(null)
  const [fulltextConfigLoading, setFulltextConfigLoading] = React.useState(true)

  // Vector store config state
  const [vectorStoreConfig, setVectorStoreConfig] = React.useState<VectorStoreConfigResponse | null>(null)
  const [vectorStoreConfigLoading, setVectorStoreConfigLoading] = React.useState(true)

  // Fetch main settings
  const fetchSettings = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const body = await readApiResultOrThrow<SettingsResponse>(
        '/api/search/settings',
        undefined,
        { errorMessage: t('search.settings.errorLabel', 'Failed to load settings'), allowNullResult: true },
      )
      if (body?.settings) {
        setSettings(body.settings)
      } else {
        setSettings({
          strategies: [],
          fulltextConfigured: false,
          fulltextStats: null,
          vectorConfigured: false,
          tokensEnabled: true,
          defaultStrategies: [],
          reindexLock: null,
          fulltextReindexLock: null,
          vectorReindexLock: null,
        })
      }
    } catch (err) {
      const message = normalizeErrorMessage(err, t('search.settings.errorLabel', 'Failed to load settings'))
      setError(message)
      flash(message, 'error')
    } finally {
      setLoading(false)
    }
  }, [t])

  React.useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

  // Lightweight stats refresh for polling during reindex
  const refreshStatsOnly = React.useCallback(async () => {
    try {
      const body = await readApiResultOrThrow<SettingsResponse>(
        '/api/search/settings',
        { cache: 'no-store' },
        { errorMessage: '', allowNullResult: true },
      )
      if (body?.settings) {
        setSettings(body.settings)
      }
    } catch {
      // Silently ignore errors during polling
    }
  }, [])

  // Lightweight embedding stats refresh
  const refreshEmbeddingStatsOnly = React.useCallback(async () => {
    try {
      const body = await readApiResultOrThrow<EmbeddingSettingsResponse>(
        '/api/search/embeddings',
        { cache: 'no-store' },
        { errorMessage: '', allowNullResult: true },
      )
      if (body?.settings) {
        setEmbeddingSettings(body.settings)
      }
    } catch {
      // Silently ignore errors during polling
    }
  }, [])

  // Polling logic
  const wasPollingRef = React.useRef(false)
  const pollCountAfterClearRef = React.useRef(0)

  React.useEffect(() => {
    const hasFulltextLock = settings?.fulltextReindexLock !== null
    const hasVectorLock = settings?.vectorReindexLock !== null

    const shouldPoll = hasFulltextLock || hasVectorLock ||
      (wasPollingRef.current && pollCountAfterClearRef.current < 3)

    if (!shouldPoll) {
      wasPollingRef.current = false
      pollCountAfterClearRef.current = 0
      return
    }

    if (hasFulltextLock || hasVectorLock) {
      wasPollingRef.current = true
      pollCountAfterClearRef.current = 0
    }

    const pollInterval = setInterval(() => {
      if (!hasFulltextLock && !hasVectorLock) {
        pollCountAfterClearRef.current += 1
      }

      refreshStatsOnly()
      if (hasVectorLock) {
        refreshEmbeddingStatsOnly()
      }
    }, 3000)

    return () => clearInterval(pollInterval)
  }, [settings?.fulltextReindexLock, settings?.vectorReindexLock, refreshStatsOnly, refreshEmbeddingStatsOnly])

  // Fetch embedding settings
  const fetchEmbeddingSettings = React.useCallback(async () => {
    setEmbeddingLoading(true)
    try {
      const body = await readApiResultOrThrow<EmbeddingSettingsResponse>(
        '/api/search/embeddings',
        undefined,
        { errorMessage: t('search.settings.errors.loadFailed', 'Failed to load settings'), allowNullResult: true },
      )
      if (body?.settings) {
        setEmbeddingSettings(body.settings)
      } else {
        setEmbeddingSettings({
          openaiConfigured: false,
          autoIndexingEnabled: true,
          autoIndexingLocked: false,
          lockReason: null,
          embeddingConfig: null,
          configuredProviders: [],
          indexedDimension: null,
          reindexRequired: false,
          documentCount: null,
        })
      }
    } catch {
      // Error already handled
    } finally {
      setEmbeddingLoading(false)
    }
  }, [t])

  React.useEffect(() => {
    fetchEmbeddingSettings()
  }, [fetchEmbeddingSettings])

  // Fetch global search settings
  const fetchGlobalSearchSettings = React.useCallback(async () => {
    setGlobalSearchLoading(true)
    try {
      const response = await fetch('/api/search/settings/global-search')
      if (response.ok) {
        const body = await response.json() as { enabledStrategies?: string[] }
        if (body.enabledStrategies && Array.isArray(body.enabledStrategies) && body.enabledStrategies.length > 0) {
          const strategies = new Set(body.enabledStrategies)
          setGlobalSearchStrategies(strategies)
          setGlobalSearchInitial(new Set(strategies))
        }
      }
    } catch {
      // Silently use defaults
    } finally {
      setGlobalSearchLoading(false)
    }
  }, [])

  React.useEffect(() => {
    fetchGlobalSearchSettings()
  }, [fetchGlobalSearchSettings])

  // Fetch fulltext config
  const fetchFulltextConfig = React.useCallback(async () => {
    setFulltextConfigLoading(true)
    try {
      const response = await fetch('/api/search/settings/fulltext')
      if (response.ok) {
        const body = await response.json() as FulltextConfigResponse
        setFulltextConfig(body)
      }
    } catch {
      // Silently use null
    } finally {
      setFulltextConfigLoading(false)
    }
  }, [])

  React.useEffect(() => {
    fetchFulltextConfig()
  }, [fetchFulltextConfig])

  // Fetch vector store config
  const fetchVectorStoreConfig = React.useCallback(async () => {
    setVectorStoreConfigLoading(true)
    try {
      const response = await fetch('/api/search/settings/vector-store')
      if (response.ok) {
        const body = await response.json() as VectorStoreConfigResponse
        setVectorStoreConfig(body)
      }
    } catch {
      // Silently use null
    } finally {
      setVectorStoreConfigLoading(false)
    }
  }, [])

  React.useEffect(() => {
    fetchVectorStoreConfig()
  }, [fetchVectorStoreConfig])

  // Global search settings handlers - auto-save on toggle
  const toggleGlobalSearchStrategy = React.useCallback(async (strategyId: string) => {
    const newStrategies = new Set(globalSearchStrategies)
    if (newStrategies.has(strategyId)) {
      if (newStrategies.size > 1) {
        newStrategies.delete(strategyId)
      } else {
        return
      }
    } else {
      newStrategies.add(strategyId)
    }

    setGlobalSearchStrategies(newStrategies)
    setGlobalSearchSaving(true)

    try {
      const response = await fetch('/api/search/settings/global-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabledStrategies: Array.from(newStrategies) }),
      })

      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error || t('search.settings.globalSearch.saveError', 'Failed to save settings'))
      }

      setGlobalSearchInitial(new Set(newStrategies))
    } catch (err) {
      setGlobalSearchStrategies(globalSearchInitial)
      flash(normalizeErrorMessage(err, t('search.settings.globalSearch.saveError', 'Failed to save settings')), 'error')
    } finally {
      setGlobalSearchSaving(false)
    }
  }, [globalSearchStrategies, globalSearchInitial, t])

  // Callbacks for section components
  const handleFulltextStatsUpdate = React.useCallback((stats: FulltextStats | null) => {
    setSettings(prev => prev ? { ...prev, fulltextStats: stats } : prev)
  }, [])

  const handleEmbeddingSettingsUpdate = React.useCallback((newSettings: EmbeddingSettings) => {
    setEmbeddingSettings(newSettings)
  }, [])

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">{t('search.settings.pageTitle', 'Search Settings')}</h1>
        <p className="text-muted-foreground">{t('search.settings.pageDescription', 'Configure search strategies and view their availability.')}</p>
      </div>

      {/* Section 1: Global Search Settings */}
      <GlobalSearchSection
        loading={globalSearchLoading}
        saving={globalSearchSaving}
        strategies={globalSearchStrategies}
        fulltextConfigured={settings?.fulltextConfigured ?? false}
        vectorConfigured={settings?.vectorConfigured ?? false}
        onToggleStrategy={toggleGlobalSearchStrategy}
      />

      {/* Section 2: Full-Text Search (with tabs) */}
      <FulltextSearchSection
        fulltextConfig={fulltextConfig}
        fulltextConfigLoading={fulltextConfigLoading}
        fulltextStats={settings?.fulltextStats ?? null}
        fulltextReindexLock={settings?.fulltextReindexLock ?? null}
        loading={loading}
        onStatsUpdate={handleFulltextStatsUpdate}
        onRefresh={fetchSettings}
      />

      {/* Section 3: Vector Search (with tabs) */}
      <VectorSearchSection
        embeddingSettings={embeddingSettings}
        embeddingLoading={embeddingLoading}
        vectorStoreConfig={vectorStoreConfig}
        vectorStoreConfigLoading={vectorStoreConfigLoading}
        vectorReindexLock={settings?.vectorReindexLock ?? null}
        onEmbeddingSettingsUpdate={handleEmbeddingSettingsUpdate}
        onRefreshEmbeddings={fetchEmbeddingSettings}
      />

      {/* Refresh Button */}
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fetchSettings()}
          disabled={loading}
        >
          {loading ? (
            <>
              <Spinner size="sm" className="mr-2" />
              {t('search.settings.loadingLabel', 'Loading settings...')}
            </>
          ) : (
            t('search.settings.refreshLabel', 'Refresh')
          )}
        </Button>
        {error && <span className="text-sm text-destructive">{error}</span>}
      </div>
    </div>
  )
}

export default SearchSettingsPageClient
