'use client'

import * as React from 'react'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bot, Loader2, CheckCircle2, XCircle, ChevronDown, ChevronRight, Server, Wrench, AlertTriangle } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  CommandPaletteProvider,
  CommandPalette,
  useCommandPaletteContext,
} from '../../../../frontend'

// OpenCode health response type
type OpenCodeHealthResponse = {
  status: 'ok' | 'error'
  opencode?: {
    healthy: boolean
    version: string
  }
  mcp?: Record<string, { status: string; error?: string }>
  search?: {
    available: boolean
    driver: string | null
  }
  url: string
  message?: string
}

// Provider config type from settings API
type ProviderConfig = {
  id: string
  name: string
  model: string
  defaultModel: string
  envKey: string
  configured: boolean
}

type SettingsResponse = {
  provider: ProviderConfig
  availableProviders: ProviderConfig[]
}

// Tool info type
type ToolInfo = {
  name: string
  description: string
  module: string
  inputSchema: Record<string, unknown>
}

// API fetch functions
async function fetchHealth(): Promise<OpenCodeHealthResponse> {
  const res = await fetch('/api/ai_assistant/health')
  if (!res.ok) throw new Error('Failed to fetch health')
  return res.json()
}

async function fetchSettings(): Promise<SettingsResponse> {
  const res = await fetch('/api/ai_assistant/settings')
  if (!res.ok) throw new Error('Failed to fetch settings')
  return res.json()
}

async function fetchTools(): Promise<{ tools: ToolInfo[] }> {
  const res = await fetch('/api/ai_assistant/tools')
  if (!res.ok) throw new Error('Failed to fetch tools')
  return res.json()
}

