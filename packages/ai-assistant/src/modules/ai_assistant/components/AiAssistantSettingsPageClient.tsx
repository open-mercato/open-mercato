'use client'

import * as React from 'react'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bot, Loader2, CheckCircle2, XCircle, ChevronDown, ChevronRight, Server, Wrench, Eye, EyeOff, Database, Link2, Settings, Key } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { useAiAssistantVisibility } from '../../../../frontend/hooks/useAiAssistantVisibility'
import McpConfigDialog from './McpConfigDialog'
import SessionKeyDialog from './SessionKeyDialog'

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
    url: string | null
  }
  url: string
  mcpUrl: string
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
  mcpKeyConfigured: boolean
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
  const [mcpConfigOpen, setMcpConfigOpen] = useState(false)
  const [sessionKeyOpen, setSessionKeyOpen] = useState(false)
  const { isEnabled, toggleEnabled, isLoaded } = useAiAssistantVisibility()

  // Open AI Assistant by dispatching global event (triggers main layout's DockableChat)
  const openAiAssistant = () => {
    window.dispatchEvent(new CustomEvent('om:open-ai-chat'))
  }

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

      {/* AI Assistant Section - Visibility toggle + Test button */}
      <div className="rounded-lg border bg-card p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Bot className="h-5 w-5" />
              AI Assistant
            </h2>
            <p className="text-sm text-muted-foreground">
              {isEnabled
                ? 'Visible in header with Cmd+J shortcut enabled.'
                : 'Hidden from header. Enable to show the button and Cmd+J shortcut.'}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3 px-4 py-2 rounded-md border bg-muted/30">
              <span className="text-sm font-medium">Visibility</span>
              {isEnabled ? <Eye className="h-4 w-4 text-muted-foreground" /> : <EyeOff className="h-4 w-4 text-muted-foreground" />}
              <Switch
                checked={isEnabled}
                onCheckedChange={toggleEnabled}
                disabled={!isLoaded}
              />
            </div>
            <Button onClick={openAiAssistant} size="default" className="gap-2">
              <Bot className="h-4 w-4" />
              Open AI Assistant
            </Button>
          </div>
        </div>
      </div>

      {/* Connections Section */}
      <div className="rounded-lg border bg-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Link2 className="h-4 w-4" />
            Connections
          </h2>
          {healthQuery.isFetching && !healthQuery.isLoading && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {/* OpenCode Server Status */}
          <div className={`p-4 rounded-lg border-2 ${
            health?.status === 'ok' && health.opencode?.healthy
              ? 'border-emerald-500/50 bg-emerald-50/50 dark:bg-emerald-900/10'
              : 'border-destructive/50 bg-destructive/5'
          }`}>
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Server className="h-4 w-4 text-muted-foreground shrink-0" />
                  <p className="text-sm font-medium">OpenCode</p>
                </div>
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
                    v{health.opencode.version}
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-1 truncate">
                  {health?.url || 'Not configured'}
                </p>
              </div>
              {health?.status === 'ok' && health.opencode?.healthy && (
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400 shrink-0">
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              )}
            </div>
          </div>

          {/* MCP Server Status */}
          {(() => {
            const mcpConnected = health?.mcp && Object.values(health.mcp).some(s => s.status === 'connected')
            const mcpConnecting = health?.mcp && Object.values(health.mcp).some(s => s.status === 'connecting')
            const mcpError = health?.mcp && Object.values(health.mcp).find(s => s.error)?.error

            return (
              <div className={`p-4 rounded-lg border-2 ${
                mcpConnected
                  ? 'border-emerald-500/50 bg-emerald-50/50 dark:bg-emerald-900/10'
                  : mcpConnecting
                    ? 'border-amber-500/50 bg-amber-50/50 dark:bg-amber-900/10'
                    : 'border-destructive/50 bg-destructive/5'
              }`}>
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Wrench className="h-4 w-4 text-muted-foreground shrink-0" />
                      <p className="text-sm font-medium">MCP Server</p>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {mcpConnected ? (
                        <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="h-3 w-3" />
                          Connected
                        </span>
                      ) : mcpConnecting ? (
                        <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Connecting...
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-destructive">
                          <XCircle className="h-3 w-3" />
                          {mcpError || 'Disconnected'}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1 truncate">
                      {health?.mcpUrl || 'Not configured'}
                    </p>
                  </div>
                  {mcpConnected && (
                    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400 shrink-0">
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  )}
                </div>
              </div>
            )
          })()}

          {/* Meilisearch Status */}
          <div className={`p-4 rounded-lg border-2 ${
            health?.search?.available
              ? 'border-emerald-500/50 bg-emerald-50/50 dark:bg-emerald-900/10'
              : 'border-destructive/50 bg-destructive/5'
          }`}>
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-muted-foreground shrink-0" />
                  <p className="text-sm font-medium">Meilisearch</p>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {health?.search?.available ? (
                    <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="h-3 w-3" />
                      Connected
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-destructive">
                      <XCircle className="h-3 w-3" />
                      Not available
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground mt-1 truncate">
                  {health?.search?.url || 'Not configured'}
                </p>
              </div>
              {health?.search?.available && (
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400 shrink-0">
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* MCP Authentication Status */}
        <div className="mt-4 p-3 rounded-md bg-muted/30 border">
          <div className="flex items-center gap-2 text-sm">
            <Key className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">MCP Authentication:</span>
            {settings?.mcpKeyConfigured ? (
              <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 text-xs">
                <CheckCircle2 className="h-3 w-3" />
                MCP_SERVER_API_KEY configured
              </span>
            ) : (
              <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 text-xs">
                <XCircle className="h-3 w-3" />
                MCP_SERVER_API_KEY not set
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1 ml-6">
            Required for AI to access platform tools via MCP server.
          </p>
        </div>

        {/* LLM Provider Status */}
        <div className="mt-4 p-3 rounded-md bg-muted/30 border">
          <div className="flex items-center gap-2 text-sm">
            <Server className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">LLM Provider:</span>
            <span className="font-medium">{provider?.name || 'Anthropic'}</span>
            {provider?.configured ? (
              <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 text-xs">
                <CheckCircle2 className="h-3 w-3" />
                {provider?.envKey} configured
              </span>
            ) : (
              <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 text-xs">
                <XCircle className="h-3 w-3" />
                {provider?.envKey || 'ANTHROPIC_API_KEY'} not set
              </span>
            )}
          </div>
        </div>

        <p className="text-xs text-muted-foreground mt-4">
          Meilisearch is required for API endpoint discovery. Endpoints are indexed automatically when the MCP server starts.
        </p>
      </div>

      {/* Developer Tools Section */}
      <div className="rounded-lg border bg-card p-6">
        <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <Settings className="h-4 w-4" />
          Developer Tools
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {/* MCP Config Generator */}
          <div className="p-4 rounded-lg border bg-muted/30">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-md bg-primary/10">
                <Settings className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-medium">MCP Configuration</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Generate config for Claude Code or other MCP clients.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  onClick={() => setMcpConfigOpen(true)}
                >
                  Generate MCP Config
                </Button>
              </div>
            </div>
          </div>

          {/* Session Key Generator */}
          <div className="p-4 rounded-lg border bg-muted/30">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-md bg-primary/10">
                <Key className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-medium">Session API Key</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Generate a temporary token for programmatic LLM access. Expires after 2 hours.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  onClick={() => setSessionKeyOpen(true)}
                >
                  Generate Session Key
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Dialogs */}
      <McpConfigDialog
        open={mcpConfigOpen}
        onOpenChange={setMcpConfigOpen}
        mcpUrl={health?.mcpUrl || 'http://localhost:3001'}
      />
      <SessionKeyDialog
        open={sessionKeyOpen}
        onOpenChange={setSessionKeyOpen}
      />

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
  return <AiAssistantSettingsContent />
}

export default AiAssistantSettingsPageClient
