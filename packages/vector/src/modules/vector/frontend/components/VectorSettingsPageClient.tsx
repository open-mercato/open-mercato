/* eslint-disable jsx-a11y/label-has-associated-control */
'use client'

import * as React from 'react'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { Label } from '@open-mercato/ui/primitives/label'
import { Spinner } from '@open-mercato/ui/primitives/spinner'

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

type VectorSettings = {
  openaiConfigured: boolean
  autoIndexingEnabled: boolean
  autoIndexingLocked: boolean
  lockReason: string | null
  embeddingConfig: EmbeddingProviderConfig | null
  configuredProviders: EmbeddingProviderId[]
  indexedDimension: number | null
  reindexRequired: boolean
}

type Props = {
  statusTitle: string
  statusEnabledMessage: string
  statusDisabledMessage: string
  autoIndexingLabel: string
  autoIndexingDescription: string
  autoIndexingLockedMessage: string
  toggleSuccessMessage: string
  toggleErrorMessage: string
  refreshLabel: string
  savingLabel: string
  loadingLabel: string
  embeddingProviderTitle: string
  embeddingProviderLabel: string
  embeddingModelLabel: string
  embeddingDimensionLabel: string
  embeddingNotConfiguredLabel: string
  embeddingCustomModelOption?: string
  embeddingCustomModelNameLabel?: string
  embeddingCustomDimensionLabel?: string
  embeddingChangeWarningTitle: string
  embeddingChangeWarningDescription: string
  embeddingChangeWarningBullet1: string
  embeddingChangeWarningBullet2: string
  embeddingChangeWarningBullet3: string
  embeddingChangeWarningNote: string
  embeddingCancelLabel: string
  embeddingConfirmLabel: string
  embeddingProviderSuccessMessage: string
  embeddingProviderErrorMessage: string
  reindexTitle: string
  reindexDescription: string
  reindexButton: string
  reindexWarning: string
  reindexConfirmTitle: string
  reindexConfirmDescription: string
  reindexConfirmButton: string
  reindexSuccessMessage: string
  reindexErrorMessage: string
  reindexingLabel: string
}

type SettingsResponse = {
  settings?: VectorSettings
  error?: string
}

const normalizeErrorMessage = (error: unknown, fallback: string): string => {
  if (typeof error === 'string' && error.trim().length) return error.trim()
  if (error instanceof Error && error.message.trim().length) return error.message.trim()
  return fallback
}

