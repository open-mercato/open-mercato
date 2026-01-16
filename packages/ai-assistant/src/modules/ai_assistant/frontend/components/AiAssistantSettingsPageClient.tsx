'use client'

import * as React from 'react'
import { useState, useEffect } from 'react'
import { Bot, Loader2 } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Label } from '@open-mercato/ui/primitives/label'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import {
  CommandPaletteProvider,
  CommandPalette,
  useCommandPaletteContext,
} from '../../../../frontend'
import { McpServersSection } from './McpServersSection'

// Types matching the API response
type ChatProviderId = 'openai' | 'anthropic' | 'google'

type ChatModelInfo = {
  id: string
  name: string
  contextWindow: number
}

type ChatProviderInfo = {
  name: string
  envKeyRequired: string
  defaultModel: string
  models: ChatModelInfo[]
}

type ChatProviderConfig = {
  providerId: ChatProviderId
  model: string
  updatedAt: string
}

type SettingsResponse = {
  config: ChatProviderConfig | null
  configuredProviders: ChatProviderId[]
  providers: Record<ChatProviderId, ChatProviderInfo>
}

const PROVIDER_ORDER: ChatProviderId[] = ['openai', 'anthropic', 'google']

function formatContextWindow(contextWindow: number): string {
  if (contextWindow >= 1000000) {
    return `${(contextWindow / 1000000).toFixed(1)}M`
  }
  return `${(contextWindow / 1000).toFixed(0)}K`
}