function AiAssistantSettingsContent() {
  const [toolsExpanded, setToolsExpanded] = useState(false)
  const { setIsOpen } = useCommandPaletteContext()

  // Health query - polls every 10 seconds
  const healthQuery = useQuery({
    queryKey: ['ai-assistant', 'health'],
    queryFn: fetchHealth,
    refetchInterval: 10000,
    staleTime: 5000,
  })

  // Settings query - no polling needed (static config)
  const settingsQuery = useQuery({
    queryKey: ['ai-assistant', 'settings'],
    queryFn: fetchSettings,
    staleTime: 60000,
  })

  // Tools query - no polling needed
  const toolsQuery = useQuery({
    queryKey: ['ai-assistant', 'tools'],
    queryFn: fetchTools,
    staleTime: 60000,
  })

  // Open AI Assistant palette
  const openAiAssistant = () => {
    setIsOpen(true)
  }

  const isLoading = healthQuery.isLoading || settingsQuery.isLoading || toolsQuery.isLoading

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-8">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading settings...
      </div>
    )
  }

  const health = healthQuery.data
  const settings = settingsQuery.data
  const tools = toolsQuery.data?.tools || []

  // Group tools by module
  const toolsByModule = tools.reduce<Record<string, ToolInfo[]>>((acc, tool) => {
    const module = tool.module || 'other'
    if (!acc[module]) acc[module] = []
    acc[module].push(tool)
    return acc
  }, {})

  const provider = settings?.provider

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="space-y-1">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Bot className="h-6 w-6" />
          AI Assistant Settings
        </h1>
        <p className="text-muted-foreground">
          Configure and monitor the AI assistant
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

      {/* Configuration Section */}
      <div className="rounded-lg border bg-card p-6">
        <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <Server className="h-4 w-4" />
          Configuration
        </h2>
        <div className="bg-muted/50 rounded-md p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Provider:</span>
            <span className="font-medium">{provider?.name || 'Anthropic'}</span>
            {provider?.configured ? (
              <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 text-xs">
                <CheckCircle2 className="h-3 w-3" />
                Configured
              </span>
            ) : (
              <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 text-xs">
                <XCircle className="h-3 w-3" />
                Not configured
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Model:</span>
            <code className="font-mono text-xs bg-background px-1.5 py-0.5 rounded">{provider?.model || 'claude-haiku-4-5-20251001'}</code>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Required:</span>
            <span>Set <code className="font-mono text-xs bg-background px-1.5 py-0.5 rounded">{provider?.envKey || 'OPENCODE_ANTHROPIC_API_KEY'}</code> in .env</span>
          </div>
        </div>

        {/* Available Providers */}
        {settings?.availableProviders && settings.availableProviders.length > 1 && (
          <div className="mt-4">
            <p className="text-xs text-muted-foreground mb-2">Available Providers:</p>
            <div className="flex flex-wrap gap-2">
              {settings.availableProviders.map((p) => (
                <div
                  key={p.id}
                  className={`px-2 py-1 rounded text-xs ${
                    p.id === provider?.id
                      ? 'bg-primary text-primary-foreground'
                      : p.configured
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400'
                        : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {p.name}
                  {p.id === provider?.id && ' (active)'}
                  {p.id !== provider?.id && p.configured && ' (ready)'}
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-xs text-muted-foreground mt-3">
          Set <code className="font-mono text-[10px] bg-muted px-1 rounded">OPENCODE_PROVIDER</code> in .env to change provider (anthropic, openai, google).
        </p>
      </div>

      {/* Requirements Section */}
      <div className="rounded-lg border bg-card p-6">
        <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />
          Requirements
        </h2>
        <div className="bg-muted/50 rounded-md p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Full-Text Search:</span>
            {health?.search?.available ? (
              <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-3 w-3" />
                Meilisearch connected
              </span>
            ) : (
              <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                <XCircle className="h-3 w-3" />
                Not available
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            A full-text search driver (Meilisearch) is required for API endpoint discovery.
            Endpoints are indexed automatically when the MCP server starts.
          </p>
        </div>
      </div>

      {/* OpenCode Connection Section */}
      <div className="rounded-lg border bg-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Server className="h-4 w-4" />
            OpenCode Connection
          </h2>
          {healthQuery.isFetching && !healthQuery.isLoading && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {/* OpenCode Server Status */}
          <div className={`p-4 rounded-lg border-2 ${
            health?.status === 'ok' && health.opencode?.healthy
              ? 'border-emerald-500/50 bg-emerald-50/50 dark:bg-emerald-900/10'
              : 'border-destructive/50 bg-destructive/5'
          }`}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium">OpenCode Server</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {health?.status === 'ok' && health.opencode?.healthy ? (
                    <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="h-3 w-3" />
                      Connected
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-destructive">
                      <XCircle className="h-3 w-3" />
                      {health?.message || 'Disconnected'}
                    </span>
                  )}
                </p>
                {health?.opencode?.version && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Version: {health.opencode.version}
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  {health?.url || 'http://localhost:4096'}
                </p>
              </div>
              {health?.status === 'ok' && health.opencode?.healthy && (
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400">
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              )}
            </div>
          </div>

          {/* MCP Server Status */}
          {health?.mcp && Object.entries(health.mcp).map(([name, mcpStatus]) => (
            <div
              key={name}
              className={`p-4 rounded-lg border-2 ${
                mcpStatus.status === 'connected'
                  ? 'border-emerald-500/50 bg-emerald-50/50 dark:bg-emerald-900/10'
                  : mcpStatus.status === 'connecting'
                    ? 'border-amber-500/50 bg-amber-50/50 dark:bg-amber-900/10'
                    : 'border-destructive/50 bg-destructive/5'
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium">MCP Server</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {mcpStatus.status === 'connected' ? (
                      <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="h-3 w-3" />
                        Connected
                      </span>
                    ) : mcpStatus.status === 'connecting' ? (
                      <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Connecting...
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-destructive">
                        <XCircle className="h-3 w-3" />
                        {mcpStatus.error || 'Failed'}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">{name}</p>
                  <p className="text-xs text-muted-foreground mt-1">localhost:3001</p>
                </div>
                {mcpStatus.status === 'connected' && (
                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400">
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Show placeholder if no MCP info */}
          {(!health?.mcp || Object.keys(health.mcp).length === 0) && (
            <div className="p-4 rounded-lg border-2 border-border bg-muted/20">
              <div>
                <p className="text-sm font-medium">MCP Server</p>
                <p className="text-xs text-muted-foreground mt-1">
                  <span className="flex items-center gap-1">
                    <XCircle className="h-3 w-3" />
                    Not connected
                  </span>
                </p>
                <p className="text-xs text-muted-foreground mt-1">localhost:3001</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* MCP Tools Section */}
      <div className="rounded-lg border bg-card p-6">
        <button
          onClick={() => setToolsExpanded(!toolsExpanded)}
          className="w-full flex items-center justify-between text-left"
        >
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Wrench className="h-4 w-4" />
            MCP Tools ({tools.length} tools)
          </h2>
          {toolsExpanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </button>

        {toolsExpanded && (
          <div className="mt-4 space-y-4">
            {Object.entries(toolsByModule).map(([module, moduleTools]) => (
              <div key={module} className="space-y-2">
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {module}
                </h3>
                <div className="space-y-1">
                  {moduleTools.map((tool) => (
                    <div key={tool.name} className="pl-2 border-l-2 border-muted py-1">
                      <p className="text-sm font-medium">{tool.name}</p>
                      <p className="text-xs text-muted-foreground">{tool.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
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