export function VectorSettingsPageClient(props: Props) {
  const [settings, setSettings] = React.useState<VectorSettings | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const previousValueRef = React.useRef<boolean>(true)

  // Staged selection (not yet applied)
  const [selectedProvider, setSelectedProvider] = React.useState<EmbeddingProviderId | null>(null)
  const [selectedModel, setSelectedModel] = React.useState<string | null>(null)

  // Custom model inputs (when "custom" is selected)
  const [customModelName, setCustomModelName] = React.useState<string>('')
  const [customDimension, setCustomDimension] = React.useState<number>(768)

  const [pendingConfig, setPendingConfig] = React.useState<EmbeddingProviderConfig | null>(null)
  const [showConfirmDialog, setShowConfirmDialog] = React.useState(false)

  // Reindex state
  const [reindexing, setReindexing] = React.useState(false)
  const [showReindexDialog, setShowReindexDialog] = React.useState(false)

  const fetchSettings = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const body = await readApiResultOrThrow<SettingsResponse>(
        '/api/vector/settings',
        undefined,
        { errorMessage: props.toggleErrorMessage, allowNullResult: true },
      )
      if (body?.settings) {
        setSettings(body.settings)
        previousValueRef.current = body.settings.autoIndexingEnabled
        // Reset staged selection to match saved config
        setSelectedProvider(null)
        setSelectedModel(null)
      } else {
        previousValueRef.current = true
        setSettings({
          openaiConfigured: false,
          autoIndexingEnabled: true,
          autoIndexingLocked: false,
          lockReason: null,
          embeddingConfig: null,
          configuredProviders: [],
          indexedDimension: null,
          reindexRequired: false,
        })
        setSelectedProvider(null)
        setSelectedModel(null)
      }
    } catch (err) {
      const message = normalizeErrorMessage(err, props.toggleErrorMessage)
      setError(message)
      flash(message, 'error')
    } finally {
      setLoading(false)
    }
  }, [props.toggleErrorMessage])

  React.useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

  const updateAutoIndexing = React.useCallback(
    async (nextValue: boolean) => {
      setSettings((prev) => {
        previousValueRef.current = prev?.autoIndexingEnabled ?? true
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
      setSaving(true)
      try {
        const body = await readApiResultOrThrow<SettingsResponse>(
          '/api/vector/settings',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ autoIndexingEnabled: nextValue }),
          },
          { errorMessage: props.toggleErrorMessage, allowNullResult: true },
        )
        if (body?.settings) {
          setSettings(body.settings)
          previousValueRef.current = body.settings.autoIndexingEnabled
        }
        flash(props.toggleSuccessMessage, 'success')
      } catch (err) {
        const message = normalizeErrorMessage(err, props.toggleErrorMessage)
        flash(message, 'error')
        setSettings((prev) => (prev ? { ...prev, autoIndexingEnabled: previousValueRef.current } : prev))
      } finally {
        setSaving(false)
      }
    },
    [props.toggleErrorMessage, props.toggleSuccessMessage],
  )

  // Just update staged selection (no API call yet)
  const handleProviderChange = (providerId: EmbeddingProviderId) => {
    setSelectedProvider(providerId)
    // Reset model selection when provider changes
    setSelectedModel(null)
    // Reset custom model inputs
    setCustomModelName('')
    setCustomDimension(768)
  }

  // Just update staged selection (no API call yet)
  const handleModelChange = (modelId: string) => {
    setSelectedModel(modelId)
  }

  // Called when user clicks "Apply" button
  const handleApplyChanges = () => {
    const newProviderId = selectedProvider ?? settings?.embeddingConfig?.providerId ?? 'openai'
    const newProviderInfo = EMBEDDING_PROVIDERS[newProviderId]
    const newModelId = selectedModel ?? (selectedProvider ? newProviderInfo.defaultModel : settings?.embeddingConfig?.model ?? newProviderInfo.defaultModel)

    let modelName: string
    let dimension: number

    if (newModelId === 'custom') {
      // Use custom values
      modelName = customModelName.trim()
      dimension = customDimension
      if (!modelName) {
        flash('Please enter a model name', 'error')
        return
      }
      if (dimension <= 0) {
        flash('Please enter a valid dimension', 'error')
        return
      }
    } else {
      // Use predefined model
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

    // Show warning if there's existing data (indexedDimension or embeddingConfig)
    if (settings?.indexedDimension || settings?.embeddingConfig) {
      setPendingConfig(newConfig)
      setShowConfirmDialog(true)
    } else {
      applyEmbeddingConfig(newConfig)
    }
  }

  // Reset staged selection back to saved config
  const handleCancelSelection = () => {
    setSelectedProvider(null)
    setSelectedModel(null)
    setCustomModelName('')
    setCustomDimension(768)
  }

  const applyEmbeddingConfig = async (config: EmbeddingProviderConfig) => {
    setSaving(true)
    setShowConfirmDialog(false)
    setPendingConfig(null)

    try {
      await readApiResultOrThrow<SettingsResponse>(
        '/api/vector/settings',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ embeddingConfig: config }),
        },
        { errorMessage: props.embeddingProviderErrorMessage, allowNullResult: true },
      )
      // Reset staged selection after successful save
      setSelectedProvider(null)
      setSelectedModel(null)
      flash(props.embeddingProviderSuccessMessage, 'success')
      // Refresh settings to get updated indexedDimension from database
      await fetchSettings()
    } catch (err) {
      const message = normalizeErrorMessage(err, props.embeddingProviderErrorMessage)
      flash(message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleConfirmChange = () => {
    if (pendingConfig) {
      applyEmbeddingConfig(pendingConfig)
    }
  }

  const handleCancelChange = () => {
    setShowConfirmDialog(false)
    setPendingConfig(null)
  }

  const handleReindexClick = () => {
    setShowReindexDialog(true)
  }

  const handleReindexConfirm = async () => {
    setShowReindexDialog(false)
    setReindexing(true)
    try {
      await readApiResultOrThrow<{ ok: boolean }>(
        '/api/vector/reindex',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ purgeFirst: true }),
        },
        { errorMessage: props.reindexErrorMessage, allowNullResult: true },
      )
      flash(props.reindexSuccessMessage, 'success')
    } catch (err) {
      const message = normalizeErrorMessage(err, props.reindexErrorMessage)
      flash(message, 'error')
    } finally {
      setReindexing(false)
    }
  }

  const handleReindexCancel = () => {
    setShowReindexDialog(false)
  }

  const autoIndexingChecked = settings ? settings.autoIndexingEnabled : true
  const autoIndexingDisabled = loading || saving || Boolean(settings?.autoIndexingLocked)

  // Saved config values
  const savedProvider = settings?.embeddingConfig?.providerId ?? 'openai'
  const savedProviderInfo = EMBEDDING_PROVIDERS[savedProvider]
  const savedModel = settings?.embeddingConfig?.model ?? savedProviderInfo.defaultModel
  const savedDimension = settings?.embeddingConfig?.dimension ?? savedProviderInfo.models[0]?.dimension ?? 768

  // Check if saved model is a custom model (not in predefined list)
  const savedModelIsPredefined = savedProviderInfo.models.some((m) => m.id === savedModel)
  const savedCustomModel = !savedModelIsPredefined && savedModel ? { id: savedModel, name: savedModel, dimension: savedDimension } : null

  // Display values (staged selection or saved)
  const displayProvider = selectedProvider ?? savedProvider
  const displayProviderInfo = EMBEDDING_PROVIDERS[displayProvider]
  const displayModel = selectedModel ?? (selectedProvider ? displayProviderInfo.defaultModel : savedModel)
  const isCustomModel = displayModel === 'custom'

  // Check if display model is a saved custom model (not in predefined list and not "custom" input mode)
  const displayModelIsSavedCustom = !isCustomModel && displayProvider === savedProvider && savedCustomModel && displayModel === savedCustomModel.id

  const displayModelInfo = isCustomModel
    ? null
    : displayModelIsSavedCustom
      ? savedCustomModel
      : displayProviderInfo.models.find((m) => m.id === displayModel) ?? displayProviderInfo.models[0]
  const displayDimension = isCustomModel ? customDimension : (displayModelInfo?.dimension ?? 768)

  // Check if there are unsaved changes
  const hasUnsavedChanges = (selectedProvider !== null && selectedProvider !== savedProvider) ||
    (selectedModel !== null && selectedModel !== savedModel) ||
    (selectedProvider !== null && selectedModel === null && displayProviderInfo.defaultModel !== savedModel) ||
    (isCustomModel && (customModelName.trim() !== '' || customDimension !== 768))

  const statusMessage = settings?.configuredProviders?.includes(savedProvider)
    ? props.statusEnabledMessage
    : props.statusDisabledMessage

  const providerOptions: EmbeddingProviderId[] = ['openai', 'google', 'mistral', 'cohere', 'bedrock', 'ollama']

  return (
    <div className="flex flex-col gap-6">
      {/* Embedding Provider Card */}
      <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="text-lg font-semibold mb-4">{props.embeddingProviderTitle}</h2>

        <div className="space-y-4">
          {/* Provider Selector */}
          <div className="space-y-2">
            <Label htmlFor="embedding-provider" className="text-sm font-medium">
              {props.embeddingProviderLabel}
            </Label>
            <select
              id="embedding-provider"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
              value={displayProvider}
              onChange={(e) => handleProviderChange(e.target.value as EmbeddingProviderId)}
              disabled={loading || saving}
            >
              {providerOptions.map((providerId) => {
                const info = EMBEDDING_PROVIDERS[providerId]
                const isConfigured = settings?.configuredProviders?.includes(providerId)
                return (
                  <option key={providerId} value={providerId} disabled={!isConfigured}>
                    {info.name} {!isConfigured && `(${props.embeddingNotConfiguredLabel})`}
                  </option>
                )
              })}
            </select>
          </div>

          {/* Model Selector */}
          <div className="space-y-2">
            <Label htmlFor="embedding-model" className="text-sm font-medium">
              {props.embeddingModelLabel}
            </Label>
            <select
              id="embedding-model"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
              value={displayModel}
              onChange={(e) => handleModelChange(e.target.value)}
              disabled={loading || saving}
            >
              {/* Show saved custom model at top if it exists for this provider */}
              {savedCustomModel && displayProvider === savedProvider && (
                <option key={savedCustomModel.id} value={savedCustomModel.id}>
                  {savedCustomModel.name} ({savedCustomModel.dimension} dimensions)
                </option>
              )}
              {displayProviderInfo.models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name} ({model.dimension} dimensions)
                </option>
              ))}
              <option value="custom">{props.embeddingCustomModelOption ?? 'Custom...'}</option>
            </select>
          </div>

          {/* Custom Model Inputs (shown when "custom" is selected) */}
          {isCustomModel && (
            <div className="space-y-3 p-3 rounded-md border border-input bg-muted/30">
              <div className="space-y-2">
                <Label htmlFor="custom-model-name" className="text-sm font-medium">
                  {props.embeddingCustomModelNameLabel ?? 'Model Name'}
                </Label>
                <input
                  id="custom-model-name"
                  type="text"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
                  value={customModelName}
                  onChange={(e) => setCustomModelName(e.target.value)}
                  placeholder="e.g., nomic-embed-text"
                  disabled={loading || saving}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="custom-dimension" className="text-sm font-medium">
                  {props.embeddingCustomDimensionLabel ?? 'Dimensions'}
                </Label>
                <input
                  id="custom-dimension"
                  type="number"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
                  value={customDimension}
                  onChange={(e) => setCustomDimension(Number(e.target.value) || 768)}
                  placeholder="e.g., 768"
                  min={1}
                  disabled={loading || saving}
                />
              </div>
            </div>
          )}

          {/* Dimension Info */}
          <div className="text-sm text-muted-foreground">
            <span className="font-medium">{props.embeddingDimensionLabel}:</span> {displayDimension}
            {settings?.indexedDimension && settings.indexedDimension !== displayDimension && (
              <span className="ml-2 text-amber-600 dark:text-amber-400">
                (Index: {settings.indexedDimension} - mismatch!)
              </span>
            )}
          </div>

          {/* Apply/Cancel buttons for pending changes */}
          {hasUnsavedChanges && (
            <div className="flex items-center gap-3 pt-2">
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={handleApplyChanges}
                disabled={loading || saving}
              >
                {props.embeddingConfirmLabel}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCancelSelection}
                disabled={loading || saving}
              >
                {props.embeddingCancelLabel}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Status Card */}
      <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">{props.statusTitle}</h2>
            <p className="text-sm text-muted-foreground">
              {loading ? props.loadingLabel : statusMessage}
            </p>
          </div>
          <div
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ${
              settings?.configuredProviders?.includes(savedProvider)
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200'
                : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200'
            }`}
          >
            {loading ? <Spinner size="sm" /> : null}
            <span>{loading ? props.loadingLabel : statusMessage}</span>
          </div>
        </div>

        <div className="mt-5 space-y-2">
          <div className="flex items-center gap-3">
            <input
              id="vector-auto-indexing"
              type="checkbox"
              className="h-4 w-4 rounded border-muted-foreground/40"
              checked={autoIndexingChecked}
              onChange={(event) => updateAutoIndexing(event.target.checked)}
              disabled={autoIndexingDisabled}
            />
            <Label htmlFor="vector-auto-indexing" className="text-sm font-medium">
              {props.autoIndexingLabel}
            </Label>
            {saving ? <Spinner size="sm" className="text-muted-foreground" /> : null}
          </div>
          <p className="text-sm text-muted-foreground">{props.autoIndexingDescription}</p>
          {settings?.autoIndexingLocked ? (
            <p className="text-sm text-destructive">{props.autoIndexingLockedMessage}</p>
          ) : null}
        </div>

        <div className="mt-5 flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fetchSettings()}
            disabled={loading}
          >
            {loading ? props.loadingLabel : props.refreshLabel}
          </Button>
          {saving ? <span className="text-sm text-muted-foreground">{props.savingLabel}</span> : null}
          {error ? <span className="text-sm text-destructive">{error}</span> : null}
        </div>
      </div>

      {/* Reindex Card */}
      <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="text-lg font-semibold mb-2">{props.reindexTitle}</h2>
        <p className="text-sm text-muted-foreground mb-3">{props.reindexDescription}</p>
        <div className="flex items-center gap-3 p-3 rounded-md bg-amber-50 dark:bg-amber-900/20 mb-4">
          <svg className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <p className="text-sm text-amber-800 dark:text-amber-200">{props.reindexWarning}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleReindexClick}
          disabled={loading || saving || reindexing || !settings?.configuredProviders?.includes(savedProvider)}
        >
          {reindexing ? (
            <>
              <Spinner size="sm" className="mr-2" />
              {props.reindexingLabel}
            </>
          ) : (
            props.reindexButton
          )}
        </Button>
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
                <h3 className="text-lg font-semibold">{props.reindexConfirmTitle}</h3>
                <p className="text-sm text-muted-foreground mt-1">{props.reindexConfirmDescription}</p>
              </div>
            </div>

            <div className="mb-4 p-3 rounded-md bg-amber-50 dark:bg-amber-900/20">
              <p className="text-sm text-amber-800 dark:text-amber-200">{props.reindexWarning}</p>
            </div>

            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={handleReindexCancel}
              >
                {props.embeddingCancelLabel}
              </Button>
              <Button
                type="button"
                variant="default"
                onClick={handleReindexConfirm}
              >
                {props.reindexConfirmButton}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Dialog */}
      {showConfirmDialog && pendingConfig && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 max-w-lg rounded-lg border border-border bg-card p-6 shadow-lg">
            <div className="flex items-start gap-3 mb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/40">
                <svg className="h-5 w-5 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold">{props.embeddingChangeWarningTitle}</h3>
                <p className="text-sm text-muted-foreground mt-1">{props.embeddingChangeWarningDescription}</p>
              </div>
            </div>

            <div className="mb-4 p-3 rounded-md bg-muted/50 text-sm">
              <p className="font-medium mb-2">
                {settings?.embeddingConfig
                  ? `${EMBEDDING_PROVIDERS[settings.embeddingConfig.providerId].name} (${settings.embeddingConfig.model})`
                  : 'Default'}
                {' → '}
                {EMBEDDING_PROVIDERS[pendingConfig.providerId].name} ({pendingConfig.model})
              </p>
              <p className="text-muted-foreground">
                {settings?.indexedDimension ?? 'N/A'} → {pendingConfig.dimension} dimensions
              </p>
            </div>

            <ul className="mb-4 space-y-2 text-sm">
              <li className="flex items-start gap-2">
                <span className="text-destructive">•</span>
                <span>{props.embeddingChangeWarningBullet1}</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-destructive">•</span>
                <span>{props.embeddingChangeWarningBullet2}</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-destructive">•</span>
                <span>{props.embeddingChangeWarningBullet3}</span>
              </li>
            </ul>

            <p className="mb-6 text-sm text-muted-foreground italic">
              {props.embeddingChangeWarningNote}
            </p>

            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={handleCancelChange}
                disabled={saving}
              >
                {props.embeddingCancelLabel}
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={handleConfirmChange}
                disabled={saving}
              >
                {saving ? <Spinner size="sm" className="mr-2" /> : null}
                {props.embeddingConfirmLabel}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default VectorSettingsPageClient