function AiAssistantSettingsContent() {
  const [settings, setSettings] = useState<SettingsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { setIsOpen } = useCommandPaletteContext()

  // Staged selection state
  const [selectedProvider, setSelectedProvider] = useState<ChatProviderId | null>(null)
  const [selectedModel, setSelectedModel] = useState<string | null>(null)

  // Derived state
  const savedProvider = settings?.config?.providerId ?? null
  const savedModel = settings?.config?.model ?? null
  const displayProvider = selectedProvider ?? savedProvider
  const displayModel = selectedModel ?? savedModel
  const displayProviderInfo = displayProvider ? settings?.providers[displayProvider] : null

  const hasUnsavedChanges =
    (selectedProvider !== null && selectedProvider !== savedProvider) ||
    (selectedModel !== null && selectedModel !== savedModel)

  // Fetch settings
  useEffect(() => {
    async function fetchSettings() {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch('/api/ai_assistant/settings')
        if (!response.ok) {
          throw new Error('Failed to fetch settings')
        }
        const data: SettingsResponse = await response.json()
        setSettings(data)

        // Initialize selected state from saved config
        if (data.config) {
          setSelectedProvider(data.config.providerId)
          setSelectedModel(data.config.model)
        } else if (data.configuredProviders.length > 0) {
          // Default to first configured provider
          const firstProvider = data.configuredProviders[0]
          setSelectedProvider(firstProvider)
          setSelectedModel(data.providers[firstProvider].defaultModel)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load settings')
      } finally {
        setLoading(false)
      }
    }

    fetchSettings()
  }, [])

  // Handle provider change
  const handleProviderChange = (providerId: ChatProviderId) => {
    setSelectedProvider(providerId)
    // Reset model to provider's default
    if (settings?.providers[providerId]) {
      setSelectedModel(settings.providers[providerId].defaultModel)
    }
  }

  // Handle model change
  const handleModelChange = (modelId: string) => {
    setSelectedModel(modelId)
  }

  // Apply changes
  const handleApply = async () => {
    if (!selectedProvider || !selectedModel) return

    setSaving(true)
    try {
      const response = await fetch('/api/ai_assistant/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId: selectedProvider,
          model: selectedModel,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to save settings')
      }

      const data = await response.json()

      // Update settings with new config
      setSettings((prev) =>
        prev ? { ...prev, config: data.config } : prev
      )

      flash('Settings saved successfully', 'success')
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Failed to save settings', 'error')
    } finally {
      setSaving(false)
    }
  }

  // Cancel changes
  const handleCancel = () => {
    setSelectedProvider(savedProvider)
    setSelectedModel(savedModel)
  }

  // Open AI Assistant palette
  const openAiAssistant = () => {
    setIsOpen(true)
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-8">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading settings...
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-destructive py-8">
        Error: {error}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div className="space-y-1">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Bot className="h-6 w-6" />
          AI Assistant Settings
        </h1>
        <p className="text-muted-foreground">
          Configure the AI model used for the assistant.
        </p>
      </div>

      {/* Test AI Assistant Section */}
      <div className="rounded-lg border bg-card p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Bot className="h-5 w-5" />
              Test AI Assistant
            </h2>
            <p className="text-sm text-muted-foreground">
              Click the button to open the AI Assistant command palette.
            </p>
          </div>
          <Button onClick={openAiAssistant} size="lg" className="gap-2">
            <Bot className="h-4 w-4" />
            Open AI Assistant
          </Button>
        </div>
      </div>

      {/* Provider Selection Section */}
      <div className="rounded-lg border bg-card p-6">
        <h2 className="text-sm font-semibold mb-2">Chat Model Provider</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Select a provider for AI chat. Only providers with configured API keys can be selected.
        </p>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 items-start">
          {PROVIDER_ORDER.map((providerId) => {
            const info = settings?.providers[providerId]
            if (!info) return null

            const isConfigured = settings?.configuredProviders?.includes(providerId)
            const isSelected = displayProvider === providerId
            const isCurrentlySaved = savedProvider === providerId

            return (
              <button
                key={providerId}
                type="button"
                onClick={() => isConfigured && handleProviderChange(providerId)}
                disabled={!isConfigured || loading || saving}
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
                          Active
                        </span>
                      )}
                    </div>
                    {isConfigured ? (
                      <p className="text-xs text-muted-foreground mt-1">
                        {info.models.length} models available
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground mt-1">
                        Set <code className="font-mono text-[10px] bg-muted px-1 rounded">{info.envKeyRequired}</code>
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

                {/* Model Selection - shown when provider is selected */}
                {isSelected && isConfigured && displayProviderInfo && (
                  <div className="mt-3 pt-3 border-t border-border space-y-2" onClick={(e) => e.stopPropagation()}>
                    <div className="space-y-1">
                      <Label htmlFor={`model-${providerId}`} className="text-xs font-medium">
                        Model
                      </Label>
                      <select
                        id={`model-${providerId}`}
                        className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
                        value={displayModel ?? ''}
                        onChange={(e) => handleModelChange(e.target.value)}
                        disabled={loading || saving}
                      >
                        {displayProviderInfo.models.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.name} ({formatContextWindow(model.contextWindow)} context)
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Context window display */}
                    {displayModel && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">
                          Context window: {formatContextWindow(
                            displayProviderInfo.models.find((m) => m.id === displayModel)?.contextWindow ?? 0
                          )}
                        </span>
                      </div>
                    )}

                    {/* Apply/Cancel buttons */}
                    {hasUnsavedChanges && (
                      <div className="flex gap-2 pt-1">
                        <Button
                          type="button"
                          variant="default"
                          size="sm"
                          className="flex-1"
                          onClick={handleApply}
                          disabled={loading || saving}
                        >
                          {saving ? <Spinner size="sm" className="mr-1" /> : null}
                          Apply
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={handleCancel}
                          disabled={loading || saving}
                        >
                          Cancel
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </button>
            )
          })}
        </div>

        {/* Setup Instructions */}
        <div className="mt-4 p-3 rounded-md bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
          <div className="flex items-start gap-2">
            <svg className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="text-sm text-blue-800 dark:text-blue-200">
              <p className="font-medium mb-1">How to set up</p>
              <p className="text-xs">
                Add the API key for your preferred provider to your .env file. Only providers with configured API keys can be selected.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* MCP Servers Section */}
      <McpServersSection />
    </div>
  )
}

export function AiAssistantSettingsPageClient() {
  return (
    <CommandPaletteProvider tenantId="" organizationId={null}>
      <AiAssistantSettingsContent />
      <CommandPalette />
    </CommandPaletteProvider>
  )
}

export default AiAssistantSettingsPageClient
