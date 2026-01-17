'use client'

import * as React from 'react'
import { useState, useEffect } from 'react'
import { Bot, Loader2, CheckCircle2, XCircle } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  CommandPaletteProvider,
  CommandPalette,
  useCommandPaletteContext,
} from '../../../../frontend'
import { McpServersSection } from './McpServersSection'

// Types matching the API response
type ChatProviderId = 'openai' | 'anthropic' | 'google'

type ChatProviderInfo = {
  name: string
  envKeyRequired: string
  defaultModel: string
  models: Array<{ id: string; name: string; contextWindow: number }>
}

type SettingsResponse = {
  config: { providerId: ChatProviderId; model: string } | null
  configuredProviders: ChatProviderId[]
  providers: Record<ChatProviderId, ChatProviderInfo>
}

const PROVIDER_ORDER: ChatProviderId[] = ['anthropic', 'openai', 'google']

function AiAssistantSettingsContent() {
  const [settings, setSettings] = useState<SettingsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { setIsOpen } = useCommandPaletteContext()

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
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load settings')
      } finally {
        setLoading(false)
      }
    }

    fetchSettings()
  }, [])

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

  // Find the active provider (first configured provider)
  const activeProvider = settings?.configuredProviders?.[0] ?? null
  const activeProviderInfo = activeProvider ? settings?.providers[activeProvider] : null

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div className="space-y-1">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Bot className="h-6 w-6" />
          AI Assistant Settings
        </h1>
        <p className="text-muted-foreground">
          View the AI provider configuration for the assistant.
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

      {/* Provider Status Section */}
      <div className="rounded-lg border bg-card p-6">
        <h2 className="text-sm font-semibold mb-2">AI Provider Status</h2>
        <p className="text-xs text-muted-foreground mb-4">
          The AI provider is configured via environment variables. Set the appropriate API key in your .env file.
        </p>

        {/* Provider Cards - Read Only */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PROVIDER_ORDER.map((providerId) => {
            const info = settings?.providers[providerId]
            if (!info) return null

            const isConfigured = settings?.configuredProviders?.includes(providerId)
            const isActive = activeProvider === providerId

            return (
              <div
                key={providerId}
                className={`p-4 rounded-lg border-2 ${
                  isActive
                    ? 'border-primary bg-primary/5'
                    : isConfigured
                      ? 'border-emerald-500/50 bg-emerald-50/50 dark:bg-emerald-900/10'
                      : 'border-border bg-muted/20 opacity-60'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className={`text-sm font-medium ${isActive ? 'text-primary' : ''}`}>
                        {info.name}
                      </p>
                      {isActive && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary text-primary-foreground">
                          Active
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {isConfigured ? (
                        <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="h-3 w-3" />
                          API key configured
                        </span>
                      ) : (
                        <span className="flex items-center gap-1">
                          <XCircle className="h-3 w-3" />
                          Set <code className="font-mono text-[10px] bg-muted px-1 rounded">{info.envKeyRequired}</code>
                        </span>
                      )}
                    </p>
                  </div>
                  {isConfigured && (
                    <div className={`flex h-5 w-5 items-center justify-center rounded-full flex-shrink-0 ${
                      isActive ? 'bg-primary text-primary-foreground' : 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400'
                    }`}>
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  )}
                </div>

                {/* Show model info for active provider */}
                {isActive && activeProviderInfo && (
                  <div className="mt-3 pt-3 border-t border-border">
                    <p className="text-xs text-muted-foreground">
                      Default model: <span className="font-medium text-foreground">{activeProviderInfo.defaultModel}</span>
                    </p>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* No provider configured warning */}
        {!activeProvider && (
          <div className="mt-4 p-3 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
            <div className="flex items-start gap-2">
              <svg className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div className="text-sm text-amber-800 dark:text-amber-200">
                <p className="font-medium mb-1">No AI Provider Configured</p>
                <p className="text-xs">
                  Set one of the following environment variables: <code className="font-mono bg-amber-100 dark:bg-amber-800 px-1 rounded">ANTHROPIC_API_KEY</code>, <code className="font-mono bg-amber-100 dark:bg-amber-800 px-1 rounded">OPENAI_API_KEY</code>, or <code className="font-mono bg-amber-100 dark:bg-amber-800 px-1 rounded">GOOGLE_GENERATIVE_AI_API_KEY</code>
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Info box */}
        <div className="mt-4 p-3 rounded-md bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
          <div className="flex items-start gap-2">
            <svg className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="text-sm text-blue-800 dark:text-blue-200">
              <p className="font-medium mb-1">Configuration</p>
              <p className="text-xs">
                The AI provider is determined by environment variables. The first configured provider is used. To change providers, update your environment configuration and restart the application.
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
