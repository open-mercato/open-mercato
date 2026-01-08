'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { Label } from '@open-mercato/ui/primitives/label'
import { Spinner } from '@open-mercato/ui/primitives/spinner'

type StrategyStatus = {
  id: string
  name: string
  priority: number
  available: boolean
}

type MeilisearchStats = {
  numberOfDocuments: number
  isIndexing: boolean
  fieldDistribution: Record<string, number>
}

type SearchSettings = {
  strategies: StrategyStatus[]
  meilisearchConfigured: boolean
  meilisearchStats: MeilisearchStats | null
  vectorConfigured: boolean
  tokensEnabled: boolean
  defaultStrategies: string[]
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

type EmbeddingModelInfo = {
  id: string
  name: string
  dimension: number
  configurableDimension?: boolean
  minDimension?: number
  maxDimension?: number
}

type EmbeddingProviderInfo = {
  name: string
  envKeyRequired: string
  defaultModel: string
  models: EmbeddingModelInfo[]
}

const EMBEDDING_PROVIDERS: Record<EmbeddingProviderId, EmbeddingProviderInfo> = {
  openai: {
    name: 'OpenAI',
    envKeyRequired: 'OPENAI_API_KEY',
    defaultModel: 'text-embedding-3-small',
    models: [
      { id: 'text-embedding-3-small', name: 'text-embedding-3-small', dimension: 1536 },
      { id: 'text-embedding-3-large', name: 'text-embedding-3-large', dimension: 3072, configurableDimension: true, minDimension: 256, maxDimension: 3072 },
      { id: 'text-embedding-ada-002', name: 'text-embedding-ada-002', dimension: 1536 },
    ],
  },
  google: {
    name: 'Google Generative AI',
    envKeyRequired: 'GOOGLE_GENERATIVE_AI_API_KEY',
    defaultModel: 'text-embedding-004',
    models: [
      { id: 'text-embedding-004', name: 'text-embedding-004', dimension: 768, configurableDimension: true, minDimension: 1, maxDimension: 768 },
      { id: 'embedding-001', name: 'embedding-001', dimension: 768 },
    ],
  },
  mistral: {
    name: 'Mistral',
    envKeyRequired: 'MISTRAL_API_KEY',
    defaultModel: 'mistral-embed',
    models: [
      { id: 'mistral-embed', name: 'mistral-embed', dimension: 1024 },
    ],
  },
  cohere: {
    name: 'Cohere',
    envKeyRequired: 'COHERE_API_KEY',
    defaultModel: 'embed-english-v3.0',
    models: [
      { id: 'embed-english-v3.0', name: 'embed-english-v3.0', dimension: 1024 },
      { id: 'embed-multilingual-v3.0', name: 'embed-multilingual-v3.0', dimension: 1024 },
      { id: 'embed-english-light-v3.0', name: 'embed-english-light-v3.0', dimension: 384 },
      { id: 'embed-multilingual-light-v3.0', name: 'embed-multilingual-light-v3.0', dimension: 384 },
    ],
  },
  bedrock: {
    name: 'Amazon Bedrock',
    envKeyRequired: 'AWS_ACCESS_KEY_ID',
    defaultModel: 'amazon.titan-embed-text-v2:0',
    models: [
      { id: 'amazon.titan-embed-text-v2:0', name: 'Titan Embed Text v2', dimension: 1024, configurableDimension: true, minDimension: 256, maxDimension: 1024 },
      { id: 'amazon.titan-embed-text-v1', name: 'Titan Embed Text v1', dimension: 1536 },
      { id: 'cohere.embed-english-v3', name: 'Cohere Embed English v3', dimension: 1024 },
      { id: 'cohere.embed-multilingual-v3', name: 'Cohere Embed Multilingual v3', dimension: 1024 },
    ],
  },
  ollama: {
    name: 'Ollama (Local)',
    envKeyRequired: 'OLLAMA_BASE_URL',
    defaultModel: 'nomic-embed-text',
    models: [
      { id: 'nomic-embed-text', name: 'nomic-embed-text', dimension: 768 },
      { id: 'mxbai-embed-large', name: 'mxbai-embed-large', dimension: 1024 },
      { id: 'all-minilm', name: 'all-minilm', dimension: 384 },
      { id: 'snowflake-arctic-embed', name: 'snowflake-arctic-embed', dimension: 1024 },
    ],
  },
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
}

type EmbeddingSettingsResponse = {
  settings?: EmbeddingSettings
  error?: string
}

type ReindexResponse = {
  ok: boolean
  action: string
  entityId?: string | null
  result?: {
    entitiesProcessed: number
    recordsIndexed: number
    errors?: Array<{ entityId: string; error: string }>
  }
  stats?: MeilisearchStats | null
  error?: string
}

type ReindexAction = 'clear' | 'recreate' | 'reindex'

const normalizeErrorMessage = (error: unknown, fallback: string): string => {
  if (typeof error === 'string' && error.trim().length) return error.trim()
  if (error instanceof Error && error.message.trim().length) return error.message.trim()
  return fallback
}

export function SearchSettingsPageClient() {
  const t = useT()
  const [settings, setSettings] = React.useState<SearchSettings | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [reindexing, setReindexing] = React.useState<ReindexAction | null>(null)
  const [showReindexDialog, setShowReindexDialog] = React.useState<ReindexAction | null>(null)

  // Embedding settings state
  const [embeddingSettings, setEmbeddingSettings] = React.useState<EmbeddingSettings | null>(null)
  const [embeddingLoading, setEmbeddingLoading] = React.useState(true)
  const [embeddingSaving, setEmbeddingSaving] = React.useState(false)
  const autoIndexingPreviousRef = React.useRef<boolean>(true)

  // Staged embedding selection (not yet applied)
  const [selectedProvider, setSelectedProvider] = React.useState<EmbeddingProviderId | null>(null)
  const [selectedModel, setSelectedModel] = React.useState<string | null>(null)
  const [customModelName, setCustomModelName] = React.useState<string>('')
  const [customDimension, setCustomDimension] = React.useState<number>(768)

  const [pendingEmbeddingConfig, setPendingEmbeddingConfig] = React.useState<EmbeddingProviderConfig | null>(null)
  const [showEmbeddingConfirmDialog, setShowEmbeddingConfirmDialog] = React.useState(false)

  // Vector reindex state
  const [vectorReindexing, setVectorReindexing] = React.useState(false)
  const [showVectorReindexDialog, setShowVectorReindexDialog] = React.useState(false)

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
          meilisearchConfigured: false,
          meilisearchStats: null,
          vectorConfigured: false,
          tokensEnabled: true,
          defaultStrategies: [],
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
        autoIndexingPreviousRef.current = body.settings.autoIndexingEnabled
        setSelectedProvider(null)
        setSelectedModel(null)
      } else {
        autoIndexingPreviousRef.current = true
        setEmbeddingSettings({
          openaiConfigured: false,
          autoIndexingEnabled: true,
          autoIndexingLocked: false,
          lockReason: null,
          embeddingConfig: null,
          configuredProviders: [],
          indexedDimension: null,
          reindexRequired: false,
        })
      }
    } catch {
      // Error already handled by readApiResultOrThrow
    } finally {
      setEmbeddingLoading(false)
    }
  }, [t])

  React.useEffect(() => {
    fetchEmbeddingSettings()
  }, [fetchEmbeddingSettings])

  // Update auto-indexing
  const updateAutoIndexing = React.useCallback(async (nextValue: boolean) => {
    setEmbeddingSettings((prev) => {
      autoIndexingPreviousRef.current = prev?.autoIndexingEnabled ?? true
      if (prev) return { ...prev, autoIndexingEnabled: nextValue }
      return {
        openaiConfigured: false,
        autoIndexingEnabled: nextValue,
        autoIndexingLocked: false,
        lockReason: null,
        embeddingConfig: null,
        configuredProviders: [],
        indexedDimension: null,
        reindexRequired: false,
      }
    })
    setEmbeddingSaving(true)
    try {
      const body = await readApiResultOrThrow<EmbeddingSettingsResponse>(
        '/api/search/embeddings',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ autoIndexingEnabled: nextValue }),
        },
        { errorMessage: t('search.settings.errors.saveFailed', 'Failed to save settings'), allowNullResult: true },
      )
      if (body?.settings) {
        setEmbeddingSettings(body.settings)
        autoIndexingPreviousRef.current = body.settings.autoIndexingEnabled
      }
      flash(t('search.settings.messages.saved', 'Settings saved'), 'success')
    } catch {
      setEmbeddingSettings((prev) => (prev ? { ...prev, autoIndexingEnabled: autoIndexingPreviousRef.current } : prev))
    } finally {
      setEmbeddingSaving(false)
    }
  }, [t])

  // Embedding provider handlers
  const handleProviderChange = (providerId: EmbeddingProviderId) => {
    setSelectedProvider(providerId)
    setSelectedModel(null)
    setCustomModelName('')
    setCustomDimension(768)
  }

  const handleModelChange = (modelId: string) => {
    setSelectedModel(modelId)
  }

  const handleApplyEmbeddingChanges = () => {
    const newProviderId = selectedProvider ?? embeddingSettings?.embeddingConfig?.providerId ?? 'openai'
    const newProviderInfo = EMBEDDING_PROVIDERS[newProviderId]
    const newModelId = selectedModel ?? (selectedProvider ? newProviderInfo.defaultModel : embeddingSettings?.embeddingConfig?.model ?? newProviderInfo.defaultModel)

    let modelName: string
    let dimension: number

    if (newModelId === 'custom') {
      modelName = customModelName.trim()
      dimension = customDimension
      if (!modelName) {
        flash(t('search.settings.errors.modelRequired', 'Please enter a model name'), 'error')
        return
      }
      if (dimension <= 0) {
        flash(t('search.settings.errors.dimensionRequired', 'Please enter a valid dimension'), 'error')
        return
      }
    } else {
      const newModel = newProviderInfo.models.find((m) => m.id === newModelId) ?? newProviderInfo.models[0]
      modelName = newModel.id
      dimension = newModel.dimension
    }

    const newConfig: EmbeddingProviderConfig = {
      providerId: newProviderId,
      model: modelName,
      dimension,
      updatedAt: new Date().toISOString(),
    }

    if (embeddingSettings?.indexedDimension || embeddingSettings?.embeddingConfig) {
      setPendingEmbeddingConfig(newConfig)
      setShowEmbeddingConfirmDialog(true)
    } else {
      applyEmbeddingConfig(newConfig)
    }
  }

  const handleCancelEmbeddingSelection = () => {
    setSelectedProvider(null)
    setSelectedModel(null)
    setCustomModelName('')
    setCustomDimension(768)
  }

  const applyEmbeddingConfig = async (config: EmbeddingProviderConfig) => {
    setEmbeddingSaving(true)
    setShowEmbeddingConfirmDialog(false)
    setPendingEmbeddingConfig(null)

    try {
      await readApiResultOrThrow<EmbeddingSettingsResponse>(
        '/api/search/embeddings',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ embeddingConfig: config }),
        },
        { errorMessage: t('search.settings.errors.saveFailed', 'Failed to save settings'), allowNullResult: true },
      )
      setSelectedProvider(null)
      setSelectedModel(null)
      flash(t('search.settings.messages.providerSaved', 'Embedding provider saved'), 'success')
      await fetchEmbeddingSettings()
    } catch {
      // Error handled by readApiResultOrThrow
    } finally {
      setEmbeddingSaving(false)
    }
  }

  const handleEmbeddingConfirmChange = () => {
    if (pendingEmbeddingConfig) {
      applyEmbeddingConfig(pendingEmbeddingConfig)
    }
  }

  const handleEmbeddingCancelChange = () => {
    setShowEmbeddingConfirmDialog(false)
    setPendingEmbeddingConfig(null)
  }

  // Vector reindex handlers
  const handleVectorReindexClick = () => {
    setShowVectorReindexDialog(true)
  }

  const handleVectorReindexConfirm = async () => {
    setShowVectorReindexDialog(false)
    setVectorReindexing(true)
    try {
      await readApiResultOrThrow<{ ok: boolean }>(
        '/api/search/embeddings/reindex',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ purgeFirst: true }),
        },
        { errorMessage: t('search.settings.errors.reindexFailed', 'Reindex failed'), allowNullResult: true },
      )
      flash(t('search.settings.messages.reindexStarted', 'Reindex started'), 'success')
    } catch {
      // Error handled by readApiResultOrThrow
    } finally {
      setVectorReindexing(false)
    }
  }

  const handleVectorReindexCancel = () => {
    setShowVectorReindexDialog(false)
  }

  // Computed embedding values
  const savedProvider = embeddingSettings?.embeddingConfig?.providerId ?? 'openai'
  const savedProviderInfo = EMBEDDING_PROVIDERS[savedProvider]
  const savedModel = embeddingSettings?.embeddingConfig?.model ?? savedProviderInfo.defaultModel
  const savedDimension = embeddingSettings?.embeddingConfig?.dimension ?? savedProviderInfo.models[0]?.dimension ?? 768

  const savedModelIsPredefined = savedProviderInfo.models.some((m) => m.id === savedModel)
  const savedCustomModel = !savedModelIsPredefined && savedModel ? { id: savedModel, name: savedModel, dimension: savedDimension } : null

  const displayProvider = selectedProvider ?? savedProvider
  const displayProviderInfo = EMBEDDING_PROVIDERS[displayProvider]
  const displayModel = selectedModel ?? (selectedProvider ? displayProviderInfo.defaultModel : savedModel)
  const isCustomModel = displayModel === 'custom'

  const displayModelIsSavedCustom = !isCustomModel && displayProvider === savedProvider && savedCustomModel && displayModel === savedCustomModel.id

  const displayModelInfo = isCustomModel
    ? null
    : displayModelIsSavedCustom
      ? savedCustomModel
      : displayProviderInfo.models.find((m) => m.id === displayModel) ?? displayProviderInfo.models[0]
  const displayDimension = isCustomModel ? customDimension : (displayModelInfo?.dimension ?? 768)

  const hasUnsavedEmbeddingChanges = (selectedProvider !== null && selectedProvider !== savedProvider) ||
    (selectedModel !== null && selectedModel !== savedModel) ||
    (selectedProvider !== null && selectedModel === null && displayProviderInfo.defaultModel !== savedModel) ||
    (isCustomModel && (customModelName.trim() !== '' || customDimension !== 768))

  const isEmbeddingConfigured = embeddingSettings?.configuredProviders?.includes(savedProvider)
  const providerOptions: EmbeddingProviderId[] = ['openai', 'google', 'mistral', 'cohere', 'bedrock', 'ollama']

  const autoIndexingChecked = embeddingSettings ? embeddingSettings.autoIndexingEnabled : true
  const autoIndexingDisabled = embeddingLoading || embeddingSaving || Boolean(embeddingSettings?.autoIndexingLocked)

  const handleReindexClick = (action: ReindexAction) => {
    setShowReindexDialog(action)
  }

  const handleReindexCancel = () => {
    setShowReindexDialog(null)
  }

  const handleReindexConfirm = React.useCallback(async () => {
    const action = showReindexDialog
    if (!action) return

    setShowReindexDialog(null)
    setReindexing(action)

    try {
      const response = await fetch('/api/search/reindex', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })

      const body = await response.json() as ReindexResponse

      if (!response.ok || body.error) {
        throw new Error(body.error || t('search.settings.reindexErrorLabel', 'Failed to reindex'))
      }

      // Update stats from response
      if (body.stats) {
        setSettings(prev => prev ? { ...prev, meilisearchStats: body.stats ?? null } : prev)
      }

      const successLabel = t('search.settings.reindexSuccessLabel', 'Operation completed successfully')
      const successMessage = action === 'reindex' && body.result
        ? `${successLabel}: ${body.result.recordsIndexed} documents indexed`
        : successLabel

      flash(successMessage, 'success')
      await fetchSettings()
    } catch (err) {
      const message = normalizeErrorMessage(err, t('search.settings.reindexErrorLabel', 'Failed to reindex'))
      flash(message, 'error')
    } finally {
      setReindexing(null)
    }
  }, [fetchSettings, showReindexDialog, t])

  const getDialogContent = (action: ReindexAction) => {
    switch (action) {
      case 'clear':
        return {
          title: t('search.settings.clearIndexDialogTitle', 'Clear Index'),
          description: t('search.settings.clearIndexDialogDescription', 'This will remove all documents from the Meilisearch index but keep the index settings.'),
          warning: t('search.settings.clearIndexDialogWarning', 'Search will not work until documents are re-indexed.'),
          confirmLabel: t('search.settings.clearIndexLabel', 'Clear Index'),
        }
      case 'recreate':
        return {
          title: t('search.settings.recreateIndexDialogTitle', 'Recreate Index'),
          description: t('search.settings.recreateIndexDialogDescription', 'This will delete the index completely and recreate it with fresh settings.'),
          warning: t('search.settings.recreateIndexDialogWarning', 'All indexed documents will be permanently removed.'),
          confirmLabel: t('search.settings.recreateIndexLabel', 'Recreate Index'),
        }
      case 'reindex':
        return {
          title: t('search.settings.fullReindexDialogTitle', 'Full Reindex'),
          description: t('search.settings.fullReindexDialogDescription', 'This will recreate the index and re-index all data from the database.'),
          warning: t('search.settings.fullReindexDialogWarning', 'This operation may take a while depending on the amount of data.'),
          confirmLabel: t('search.settings.fullReindexLabel', 'Full Reindex'),
        }
    }
  }

  const getStrategyIcon = (strategyId: string) => {
    switch (strategyId) {
      case 'meilisearch':
        return (
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
        )
      case 'vector':
        return (
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
          </svg>
        )
      case 'tokens':
        return (
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
          </svg>
        )
      default:
        return (
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        )
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">{t('search.settings.pageTitle', 'Search Settings')}</h1>
        <p className="text-muted-foreground">{t('search.settings.pageDescription', 'Configure search strategies and view their availability.')}</p>
      </div>

      {/* Configuration Status Card */}
      <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="text-lg font-semibold mb-2">{t('search.settings.configurationTitle', 'Configuration Status')}</h2>
        <p className="text-sm text-muted-foreground mb-4">{t('search.settings.configurationDescription', 'Overview of search provider configurations.')}</p>

        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Spinner size="sm" />
            <span>{t('search.settings.loadingLabel', 'Loading settings...')}</span>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            {/* Meilisearch */}
            <div className="rounded-md border border-border p-4">
              <div className="flex items-center gap-3 mb-2">
                <div className={`flex h-8 w-8 items-center justify-center rounded-full ${
                  settings?.meilisearchConfigured
                    ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400'
                    : 'bg-muted text-muted-foreground'
                }`}>
                  {getStrategyIcon('meilisearch')}
                </div>
                <div>
                  <p className="font-medium">{t('search.settings.meilisearchLabel', 'Meilisearch')}</p>
                  <p className={`text-xs ${
                    settings?.meilisearchConfigured
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-muted-foreground'
                  }`}>
                    {settings?.meilisearchConfigured ? t('search.settings.configuredLabel', 'Configured') : t('search.settings.notConfiguredLabel', 'Not Configured')}
                  </p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{t('search.settings.meilisearchHint', 'Set MEILISEARCH_HOST environment variable to enable.')}</p>
            </div>

            {/* Vector Search */}
            <div className="rounded-md border border-border p-4">
              <div className="flex items-center gap-3 mb-2">
                <div className={`flex h-8 w-8 items-center justify-center rounded-full ${
                  settings?.vectorConfigured
                    ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400'
                    : 'bg-muted text-muted-foreground'
                }`}>
                  {getStrategyIcon('vector')}
                </div>
                <div>
                  <p className="font-medium">{t('search.settings.vectorSearchLabel', 'Vector Search')}</p>
                  <p className={`text-xs ${
                    settings?.vectorConfigured
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-muted-foreground'
                  }`}>
                    {settings?.vectorConfigured ? t('search.settings.configuredLabel', 'Configured') : t('search.settings.notConfiguredLabel', 'Not Configured')}
                  </p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{t('search.settings.vectorHint', 'Configure an embedding provider (OpenAI, Google, etc.) to enable.')}</p>
            </div>

            {/* Token Search */}
            <div className="rounded-md border border-border p-4">
              <div className="flex items-center gap-3 mb-2">
                <div className={`flex h-8 w-8 items-center justify-center rounded-full ${
                  settings?.tokensEnabled
                    ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400'
                    : 'bg-muted text-muted-foreground'
                }`}>
                  {getStrategyIcon('tokens')}
                </div>
                <div>
                  <p className="font-medium">{t('search.settings.tokenSearchLabel', 'Token Search')}</p>
                  <p className={`text-xs ${
                    settings?.tokensEnabled
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-muted-foreground'
                  }`}>
                    {settings?.tokensEnabled ? t('search.settings.enabledLabel', 'Enabled') : t('search.settings.disabledLabel', 'Disabled')}
                  </p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{t('search.settings.tokenHint', 'Built-in token search using PostgreSQL.')}</p>
            </div>
          </div>
        )}
      </div>

      {/* Meilisearch Index Management Card */}
      {settings?.meilisearchConfigured && (
        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <h2 className="text-lg font-semibold mb-2">{t('search.settings.meilisearchIndexTitle', 'Meilisearch Index')}</h2>
          <p className="text-sm text-muted-foreground mb-4">{t('search.settings.meilisearchIndexDescription', 'Manage the Meilisearch index for this tenant.')}</p>

          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Spinner size="sm" />
              <span>{t('search.settings.loadingLabel', 'Loading settings...')}</span>
            </div>
          ) : settings?.meilisearchStats ? (
            <div className="space-y-4">
              {/* Stats */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-md border border-border p-4">
                  <p className="text-sm text-muted-foreground">{t('search.settings.documentsLabel', 'Documents')}</p>
                  <p className="text-2xl font-bold">{settings.meilisearchStats.numberOfDocuments.toLocaleString()}</p>
                </div>
                <div className="rounded-md border border-border p-4">
                  <p className="text-sm text-muted-foreground">{t('search.settings.indexingLabel', 'Indexing')}</p>
                  <p className={`text-lg font-medium ${
                    settings.meilisearchStats.isIndexing
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-emerald-600 dark:text-emerald-400'
                  }`}>
                    {settings.meilisearchStats.isIndexing ? t('search.settings.indexingInProgressLabel', 'In Progress') : t('search.settings.indexingIdleLabel', 'Idle')}
                  </p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-wrap gap-3 pt-2">
                <div className="flex flex-col">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleReindexClick('clear')}
                    disabled={reindexing !== null}
                  >
                    {reindexing === 'clear' ? (
                      <>
                        <Spinner size="sm" className="mr-2" />
                        {t('search.settings.processingLabel', 'Processing...')}
                      </>
                    ) : (
                      t('search.settings.clearIndexLabel', 'Clear Index')
                    )}
                  </Button>
                  <span className="text-xs text-muted-foreground mt-1">{t('search.settings.clearIndexDescription', 'Remove all documents but keep index settings')}</span>
                </div>
                <div className="flex flex-col">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleReindexClick('recreate')}
                    disabled={reindexing !== null}
                  >
                    {reindexing === 'recreate' ? (
                      <>
                        <Spinner size="sm" className="mr-2" />
                        {t('search.settings.processingLabel', 'Processing...')}
                      </>
                    ) : (
                      t('search.settings.recreateIndexLabel', 'Recreate Index')
                    )}
                  </Button>
                  <span className="text-xs text-muted-foreground mt-1">{t('search.settings.recreateIndexDescription', 'Delete and recreate the index with fresh settings')}</span>
                </div>
                <div className="flex flex-col">
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    onClick={() => handleReindexClick('reindex')}
                    disabled={reindexing !== null}
                  >
                    {reindexing === 'reindex' ? (
                      <>
                        <Spinner size="sm" className="mr-2" />
                        {t('search.settings.processingLabel', 'Processing...')}
                      </>
                    ) : (
                      t('search.settings.fullReindexLabel', 'Full Reindex')
                    )}
                  </Button>
                  <span className="text-xs text-muted-foreground mt-1">{t('search.settings.fullReindexDescription', 'Recreate index and re-index all data from database')}</span>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('search.settings.noIndexLabel', 'No index found for this tenant')}</p>
          )}
        </div>
      )}

      {/* Vector Search Settings Card */}
      <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="text-lg font-semibold mb-2">{t('search.settings.provider.title', 'Embedding Provider')}</h2>
        <p className="text-sm text-muted-foreground mb-4">{t('search.settings.vectorSettingsDescription', 'Configure the embedding provider for vector search.')}</p>

        {embeddingLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Spinner size="sm" />
            <span>{t('search.settings.loadingLabel', 'Loading settings...')}</span>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            {/* Embedding Provider Card */}
            <div className="rounded-md border border-border p-4">
              <h3 className="text-sm font-semibold mb-3">{t('search.settings.provider.label', 'Provider')}</h3>
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="embedding-provider" className="text-xs font-medium">
                    {t('search.settings.provider.label', 'Provider')}
                  </Label>
                  <select
                    id="embedding-provider"
                    className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
                    value={displayProvider}
                    onChange={(e) => handleProviderChange(e.target.value as EmbeddingProviderId)}
                    disabled={embeddingLoading || embeddingSaving}
                  >
                    {providerOptions.map((providerId) => {
                      const info = EMBEDDING_PROVIDERS[providerId]
                      const providerConfigured = embeddingSettings?.configuredProviders?.includes(providerId)
                      return (
                        <option key={providerId} value={providerId} disabled={!providerConfigured}>
                          {info.name} {!providerConfigured && `(${t('search.settings.provider.notConfigured', 'not configured')})`}
                        </option>
                      )
                    })}
                  </select>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="embedding-model" className="text-xs font-medium">
                    {t('search.settings.model.label', 'Model')}
                  </Label>
                  <select
                    id="embedding-model"
                    className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
                    value={displayModel}
                    onChange={(e) => handleModelChange(e.target.value)}
                    disabled={embeddingLoading || embeddingSaving}
                  >
                    {savedCustomModel && displayProvider === savedProvider && (
                      <option key={savedCustomModel.id} value={savedCustomModel.id}>
                        {savedCustomModel.name} ({savedCustomModel.dimension}d)
                      </option>
                    )}
                    {displayProviderInfo.models.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.name} ({model.dimension}d)
                      </option>
                    ))}
                    <option value="custom">{t('search.settings.model.custom', 'Custom...')}</option>
                  </select>
                </div>

                {isCustomModel && (
                  <div className="space-y-2 p-2 rounded border border-input bg-muted/30">
                    <input
                      type="text"
                      className="w-full rounded border border-input bg-background px-2 py-1 text-sm"
                      value={customModelName}
                      onChange={(e) => setCustomModelName(e.target.value)}
                      placeholder={t('search.settings.model.namePlaceholder', 'Model name')}
                      disabled={embeddingLoading || embeddingSaving}
                    />
                    <input
                      type="number"
                      className="w-full rounded border border-input bg-background px-2 py-1 text-sm"
                      value={customDimension}
                      onChange={(e) => setCustomDimension(Number(e.target.value) || 768)}
                      placeholder="768"
                      min={1}
                      disabled={embeddingLoading || embeddingSaving}
                    />
                  </div>
                )}

                <div className="text-xs text-muted-foreground">
                  {t('search.settings.dimension.label', 'Dimensions')}: {displayDimension}
                  {embeddingSettings?.indexedDimension && embeddingSettings.indexedDimension !== displayDimension && (
                    <span className="ml-1 text-amber-600 dark:text-amber-400">
                      ({t('search.settings.dimension.mismatch', 'mismatch')}: {embeddingSettings.indexedDimension})
                    </span>
                  )}
                </div>

                {hasUnsavedEmbeddingChanges && (
                  <div className="flex gap-2">
                    <Button type="button" variant="default" size="sm" onClick={handleApplyEmbeddingChanges} disabled={embeddingLoading || embeddingSaving}>
                      {t('search.settings.actions.apply', 'Apply')}
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={handleCancelEmbeddingSelection} disabled={embeddingLoading || embeddingSaving}>
                      {t('search.settings.actions.cancel', 'Cancel')}
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {/* Auto-Indexing Card */}
            <div className="rounded-md border border-border p-4">
              <h3 className="text-sm font-semibold mb-3">{t('search.settings.status.title', 'Auto-Indexing')}</h3>
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <input
                    id="search-auto-indexing"
                    type="checkbox"
                    className="h-4 w-4 rounded border-muted-foreground/40"
                    checked={autoIndexingChecked}
                    onChange={(event) => updateAutoIndexing(event.target.checked)}
                    disabled={autoIndexingDisabled}
                  />
                  <Label htmlFor="search-auto-indexing" className="text-sm">
                    {t('search.settings.autoIndexing.label', 'Enable auto-indexing')}
                  </Label>
                  {embeddingSaving ? <Spinner size="sm" className="text-muted-foreground" /> : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('search.settings.autoIndexing.description', 'Automatically index new and updated records for vector search.')}
                </p>
                {embeddingSettings?.autoIndexingLocked && (
                  <p className="text-xs text-destructive">
                    {t('search.settings.autoIndexing.locked', 'Disabled via environment variable.')}
                  </p>
                )}
              </div>
            </div>

            {/* Vector Reindex Card */}
            <div className="rounded-md border border-border p-4">
              <h3 className="text-sm font-semibold mb-3">{t('search.settings.reindex.title', 'Reindex Data')}</h3>
              <p className="text-xs text-muted-foreground mb-3">
                {t('search.settings.reindex.description', 'Rebuild vector embeddings for all indexed entities.')}
              </p>
              <div className="flex items-center gap-2 p-2 rounded bg-amber-50 dark:bg-amber-900/20 mb-3">
                <svg className="h-4 w-4 text-amber-600 dark:text-amber-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <p className="text-xs text-amber-800 dark:text-amber-200">
                  {t('search.settings.reindex.warning', 'This may take a while for large datasets.')}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleVectorReindexClick}
                disabled={embeddingLoading || embeddingSaving || vectorReindexing || !isEmbeddingConfigured}
              >
                {vectorReindexing ? (
                  <>
                    <Spinner size="sm" className="mr-2" />
                    {t('search.settings.reindex.running', 'Reindexing...')}
                  </>
                ) : (
                  t('search.settings.reindex.button', 'Start Reindex')
                )}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
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

      {/* Reindex Confirmation Dialog */}
      {showReindexDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 max-w-md rounded-lg border border-border bg-card p-6 shadow-lg">
            <div className="flex items-start gap-3 mb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/40">
                <svg className="h-5 w-5 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold">{getDialogContent(showReindexDialog).title}</h3>
                <p className="text-sm text-muted-foreground mt-1">{getDialogContent(showReindexDialog).description}</p>
              </div>
            </div>

            <div className="mb-4 p-3 rounded-md bg-amber-50 dark:bg-amber-900/20">
              <div className="flex items-start gap-2">
                <svg className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <p className="text-sm text-amber-800 dark:text-amber-200">{getDialogContent(showReindexDialog).warning}</p>
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={handleReindexCancel}
              >
                {t('search.settings.cancelLabel', 'Cancel')}
              </Button>
              <Button
                type="button"
                variant={showReindexDialog === 'reindex' ? 'default' : 'destructive'}
                onClick={handleReindexConfirm}
              >
                {getDialogContent(showReindexDialog).confirmLabel}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Vector Reindex Confirmation Dialog */}
      {showVectorReindexDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 max-w-md rounded-lg border border-border bg-card p-6 shadow-lg">
            <h3 className="text-lg font-semibold mb-2">{t('search.settings.reindex.confirmTitle', 'Confirm Reindex')}</h3>
            <p className="text-sm text-muted-foreground mb-4">
              {t('search.settings.reindex.confirmDescription', 'This will rebuild all vector embeddings. Existing data will be purged first.')}
            </p>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={handleVectorReindexCancel}>
                {t('search.settings.actions.cancel', 'Cancel')}
              </Button>
              <Button type="button" variant="default" onClick={handleVectorReindexConfirm}>
                {t('search.settings.reindex.confirmButton', 'Start Reindex')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Embedding Provider Change Confirmation Dialog */}
      {showEmbeddingConfirmDialog && pendingEmbeddingConfig && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 max-w-lg rounded-lg border border-border bg-card p-6 shadow-lg">
            <h3 className="text-lg font-semibold mb-2">{t('search.settings.change.title', 'Confirm Provider Change')}</h3>
            <p className="text-sm text-muted-foreground mb-4">
              {t('search.settings.change.description', 'Changing the embedding provider will require reindexing all data.')}
            </p>
            <div className="mb-4 p-3 rounded-md bg-muted/50 text-sm">
              <p className="font-medium">
                {embeddingSettings?.embeddingConfig
                  ? `${EMBEDDING_PROVIDERS[embeddingSettings.embeddingConfig.providerId].name} (${embeddingSettings.embeddingConfig.model})`
                  : 'Default'}
                {' → '}
                {EMBEDDING_PROVIDERS[pendingEmbeddingConfig.providerId].name} ({pendingEmbeddingConfig.model})
              </p>
              <p className="text-muted-foreground">
                {embeddingSettings?.indexedDimension ?? 'N/A'} → {pendingEmbeddingConfig.dimension} dimensions
              </p>
            </div>
            <ul className="mb-4 space-y-1 text-sm">
              <li className="flex items-start gap-2">
                <span className="text-destructive">•</span>
                <span>{t('search.settings.change.bullet1', 'Existing vector data will be cleared')}</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-destructive">•</span>
                <span>{t('search.settings.change.bullet2', 'Vector search will be unavailable during reindex')}</span>
              </li>
            </ul>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={handleEmbeddingCancelChange} disabled={embeddingSaving}>
                {t('search.settings.actions.cancel', 'Cancel')}
              </Button>
              <Button type="button" variant="destructive" onClick={handleEmbeddingConfirmChange} disabled={embeddingSaving}>
                {embeddingSaving ? <Spinner size="sm" className="mr-2" /> : null}
                {t('search.settings.actions.confirm', 'Confirm')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default SearchSettingsPageClient
