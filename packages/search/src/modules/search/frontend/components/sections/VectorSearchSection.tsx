'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { Label } from '@open-mercato/ui/primitives/label'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@open-mercato/ui/primitives/tabs'

// Types
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

type ReindexLock = {
  type: 'fulltext' | 'vector'
  action: string
  startedAt: string
  elapsedMinutes: number
}

type ActivityLog = {
  id: string
  source: string
  handler: string
  level: 'info' | 'error' | 'warn'
  entityType: string | null
  recordId: string | null
  message: string
  details: unknown
  occurredAt: string
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

export type VectorSearchSectionProps = {
  embeddingSettings: EmbeddingSettings | null
  embeddingLoading: boolean
  vectorStoreConfig: VectorStoreConfigResponse | null
  vectorStoreConfigLoading: boolean
  vectorReindexLock: ReindexLock | null
  onEmbeddingSettingsUpdate: (settings: EmbeddingSettings) => void
  onRefreshEmbeddings: () => Promise<void>
}

export function VectorSearchSection({
  embeddingSettings,
  embeddingLoading,
  vectorStoreConfig,
  vectorStoreConfigLoading,
  vectorReindexLock,
  onEmbeddingSettingsUpdate,
  onRefreshEmbeddings,
}: VectorSearchSectionProps) {
  const t = useT()
  const [embeddingSaving, setEmbeddingSaving] = React.useState(false)
  const autoIndexingPreviousRef = React.useRef<boolean>(true)

  // Staged embedding selection
  const [selectedProvider, setSelectedProvider] = React.useState<EmbeddingProviderId | null>(null)
  const [selectedModel, setSelectedModel] = React.useState<string | null>(null)
  const [customModelName, setCustomModelName] = React.useState<string>('')
  const [customDimension, setCustomDimension] = React.useState<number>(768)

  const [pendingEmbeddingConfig, setPendingEmbeddingConfig] = React.useState<EmbeddingProviderConfig | null>(null)
  const [showEmbeddingConfirmDialog, setShowEmbeddingConfirmDialog] = React.useState(false)

  // Vector reindex state
  const [vectorReindexing, setVectorReindexing] = React.useState(false)
  const [showVectorReindexDialog, setShowVectorReindexDialog] = React.useState(false)

  // Activity logs state
  const [activityLogs, setActivityLogs] = React.useState<ActivityLog[]>([])
  const [activityLoading, setActivityLoading] = React.useState(true)

  // Fetch activity logs
  const fetchActivityLogs = React.useCallback(async () => {
    setActivityLoading(true)
    try {
      const response = await fetch('/api/query_index/status')
      if (response.ok) {
        const body = await response.json() as { logs?: ActivityLog[]; errors?: ActivityLog[] }
        const allLogs: ActivityLog[] = []
        if (body.logs) {
          allLogs.push(...body.logs)
        }
        if (body.errors) {
          allLogs.push(...body.errors.map(err => ({ ...err, level: 'error' as const })))
        }
        // Filter for vector-related logs
        const vectorLogs = allLogs.filter(log => {
          const lowerSource = log.source?.toLowerCase() ?? ''
          const lowerMessage = log.message?.toLowerCase() ?? ''
          const lowerHandler = log.handler?.toLowerCase() ?? ''
          return lowerSource.includes('vector') || lowerMessage.includes('vector') ||
            lowerMessage.includes('embedding') || lowerHandler.includes('vector')
        })
        vectorLogs.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
        setActivityLogs(vectorLogs.slice(0, 50))
      }
    } catch {
      // Silently fail
    } finally {
      setActivityLoading(false)
    }
  }, [])

  React.useEffect(() => {
    fetchActivityLogs()
  }, [fetchActivityLogs])

  // Poll for activity when reindexing
  React.useEffect(() => {
    if (vectorReindexLock || vectorReindexing) {
      const interval = setInterval(fetchActivityLogs, 5000)
      return () => clearInterval(interval)
    }
  }, [vectorReindexLock, vectorReindexing, fetchActivityLogs])

  // Update auto-indexing
  const updateAutoIndexing = React.useCallback(async (nextValue: boolean) => {
    autoIndexingPreviousRef.current = embeddingSettings?.autoIndexingEnabled ?? true
    if (embeddingSettings) {
      onEmbeddingSettingsUpdate({ ...embeddingSettings, autoIndexingEnabled: nextValue })
    }
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
        onEmbeddingSettingsUpdate(body.settings)
        autoIndexingPreviousRef.current = body.settings.autoIndexingEnabled
      }
      flash(t('search.settings.messages.saved', 'Settings saved'), 'success')
    } catch {
      if (embeddingSettings) {
        onEmbeddingSettingsUpdate({ ...embeddingSettings, autoIndexingEnabled: autoIndexingPreviousRef.current })
      }
    } finally {
      setEmbeddingSaving(false)
    }
  }, [embeddingSettings, onEmbeddingSettingsUpdate, t])

  // Provider handlers
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
      await onRefreshEmbeddings()
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
      await fetchActivityLogs()
    } catch {
      // Error handled by readApiResultOrThrow
    } finally {
      setVectorReindexing(false)
    }
  }

  const handleVectorReindexCancel = () => {
    setShowVectorReindexDialog(false)
  }

  // Computed values
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

  return (
    <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <h2 className="text-lg font-semibold mb-2">
        {t('search.settings.vector.sectionTitle', 'Vector Search')}
      </h2>
      <p className="text-sm text-muted-foreground mb-4">
        {t('search.settings.vector.sectionDescription', 'AI-powered semantic search using embeddings.')}
      </p>

      <Tabs defaultValue="configuration">
        <TabsList className="mb-4">
          <TabsTrigger value="configuration">
            {t('search.settings.tabs.configuration', 'Configuration')}
          </TabsTrigger>
          <TabsTrigger value="index">
            {t('search.settings.tabs.indexManagement', 'Index Management')}
          </TabsTrigger>
          <TabsTrigger value="activity">
            {t('search.settings.tabs.activity', 'Activity')}
          </TabsTrigger>
        </TabsList>

        {/* Configuration Tab */}
        <TabsContent value="configuration">
          {(embeddingLoading || vectorStoreConfigLoading) ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Spinner size="sm" />
              <span>{t('search.settings.loadingLabel', 'Loading settings...')}</span>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Vector Store Driver Status */}
              <div>
                <h3 className="text-sm font-semibold mb-2">{t('search.settings.vector.store', 'Vector Store')}</h3>
                <div className="grid gap-2 sm:grid-cols-3">
                  {vectorStoreConfig?.drivers.map((driver) => {
                    const isCurrent = driver.id === vectorStoreConfig.currentDriver
                    const isReady = driver.configured && driver.implemented
                    return (
                      <div
                        key={driver.id}
                        className={`flex items-start gap-3 p-3 rounded-md border ${
                          isCurrent && isReady
                            ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/20'
                            : !driver.implemented
                              ? 'border-border bg-muted/20 opacity-60'
                              : 'border-border bg-muted/30'
                        }`}
                      >
                        <div className={`flex h-8 w-8 items-center justify-center rounded-full flex-shrink-0 ${
                          isCurrent && isReady
                            ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400'
                            : 'bg-muted text-muted-foreground'
                        }`}>
                          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
                          </svg>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className={`text-sm font-medium ${isCurrent && isReady ? 'text-emerald-700 dark:text-emerald-300' : ''}`}>
                              {driver.name}
                            </p>
                            {isCurrent && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                                {t('search.settings.vector.active', 'Active')}
                              </span>
                            )}
                            {!driver.implemented && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                                {t('search.settings.vector.comingSoon', 'Coming soon')}
                              </span>
                            )}
                          </div>
                          <div className="mt-1 space-y-0.5">
                            {driver.envVars.map((envVar) => (
                              <div key={envVar.name} className="flex items-center gap-1.5">
                                <div className={`h-1.5 w-1.5 rounded-full ${envVar.set ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} />
                                <code className="text-[10px] text-muted-foreground font-mono">{envVar.name}</code>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Embedding Provider Selection */}
              <div>
                <h3 className="text-sm font-semibold mb-2">{t('search.settings.vector.providers', 'Embedding Provider')}</h3>
                <p className="text-xs text-muted-foreground mb-3">{t('search.settings.vector.providersHint', 'Select a provider to generate embeddings. Only providers with configured API keys can be selected.')}</p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 items-start">
                  {providerOptions.map((providerId) => {
                    const info = EMBEDDING_PROVIDERS[providerId]
                    const isConfigured = embeddingSettings?.configuredProviders?.includes(providerId)
                    const isSelected = displayProvider === providerId
                    const isCurrentlySaved = savedProvider === providerId
                    return (
                      <button
                        key={providerId}
                        type="button"
                        onClick={() => isConfigured && handleProviderChange(providerId)}
                        disabled={!isConfigured || embeddingLoading || embeddingSaving}
                        className={`text-left p-3 rounded-lg border-2 transition-all ${
                          isSelected
                            ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                            : isConfigured
                              ? 'border-border hover:border-primary/50 hover:bg-muted/50 cursor-pointer'
                              : 'border-border bg-muted/20 opacity-50 cursor-not-allowed'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className={`text-sm font-medium ${isSelected ? 'text-primary' : isConfigured ? '' : 'text-muted-foreground'}`}>
                                {info.name}
                              </p>
                              {isCurrentlySaved && isConfigured && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                                  {t('search.settings.vector.active', 'Active')}
                                </span>
                              )}
                            </div>
                            {isConfigured ? (
                              <p className="text-xs text-muted-foreground mt-1">
                                {info.models.length} {t('search.settings.vector.modelsAvailable', 'models available')}
                              </p>
                            ) : (
                              <p className="text-xs text-muted-foreground mt-1">
                                {t('search.settings.vector.setEnvVar', 'Set')} <code className="font-mono text-[10px] bg-muted px-1 rounded">{info.envKeyRequired}</code>
                              </p>
                            )}
                          </div>
                          <div className={`flex h-5 w-5 items-center justify-center rounded-full flex-shrink-0 ${
                            isSelected
                              ? 'bg-primary text-primary-foreground'
                              : isConfigured
                                ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400'
                                : 'bg-muted text-muted-foreground'
                          }`}>
                            {isSelected ? (
                              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            ) : isConfigured ? (
                              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            ) : (
                              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                              </svg>
                            )}
                          </div>
                        </div>

                        {/* Model Selection */}
                        {isSelected && isConfigured && (
                          <div className="mt-3 pt-3 border-t border-border space-y-2" onClick={(e) => e.stopPropagation()}>
                            <div className="space-y-1">
                              <Label htmlFor={`model-${providerId}`} className="text-xs font-medium">
                                {t('search.settings.model.label', 'Model')}
                              </Label>
                              <select
                                id={`model-${providerId}`}
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

                            <div className="flex items-center justify-between text-xs">
                              <span className="text-muted-foreground">
                                {t('search.settings.dimension.label', 'Dimensions')}: {displayDimension}
                              </span>
                              {embeddingSettings?.indexedDimension && embeddingSettings.indexedDimension !== displayDimension && (
                                <span className="text-amber-600 dark:text-amber-400">
                                  {t('search.settings.dimension.mismatch', 'mismatch')}: {embeddingSettings.indexedDimension}
                                </span>
                              )}
                            </div>

                            {hasUnsavedEmbeddingChanges && (
                              <div className="flex gap-2 pt-1">
                                <Button type="button" variant="default" size="sm" className="flex-1" onClick={handleApplyEmbeddingChanges} disabled={embeddingLoading || embeddingSaving}>
                                  {embeddingSaving ? <Spinner size="sm" className="mr-1" /> : null}
                                  {t('search.settings.actions.apply', 'Apply')}
                                </Button>
                                <Button type="button" variant="outline" size="sm" onClick={handleCancelEmbeddingSelection} disabled={embeddingLoading || embeddingSaving}>
                                  {t('search.settings.actions.cancel', 'Cancel')}
                                </Button>
                              </div>
                            )}
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Setup Instructions */}
              <div className="p-3 rounded-md bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                <div className="flex items-start gap-2">
                  <svg className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div className="text-sm text-blue-800 dark:text-blue-200">
                    <p className="font-medium mb-1">{t('search.settings.vector.howTo', 'How to set up')}</p>
                    <p className="text-xs">{t('search.settings.vector.howToDescription', 'Add the API key for your preferred provider to your .env file. Only providers with configured API keys can be selected.')}</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </TabsContent>

        {/* Index Management Tab */}
        <TabsContent value="index">
          {embeddingLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Spinner size="sm" />
              <span>{t('search.settings.loadingLabel', 'Loading settings...')}</span>
            </div>
          ) : !isEmbeddingConfigured ? (
            <div className="p-4 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
              <div className="flex items-start gap-3">
                <svg className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div>
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                    {t('search.settings.vectorNotConfigured', 'No embedding provider configured')}
                  </p>
                  <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                    {t('search.settings.vectorNotConfiguredHint', 'Configure an embedding provider in the Configuration tab to enable indexing.')}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Document Count */}
              {embeddingSettings?.documentCount !== null && embeddingSettings?.documentCount !== undefined && (
                <div className="rounded-md border border-border p-4 max-w-xs">
                  <p className="text-sm text-muted-foreground">{t('search.settings.vectorDocumentsLabel', 'Embeddings')}</p>
                  <p className="text-2xl font-bold">{embeddingSettings.documentCount.toLocaleString()}</p>
                </div>
              )}

              {/* Auto-Indexing Toggle */}
              <div className="flex items-start gap-4 p-4 rounded-md border border-border">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <input
                      id="search-auto-indexing"
                      type="checkbox"
                      className="h-4 w-4 rounded border-muted-foreground/40"
                      checked={autoIndexingChecked}
                      onChange={(event) => updateAutoIndexing(event.target.checked)}
                      disabled={autoIndexingDisabled}
                    />
                    <Label htmlFor="search-auto-indexing" className="text-sm font-medium">
                      {t('search.settings.autoIndexing.label', 'Enable auto-indexing')}
                    </Label>
                    {embeddingSaving ? <Spinner size="sm" className="text-muted-foreground" /> : null}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 ml-6">
                    {t('search.settings.autoIndexing.description', 'Automatically index new and updated records for vector search.')}
                  </p>
                  {embeddingSettings?.autoIndexingLocked && (
                    <p className="text-xs text-destructive mt-1 ml-6">
                      {t('search.settings.autoIndexing.locked', 'Disabled via environment variable.')}
                    </p>
                  )}
                </div>
              </div>

              {/* Reindex Actions */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold">{t('search.settings.vectorReindex.title', 'Reindex Data')}</h3>
                <p className="text-xs text-muted-foreground">
                  {t('search.settings.vectorReindex.description', 'Rebuild vector embeddings for all indexed entities. This will purge existing data and regenerate all embeddings.')}
                </p>

                {/* Active reindex lock banner */}
                {vectorReindexLock && (
                  <div className="p-3 rounded-md bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                    <div className="flex items-start gap-3">
                      <Spinner size="sm" className="flex-shrink-0 mt-0.5 text-blue-600 dark:text-blue-400" />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
                          {t('search.settings.reindexInProgress', 'Reindex operation in progress')}
                        </p>
                        <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                          {t('search.settings.reindexInProgressDetails', 'Action: {{action}} | Started {{minutes}} minutes ago', {
                            action: vectorReindexLock.action,
                            minutes: vectorReindexLock.elapsedMinutes,
                          })}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2 p-2 rounded bg-amber-50 dark:bg-amber-900/20">
                  <svg className="h-4 w-4 text-amber-600 dark:text-amber-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <p className="text-xs text-amber-800 dark:text-amber-200">
                    {t('search.settings.vectorReindex.warning', 'This may take a while for large datasets and will consume API credits.')}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={handleVectorReindexClick}
                  disabled={embeddingLoading || embeddingSaving || vectorReindexing || vectorReindexLock !== null}
                >
                  {vectorReindexing || vectorReindexLock !== null ? (
                    <>
                      <Spinner size="sm" className="mr-2" />
                      {t('search.settings.vectorReindex.running', 'Reindexing...')}
                    </>
                  ) : (
                    t('search.settings.vectorReindex.button', 'Full Reindex')
                  )}
                </Button>
              </div>
            </div>
          )}
        </TabsContent>

        {/* Activity Tab */}
        <TabsContent value="activity">
          {activityLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Spinner size="sm" />
              <span>{t('search.settings.loadingLabel', 'Loading...')}</span>
            </div>
          ) : activityLogs.length === 0 ? (
            <div className="p-4 rounded-md bg-muted/50 text-center">
              <p className="text-sm text-muted-foreground">
                {t('search.settings.activity.noLogs', 'No recent indexing activity')}
              </p>
            </div>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {activityLogs.map((log) => (
                <div
                  key={log.id}
                  className={`p-2 rounded-md text-sm ${
                    log.level === 'error'
                      ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'
                      : 'bg-muted/50'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {log.level === 'error' && (
                      <svg className="h-4 w-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs ${log.level === 'error' ? 'text-red-800 dark:text-red-200' : 'text-foreground'}`}>
                        {log.message}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {(() => {
                          const d = new Date(log.occurredAt)
                          const pad = (n: number) => n.toString().padStart(2, '0')
                          return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
                        })()}
                        {log.entityType && ` · ${log.entityType}`}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={fetchActivityLogs}
              disabled={activityLoading}
            >
              {activityLoading ? (
                <>
                  <Spinner size="sm" className="mr-2" />
                  {t('search.settings.loadingLabel', 'Loading...')}
                </>
              ) : (
                t('search.settings.refreshLabel', 'Refresh')
              )}
            </Button>
          </div>
        </TabsContent>
      </Tabs>

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

export default VectorSearchSection
