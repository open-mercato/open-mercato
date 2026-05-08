'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bot, Loader2, CheckCircle2, XCircle, ChevronDown, ChevronRight, Server, Wrench, Eye, EyeOff, Database, Link2, Settings, Key, X } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useAiAssistantVisibility } from '../../../frontend/hooks/useAiAssistantVisibility'
import McpConfigDialog from './McpConfigDialog'
import SessionKeyDialog from './SessionKeyDialog'

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

type ProviderConfig = {
  id: string
  name: string
  model: string
  defaultModel: string
  envKey: string | null
  configured: boolean
  defaultModels: Array<{ id: string; name: string }>
}

type TenantOverride = {
  providerId: string | null
  modelId: string | null
  baseURL: string | null
  agentId: string | null
  updatedAt: string
}

type SettingsResponse = {
  provider: ProviderConfig
  availableProviders: ProviderConfig[]
  mcpKeyConfigured: boolean
  resolvedDefault: {
    providerId: string
    modelId: string
    baseURL: string | null
    source: string
  } | null
  tenantOverride: TenantOverride | null
  agents: AgentResolution[]
}

type AgentResolution = {
  agentId: string
  moduleId: string
  allowRuntimeOverride: boolean
  providerId: string
  modelId: string
  baseURL: string | null
  source: string
}

type ToolInfo = {
  name: string
  description: string
  module: string
  inputSchema: Record<string, unknown>
}

async function fetchHealth(): Promise<OpenCodeHealthResponse> {
  const result = await apiCall<OpenCodeHealthResponse>('/api/ai_assistant/health')
  if (!result.ok || !result.result) throw new Error('Failed to fetch health')
  return result.result
}

async function fetchSettings(): Promise<SettingsResponse> {
  const result = await apiCall<SettingsResponse>('/api/ai_assistant/settings')
  if (!result.ok || !result.result) throw new Error('Failed to fetch settings')
  return result.result
}

async function fetchTools(): Promise<{ tools: ToolInfo[] }> {
  const result = await apiCall<{ tools: ToolInfo[] }>('/api/ai_assistant/tools')
  if (!result.ok || !result.result) throw new Error('Failed to fetch tools')
  return result.result
}

function GlobalOverrideForm({
  availableProviders,
  tenantOverride,
  onSaved,
}: {
  availableProviders: ProviderConfig[]
  tenantOverride: TenantOverride | null
  onSaved: () => void
}) {
  const t = useT()
  const [selectedProviderId, setSelectedProviderId] = React.useState<string>(
    tenantOverride?.providerId ?? '',
  )
  const [selectedModelId, setSelectedModelId] = React.useState<string>(
    tenantOverride?.modelId ?? '',
  )

  const selectedProvider = availableProviders.find((p) => p.id === selectedProviderId)

  const saveMutation = useGuardedMutation({ operationId: 'ai-settings-save-override' })
  const clearMutation = useGuardedMutation({ operationId: 'ai-settings-clear-override' })

  const handleSave = React.useCallback(async () => {
    await saveMutation.runMutation({
      operation: async () => {
        const result = await apiCall('/api/ai_assistant/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            providerId: selectedProviderId || null,
            modelId: selectedModelId || null,
          }),
        })
        if (!result.ok) {
          const err = (result.result as { error?: string } | null)?.error
          throw new Error(err ?? t('ai_assistant.settings.saveError', 'Failed to save override.'))
        }
      },
      context: {},
    })
    flash(t('ai_assistant.settings.saveSuccess', 'Default model override saved.'), 'success')
    onSaved()
  }, [onSaved, saveMutation, selectedModelId, selectedProviderId, t])

  const handleClear = React.useCallback(async () => {
    await clearMutation.runMutation({
      operation: async () => {
        const result = await apiCall('/api/ai_assistant/settings', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        if (!result.ok) {
          const err = (result.result as { error?: string } | null)?.error
          throw new Error(err ?? t('ai_assistant.settings.clearError', 'Failed to clear override.'))
        }
      },
      context: {},
    })
    flash(t('ai_assistant.settings.clearSuccess', 'Default model override cleared.'), 'success')
    setSelectedProviderId('')
    setSelectedModelId('')
    onSaved()
  }, [clearMutation, onSaved, t])

  const isSaving = saveMutation.isPending
  const isClearing = clearMutation.isPending
  const isBusy = isSaving || isClearing

  const configuredProviders = availableProviders.filter((p) => p.configured)

  return (
    <div className="rounded-lg border bg-card p-6" data-ai-settings-override-form="">
      <h2 className="mb-1 text-sm font-semibold">
        {t('ai_assistant.settings.defaultOverrideTitle', 'Default model override')}
      </h2>
      <p className="mb-4 text-xs text-muted-foreground">
        {t(
          'ai_assistant.settings.defaultOverrideDescription',
          'Set a tenant-wide default provider and model. Agents with a per-agent override or specific defaultModel will take precedence.',
        )}
      </p>
      {tenantOverride && (tenantOverride.providerId || tenantOverride.modelId) ? (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
          <span className="text-muted-foreground">
            {t('ai_assistant.settings.currentOverride', 'Current override:')}
          </span>
          <span className="font-medium">
            {tenantOverride.providerId ?? '—'} / {tenantOverride.modelId ?? '—'}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto h-6 gap-1 text-xs"
            disabled={isBusy}
            onClick={handleClear}
            data-ai-settings-clear-override=""
          >
            <X className="size-3" aria-hidden />
            {t('ai_assistant.settings.clearOverride', 'Clear override')}
          </Button>
        </div>
      ) : null}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">
            {t('ai_assistant.settings.providerLabel', 'Provider')}
          </span>
          <Select
            value={selectedProviderId}
            onValueChange={(val) => {
              setSelectedProviderId(val)
              setSelectedModelId('')
            }}
            disabled={isBusy}
          >
            <SelectTrigger
              className="w-[180px]"
              data-ai-settings-provider-select=""
            >
              <SelectValue placeholder={t('ai_assistant.settings.selectProvider', 'Select provider')} />
            </SelectTrigger>
            <SelectContent>
              {configuredProviders.map((provider) => (
                <SelectItem key={provider.id} value={provider.id}>
                  {provider.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">
            {t('ai_assistant.settings.modelLabel', 'Model')}
          </span>
          <Select
            value={selectedModelId}
            onValueChange={setSelectedModelId}
            disabled={isBusy || !selectedProviderId}
          >
            <SelectTrigger
              className="w-[220px]"
              data-ai-settings-model-select=""
            >
              <SelectValue placeholder={t('ai_assistant.settings.selectModel', 'Select model')} />
            </SelectTrigger>
            <SelectContent>
              {(selectedProvider?.defaultModels ?? []).map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {model.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          type="button"
          size="sm"
          disabled={isBusy || !selectedProviderId || !selectedModelId}
          onClick={handleSave}
          data-ai-settings-save-override=""
        >
          {isSaving ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : null}
          {t('ai_assistant.settings.saveOverride', 'Save override')}
        </Button>
      </div>
    </div>
  )
}

function PerAgentOverrideList({
  agents,
  onCleared,
}: {
  agents: AgentResolution[]
  onCleared: () => void
}) {
  const t = useT()
  const clearMutation = useGuardedMutation({ operationId: 'ai-settings-clear-agent-override' })

  const handleClearAgentOverride = React.useCallback(
    async (agentId: string) => {
      await clearMutation.runMutation({
        operation: async () => {
          const result = await apiCall('/api/ai_assistant/settings', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agentId }),
          })
          if (!result.ok) {
            const err = (result.result as { error?: string } | null)?.error
            throw new Error(err ?? t('ai_assistant.settings.clearAgentError', 'Failed to clear agent override.'))
          }
        },
        context: {},
      })
      flash(t('ai_assistant.settings.clearAgentSuccess', 'Agent override cleared.'), 'success')
      onCleared()
    },
    [clearMutation, onCleared, t],
  )

  if (agents.length === 0) return null

  const overriddenAgents = agents.filter((agent) => agent.source !== 'env_default' && agent.source !== 'provider_default')

  return (
    <div className="rounded-lg border bg-card p-6" data-ai-settings-agent-overrides="">
      <h2 className="mb-1 text-sm font-semibold">
        {t('ai_assistant.settings.agentOverridesTitle', 'Per-agent model resolution')}
      </h2>
      <p className="mb-4 text-xs text-muted-foreground">
        {t(
          'ai_assistant.settings.agentOverridesDescription',
          'Resolved model for each registered agent. Agents with a custom override show a Clear button.',
        )}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="pb-2 pr-4 font-medium">
                {t('ai_assistant.settings.agentIdColumn', 'Agent')}
              </th>
              <th className="pb-2 pr-4 font-medium">
                {t('ai_assistant.settings.providerColumn', 'Provider')}
              </th>
              <th className="pb-2 pr-4 font-medium">
                {t('ai_assistant.settings.modelColumn', 'Model')}
              </th>
              <th className="pb-2 pr-4 font-medium">
                {t('ai_assistant.settings.sourceColumn', 'Source')}
              </th>
              <th className="pb-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {agents.map((agent) => {
              const hasOverride = overriddenAgents.some((a) => a.agentId === agent.agentId)
              return (
                <tr
                  key={agent.agentId}
                  className="border-b border-border/50 last:border-0"
                  data-ai-settings-agent-row={agent.agentId}
                >
                  <td className="py-2 pr-4 font-mono">{agent.agentId}</td>
                  <td className="py-2 pr-4">{agent.providerId}</td>
                  <td className="py-2 pr-4">{agent.modelId}</td>
                  <td className="py-2 pr-4 text-muted-foreground">{agent.source}</td>
                  <td className="py-2">
                    {hasOverride ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 gap-1 text-xs"
                        disabled={clearMutation.isPending}
                        onClick={() => void handleClearAgentOverride(agent.agentId)}
                        data-ai-settings-clear-agent-override={agent.agentId}
                      >
                        <X className="size-3" aria-hidden />
                        {t('ai_assistant.settings.clearOverride', 'Clear override')}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function AiAssistantSettingsContent() {
  const t = useT()
  const queryClient = useQueryClient()
  const [toolsExpanded, setToolsExpanded] = React.useState(false)
  const [mcpConfigOpen, setMcpConfigOpen] = React.useState(false)
  const [sessionKeyOpen, setSessionKeyOpen] = React.useState(false)
  const { isEnabled, toggleEnabled, isLoaded } = useAiAssistantVisibility()

  const openAiAssistant = () => {
    window.dispatchEvent(new CustomEvent('om:open-ai-chat'))
  }

  const healthQuery = useQuery({
    queryKey: ['ai-assistant', 'health'],
    queryFn: fetchHealth,
    refetchInterval: 10000,
    staleTime: 5000,
  })

  const settingsQuery = useQuery({
    queryKey: ['ai-assistant', 'settings'],
    queryFn: fetchSettings,
    staleTime: 60000,
  })

  const toolsQuery = useQuery({
    queryKey: ['ai-assistant', 'tools'],
    queryFn: fetchTools,
    staleTime: 60000,
  })

  const handleOverrideSaved = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['ai-assistant', 'settings'] })
  }, [queryClient])

  const isLoading = healthQuery.isLoading || settingsQuery.isLoading || toolsQuery.isLoading

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-8 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {t('ai_assistant.settings.loading', 'Loading settings...')}
      </div>
    )
  }

  const health = healthQuery.data
  const settings = settingsQuery.data
  const tools = toolsQuery.data?.tools ?? []

  const toolsByModule = tools.reduce<Record<string, ToolInfo[]>>((acc, tool) => {
    const module = tool.module || 'other'
    if (!acc[module]) acc[module] = []
    acc[module].push(tool)
    return acc
  }, {})

  const provider = settings?.provider

  return (
    <div className="flex flex-col gap-6" data-ai-assistant-settings="">
      <div className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Bot className="size-6" />
          {t('ai_assistant.settings.pageTitle', 'AI Assistant Settings')}
        </h1>
        <p className="text-muted-foreground">
          {t('ai_assistant.settings.pageDescription', 'Configure and monitor the AI assistant')}
        </p>
      </div>

      <div className="rounded-lg border bg-card p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Bot className="size-5" />
              {t('ai_assistant.settings.visibilityTitle', 'AI Assistant')}
            </h2>
            <p className="text-sm text-muted-foreground">
              {isEnabled
                ? t('ai_assistant.settings.visibilityEnabled', 'Visible in header with Cmd+J shortcut enabled.')
                : t('ai_assistant.settings.visibilityDisabled', 'Hidden from header. Enable to show the button and Cmd+J shortcut.')}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3 rounded-md border bg-muted/30 px-4 py-2">
              <span className="text-sm font-medium">
                {t('ai_assistant.settings.visibilityToggleLabel', 'Visibility')}
              </span>
              {isEnabled ? (
                <Eye className="size-4 text-muted-foreground" />
              ) : (
                <EyeOff className="size-4 text-muted-foreground" />
              )}
              <Switch
                checked={isEnabled}
                onCheckedChange={toggleEnabled}
                disabled={!isLoaded}
              />
            </div>
            <Button onClick={openAiAssistant} size="default" className="gap-2">
              <Bot className="size-4" />
              {t('ai_assistant.settings.openButton', 'Open AI Assistant')}
            </Button>
          </div>
        </div>
      </div>

      {settings ? (
        <GlobalOverrideForm
          availableProviders={settings.availableProviders}
          tenantOverride={settings.tenantOverride}
          onSaved={handleOverrideSaved}
        />
      ) : null}

      {settings?.agents && settings.agents.length > 0 ? (
        <PerAgentOverrideList
          agents={settings.agents}
          onCleared={handleOverrideSaved}
        />
      ) : null}

      <div className="rounded-lg border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Link2 className="size-4" />
            {t('ai_assistant.settings.connectionsTitle', 'Connections')}
          </h2>
          {healthQuery.isFetching && !healthQuery.isLoading ? (
            <Loader2 className="size-3 animate-spin text-muted-foreground" />
          ) : null}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div
            className={`rounded-lg border-2 p-4 ${
              health?.status === 'ok' && health.opencode?.healthy
                ? 'border-status-success-border bg-status-success-bg'
                : 'border-destructive/50 bg-destructive/5'
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Server className="size-4 shrink-0 text-muted-foreground" />
                  <p className="text-sm font-medium">OpenCode</p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {health?.status === 'ok' && health.opencode?.healthy ? (
                    <span className="flex items-center gap-1 text-status-success-text">
                      <CheckCircle2 className="size-3" />
                      {t('ai_assistant.settings.connected', 'Connected')}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-destructive">
                      <XCircle className="size-3" />
                      {health?.message ?? t('ai_assistant.settings.disconnected', 'Disconnected')}
                    </span>
                  )}
                </p>
                {health?.opencode?.version ? (
                  <p className="mt-1 text-xs text-muted-foreground">v{health.opencode.version}</p>
                ) : null}
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {health?.url ?? t('ai_assistant.settings.notConfigured', 'Not configured')}
                </p>
              </div>
              {health?.status === 'ok' && health.opencode?.healthy ? (
                <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-status-success-bg text-status-success-icon">
                  <svg className="size-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              ) : null}
            </div>
          </div>

          {(() => {
            const mcpConnected =
              health?.mcp && Object.values(health.mcp).some((s) => s.status === 'connected')
            const mcpConnecting =
              health?.mcp && Object.values(health.mcp).some((s) => s.status === 'connecting')
            const mcpError =
              health?.mcp && Object.values(health.mcp).find((s) => s.error)?.error
            return (
              <div
                className={`rounded-lg border-2 p-4 ${
                  mcpConnected
                    ? 'border-status-success-border bg-status-success-bg'
                    : mcpConnecting
                      ? 'border-status-warning-border bg-status-warning-bg'
                      : 'border-destructive/50 bg-destructive/5'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Wrench className="size-4 shrink-0 text-muted-foreground" />
                      <p className="text-sm font-medium">MCP Server</p>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {mcpConnected ? (
                        <span className="flex items-center gap-1 text-status-success-text">
                          <CheckCircle2 className="size-3" />
                          {t('ai_assistant.settings.connected', 'Connected')}
                        </span>
                      ) : mcpConnecting ? (
                        <span className="flex items-center gap-1 text-status-warning-text">
                          <Loader2 className="size-3 animate-spin" />
                          {t('ai_assistant.settings.connecting', 'Connecting...')}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-destructive">
                          <XCircle className="size-3" />
                          {mcpError ?? t('ai_assistant.settings.disconnected', 'Disconnected')}
                        </span>
                      )}
                    </p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {health?.mcpUrl ?? t('ai_assistant.settings.notConfigured', 'Not configured')}
                    </p>
                  </div>
                  {mcpConnected ? (
                    <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-status-success-bg text-status-success-icon">
                      <svg className="size-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  ) : null}
                </div>
              </div>
            )
          })()}

          <div
            className={`rounded-lg border-2 p-4 ${
              health?.search?.available
                ? 'border-status-success-border bg-status-success-bg'
                : 'border-destructive/50 bg-destructive/5'
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Database className="size-4 shrink-0 text-muted-foreground" />
                  <p className="text-sm font-medium">Meilisearch</p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {health?.search?.available ? (
                    <span className="flex items-center gap-1 text-status-success-text">
                      <CheckCircle2 className="size-3" />
                      {t('ai_assistant.settings.connected', 'Connected')}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-destructive">
                      <XCircle className="size-3" />
                      {t('ai_assistant.settings.notAvailable', 'Not available')}
                    </span>
                  )}
                </p>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {health?.search?.url ?? t('ai_assistant.settings.notConfigured', 'Not configured')}
                </p>
              </div>
              {health?.search?.available ? (
                <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-status-success-bg text-status-success-icon">
                  <svg className="size-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-md border bg-muted/30 p-3">
          <div className="flex items-center gap-2 text-sm">
            <Key className="size-4 text-muted-foreground" />
            <span className="font-medium">
              {t('ai_assistant.settings.mcpAuthLabel', 'MCP Authentication:')}
            </span>
            {settings?.mcpKeyConfigured ? (
              <span className="flex items-center gap-1 text-xs text-status-success-text">
                <CheckCircle2 className="size-3" />
                {t('ai_assistant.settings.mcpKeyConfigured', 'MCP_SERVER_API_KEY configured')}
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs text-status-warning-text">
                <XCircle className="size-3" />
                {t('ai_assistant.settings.mcpKeyMissing', 'MCP_SERVER_API_KEY not set')}
              </span>
            )}
          </div>
          <p className="ml-6 mt-1 text-xs text-muted-foreground">
            {t(
              'ai_assistant.settings.mcpAuthNote',
              'Required for AI to access platform tools via MCP server.',
            )}
          </p>
        </div>

        <div className="mt-4 rounded-md border bg-muted/30 p-3">
          <div className="flex items-center gap-2 text-sm">
            <Server className="size-4 text-muted-foreground" />
            <span className="font-medium">
              {t('ai_assistant.settings.llmProviderLabel', 'LLM Provider:')}
            </span>
            <span className="font-medium">{provider?.name ?? 'Anthropic'}</span>
            {provider?.configured ? (
              <span className="flex items-center gap-1 text-xs text-status-success-text">
                <CheckCircle2 className="size-3" />
                {provider?.envKey
                  ? t('ai_assistant.settings.envKeyConfigured', '{{key}} configured', { key: provider.envKey })
                  : t('ai_assistant.settings.configured', 'Configured')}
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs text-status-warning-text">
                <XCircle className="size-3" />
                {t('ai_assistant.settings.envKeyMissing', '{{key}} not set', { key: provider?.envKey ?? 'ANTHROPIC_API_KEY' })}
              </span>
            )}
          </div>
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          {t(
            'ai_assistant.settings.meilisearchNote',
            'Meilisearch is required for API endpoint discovery. Endpoints are indexed automatically when the MCP server starts.',
          )}
        </p>
      </div>

      <div className="rounded-lg border bg-card p-6">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
          <Settings className="size-4" />
          {t('ai_assistant.settings.developerToolsTitle', 'Developer Tools')}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border bg-muted/30 p-4">
            <div className="flex items-start gap-3">
              <div className="rounded-md bg-primary/10 p-2">
                <Settings className="size-5 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-medium">
                  {t('ai_assistant.settings.mcpConfigTitle', 'MCP Configuration')}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t(
                    'ai_assistant.settings.mcpConfigDescription',
                    'Generate config for Claude Code or other MCP clients.',
                  )}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  onClick={() => setMcpConfigOpen(true)}
                >
                  {t('ai_assistant.settings.generateMcpConfig', 'Generate MCP Config')}
                </Button>
              </div>
            </div>
          </div>

          <div className="rounded-lg border bg-muted/30 p-4">
            <div className="flex items-start gap-3">
              <div className="rounded-md bg-primary/10 p-2">
                <Key className="size-5 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-medium">
                  {t('ai_assistant.settings.sessionKeyTitle', 'Session API Key')}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t(
                    'ai_assistant.settings.sessionKeyDescription',
                    'Generate a temporary token for programmatic LLM access. Expires after 2 hours.',
                  )}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  onClick={() => setSessionKeyOpen(true)}
                >
                  {t('ai_assistant.settings.generateSessionKey', 'Generate Session Key')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <McpConfigDialog
        open={mcpConfigOpen}
        onOpenChange={setMcpConfigOpen}
        mcpUrl={health?.mcpUrl ?? 'http://localhost:3001'}
      />
      <SessionKeyDialog
        open={sessionKeyOpen}
        onOpenChange={setSessionKeyOpen}
      />

      <div className="rounded-lg border bg-card p-6">
        <button
          type="button"
          onClick={() => setToolsExpanded((prev) => !prev)}
          className="flex w-full items-center justify-between text-left"
        >
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Wrench className="size-4" />
            {t('ai_assistant.settings.mcpToolsTitle', 'MCP Tools')} ({tools.length}{' '}
            {t('ai_assistant.settings.mcpToolsCount', 'tools')})
          </h2>
          {toolsExpanded ? (
            <ChevronDown className="size-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 text-muted-foreground" />
          )}
        </button>

        {toolsExpanded ? (
          <div className="mt-4 space-y-4">
            {Object.entries(toolsByModule).map(([module, moduleTools]) => (
              <div key={module} className="space-y-2">
                <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {module}
                </h3>
                <div className="space-y-1">
                  {moduleTools.map((tool) => (
                    <div key={tool.name} className="border-l-2 border-muted py-1 pl-2">
                      <p className="text-sm font-medium">{tool.name}</p>
                      <p className="text-xs text-muted-foreground">{tool.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function AiAssistantSettingsPageClient() {
  return <AiAssistantSettingsContent />
}

export default AiAssistantSettingsPageClient
