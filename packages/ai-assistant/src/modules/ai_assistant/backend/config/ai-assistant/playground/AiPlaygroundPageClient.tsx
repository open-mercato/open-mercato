'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertCircle, Bot, BookOpen, Loader2, Play, RefreshCcw } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Label } from '@open-mercato/ui/primitives/label'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@open-mercato/ui/primitives/tabs'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { AiChat, createAiUiPartRegistry, useAiShortcuts } from '@open-mercato/ui/ai'
import type { AiChatDebugPromptSection, AiChatDebugTool } from '@open-mercato/ui/ai'

type PlaygroundAgentTool = {
  name: string
  displayName?: string
  isMutation?: boolean
  registered?: boolean
  requiredFeatures?: string[]
}

type PlaygroundAgent = {
  id: string
  moduleId: string
  label: string
  description: string
  executionMode: 'chat' | 'object'
  mutationPolicy: string
  allowedTools: string[]
  requiredFeatures: string[]
  acceptedMediaTypes: string[]
  hasOutputSchema: boolean
  systemPrompt?: string
  readOnly?: boolean
  maxSteps?: number | null
  tools?: PlaygroundAgentTool[]
}

type AgentsResponse = {
  agents: PlaygroundAgent[]
  total: number
}

type RunObjectResponse = {
  object: unknown
  finishReason?: string
  usage?: { inputTokens?: number; outputTokens?: number }
}

type RunObjectError = {
  error: string
  code?: string
  issues?: unknown
}

async function fetchAgents(): Promise<AgentsResponse> {
  const res = await fetch('/api/ai_assistant/ai/agents', {
    method: 'GET',
    credentials: 'include',
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `Failed to load agents (${res.status})`)
  }
  return (await res.json()) as AgentsResponse
}

function PlaygroundLoading({ message }: { message: string }) {
  return (
    <div
      className="flex items-center gap-2 rounded-lg border border-border bg-background p-4 text-sm text-muted-foreground"
      role="status"
    >
      <Loader2 className="size-4 animate-spin" aria-hidden />
      <span>{message}</span>
    </div>
  )
}

function PlaygroundNoAgents() {
  const t = useT()
  return (
    <EmptyState
      icon={<Bot className="size-6" aria-hidden />}
      title={t(
        'ai_assistant.playground.empty.title',
        'No AI agents are registered for your role yet.',
      )}
      description={t(
        'ai_assistant.playground.empty.description',
        'Declare agents inside `packages/<module>/src/modules/<module>/ai-agents.ts`, run `yarn generate`, and ensure the caller holds the agent\'s required features.',
      )}
    >
      <div className="mt-2 inline-flex items-center gap-2 text-xs text-muted-foreground">
        <BookOpen className="size-3" aria-hidden />
        <span>
          {t(
            'ai_assistant.playground.empty.docLabel',
            'See packages/ai-assistant/AGENTS.md for the agent definition reference.',
          )}
        </span>
      </div>
    </EmptyState>
  )
}

function AgentDetails({ agent }: { agent: PlaygroundAgent }) {
  const t = useT()
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
      <div className="font-semibold">{agent.label}</div>
      <p className="mt-1 text-xs text-muted-foreground">{agent.description}</p>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div>
          <dt className="font-medium text-muted-foreground">
            {t('ai_assistant.playground.meta.module', 'Module')}
          </dt>
          <dd className="font-mono">{agent.moduleId}</dd>
        </div>
        <div>
          <dt className="font-medium text-muted-foreground">
            {t('ai_assistant.playground.meta.executionMode', 'Execution mode')}
          </dt>
          <dd className="font-mono">{agent.executionMode}</dd>
        </div>
        <div>
          <dt className="font-medium text-muted-foreground">
            {t('ai_assistant.playground.meta.mutationPolicy', 'Mutation policy')}
          </dt>
          <dd className="font-mono">{agent.mutationPolicy}</dd>
        </div>
        <div>
          <dt className="font-medium text-muted-foreground">
            {t('ai_assistant.playground.meta.tools', 'Allowed tools')}
          </dt>
          <dd className="font-mono">{agent.allowedTools.length}</dd>
        </div>
      </dl>
    </div>
  )
}

function buildDebugTools(agent: PlaygroundAgent): AiChatDebugTool[] {
  if (agent.tools && agent.tools.length > 0) {
    return agent.tools.map((tool) => ({
      name: tool.name,
      displayName: tool.displayName ?? tool.name,
      isMutation: Boolean(tool.isMutation),
      requiredFeatures: tool.requiredFeatures ?? [],
    }))
  }
  return agent.allowedTools.map((toolName) => ({ name: toolName }))
}

function buildDebugPromptSections(agent: PlaygroundAgent): AiChatDebugPromptSection[] {
  const sections: AiChatDebugPromptSection[] = []
  if (agent.systemPrompt) {
    sections.push({ id: 'role', source: 'default', text: agent.systemPrompt })
  }
  const placeholderIds = [
    'scope',
    'data',
    'tools',
    'attachments',
    'mutationPolicy',
    'responseStyle',
    'overrides',
  ] as const
  for (const id of placeholderIds) {
    sections.push({ id, source: 'placeholder' })
  }
  return sections
}

type PlaygroundUiPartSeed = {
  componentId: string
  pendingActionId?: string
  payload?: unknown
}

function readPlaygroundUiPartSeeds(): PlaygroundUiPartSeed[] {
  if (typeof window === 'undefined') return []
  try {
    const params = new URLSearchParams(window.location.search)
    const componentId = params.get('uiPart')
    if (!componentId) return []
    const pendingActionId = params.get('pendingActionId') ?? undefined
    return [{ componentId, pendingActionId }]
  } catch {
    return []
  }
}

function ChatLane({ agent, debug }: { agent: PlaygroundAgent; debug: boolean }) {
  const t = useT()
  // Scoped registry so repeated mounts do not share state with other pages.
  // Step 5.10: opt in to the LIVE mutation-approval cards so the playground
  // exercises the real cards when the chat response surfaces a pending
  // action (via the `?uiPart=...` debug seed for Playwright).
  const registry = React.useMemo(
    () => createAiUiPartRegistry({ seedLiveApprovalCards: true }),
    [],
  )
  const debugTools = React.useMemo(() => buildDebugTools(agent), [agent])
  const debugPromptSections = React.useMemo(
    () => buildDebugPromptSections(agent),
    [agent],
  )
  const [uiParts, setUiParts] = React.useState<PlaygroundUiPartSeed[]>([])

  // Step 5.10: the dispatcher does not yet surface `AiUiPart` entries through
  // the plain-text stream consumed by `useAiChat`. For now the playground
  // reads a `?uiPart=<componentId>&pendingActionId=...` seed from the URL
  // so Playwright + operator debug flows can render the approval cards
  // against a stubbed `/api/ai_assistant/ai/actions/:id` endpoint. When the
  // dispatcher switches to the UIMessageChunk format this effect swaps over
  // to the streamed `uiParts` payload.
  React.useEffect(() => {
    const seeds = readPlaygroundUiPartSeeds()
    if (seeds.length > 0) setUiParts(seeds)
  }, [])

  if (agent.executionMode !== 'chat') {
    return (
      <Alert variant="info" data-ai-playground-unsupported="chat">
        <AlertTitle>
          {t(
            'ai_assistant.playground.chat.notSupportedTitle',
            'Chat mode is not available for this agent.',
          )}
        </AlertTitle>
        <AlertDescription>
          {t(
            'ai_assistant.playground.chat.notSupportedBody',
            'Pick an agent whose execution mode is "chat", or switch to the object-mode tab.',
          )}
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <AiChat
      key={agent.id}
      agent={agent.id}
      pageContext={{ source: 'playground', pageId: 'ai_assistant.playground' }}
      debug={debug}
      registry={registry}
      className="min-h-[360px]"
      debugTools={debugTools}
      debugPromptSections={debugPromptSections}
      uiParts={uiParts}
    />
  )
}

function ObjectLane({ agent }: { agent: PlaygroundAgent }) {
  const t = useT()
  const [prompt, setPrompt] = React.useState('')
  const [isRunning, setIsRunning] = React.useState(false)
  const [result, setResult] = React.useState<RunObjectResponse | null>(null)
  const [error, setError] = React.useState<RunObjectError | null>(null)
  const [lastRequest, setLastRequest] = React.useState<unknown>(null)

  const isSupported = agent.executionMode === 'object'
  const canRun = isSupported && prompt.trim().length > 0 && !isRunning

  const runObject = React.useCallback(async () => {
    if (!canRun) return
    const body = {
      agent: agent.id,
      messages: [{ role: 'user' as const, content: prompt }],
      pageContext: { source: 'playground', pageId: 'ai_assistant.playground' },
    }
    setLastRequest(body)
    setIsRunning(true)
    setResult(null)
    setError(null)
    try {
      const res = await fetch('/api/ai_assistant/ai/run-object', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as RunObjectError
        setError(payload)
        return
      }
      const payload = (await res.json()) as RunObjectResponse
      setResult(payload)
    } catch (err) {
      setError({
        error: err instanceof Error ? err.message : String(err),
        code: 'network_error',
      })
    } finally {
      setIsRunning(false)
    }
  }, [agent.id, canRun, prompt])

  const { handleKeyDown } = useAiShortcuts({
    onSubmit: () => {
      void runObject()
    },
    onCancel: () => {
      setError(null)
    },
  })

  if (!isSupported) {
    return (
      <Alert variant="info" data-ai-playground-unsupported="object">
        <AlertTitle>
          {t(
            'ai_assistant.playground.object.notSupportedTitle',
            'Object mode is not available for this agent.',
          )}
        </AlertTitle>
        <AlertDescription>
          {t(
            'ai_assistant.playground.object.notSupportedBody',
            'This agent declares executionMode = "chat". Pick an object-mode agent to preview structured output, or switch to the chat tab.',
          )}
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="flex flex-col gap-3" data-ai-playground-object>
      <div className="flex flex-col gap-2">
        <Label htmlFor="ai-playground-object-input">
          {t('ai_assistant.playground.object.inputLabel', 'Prompt')}
        </Label>
        <Textarea
          id="ai-playground-object-input"
          rows={4}
          value={prompt}
          placeholder={t(
            'ai_assistant.playground.object.inputPlaceholder',
            'Describe what the agent should produce...',
          )}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={handleKeyDown}
          className="resize-none"
          aria-label={t('ai_assistant.playground.object.inputLabel', 'Prompt')}
        />
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {t(
              'ai_assistant.playground.object.shortcutHint',
              'Press Cmd/Ctrl+Enter to run.',
            )}
          </p>
          <Button
            type="button"
            size="sm"
            onClick={() => void runObject()}
            disabled={!canRun}
            data-ai-playground-object-run
          >
            {isRunning ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Play className="size-4" aria-hidden />
            )}
            <span>{t('ai_assistant.playground.object.run', 'Run object')}</span>
          </Button>
        </div>
      </div>

      {error ? (
        <Alert variant="destructive" data-ai-playground-object-error={error.code ?? 'unknown'}>
          <AlertTitle>
            {t('ai_assistant.playground.object.errorTitle', 'Object run failed')}
          </AlertTitle>
          <AlertDescription>
            {error.code ? <span className="mr-2 font-mono text-xs">{error.code}</span> : null}
            {error.error}
          </AlertDescription>
        </Alert>
      ) : null}

      {result ? (
        <section
          className="rounded-md border border-border bg-muted/30 p-3"
          data-ai-playground-object-result
        >
          <h3 className="text-sm font-semibold">
            {t('ai_assistant.playground.object.resultTitle', 'Generated object')}
          </h3>
          <pre className="mt-2 max-h-96 overflow-auto rounded bg-background p-2 text-xs font-mono">
            {JSON.stringify(result.object, null, 2)}
          </pre>
          {result.usage || result.finishReason ? (
            <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
              {result.finishReason ? (
                <div>
                  <dt className="text-muted-foreground">
                    {t('ai_assistant.playground.object.finishReason', 'Finish reason')}
                  </dt>
                  <dd className="font-mono">{result.finishReason}</dd>
                </div>
              ) : null}
              {result.usage?.inputTokens !== undefined ? (
                <div>
                  <dt className="text-muted-foreground">
                    {t('ai_assistant.playground.object.inputTokens', 'Input tokens')}
                  </dt>
                  <dd className="font-mono">{result.usage.inputTokens}</dd>
                </div>
              ) : null}
              {result.usage?.outputTokens !== undefined ? (
                <div>
                  <dt className="text-muted-foreground">
                    {t('ai_assistant.playground.object.outputTokens', 'Output tokens')}
                  </dt>
                  <dd className="font-mono">{result.usage.outputTokens}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
        </section>
      ) : null}

      {lastRequest && (error || result) ? (
        <details
          className="rounded-md border border-border bg-muted/20 p-2 text-xs"
          data-ai-playground-object-debug
        >
          <summary className="cursor-pointer font-semibold">
            {t('ai_assistant.playground.object.debugTitle', 'Last request payload')}
          </summary>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap font-mono">
            {JSON.stringify(lastRequest, null, 2)}
          </pre>
        </details>
      ) : null}
    </div>
  )
}

export function AiPlaygroundPageClient() {
  const t = useT()
  const [selectedAgentId, setSelectedAgentId] = React.useState<string | null>(null)
  const [debugEnabled, setDebugEnabled] = React.useState(false)
  const [tab, setTab] = React.useState<'chat' | 'object'>('chat')

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<AgentsResponse>({
    queryKey: ['ai_assistant', 'playground', 'agents'],
    queryFn: fetchAgents,
  })

  const agents = React.useMemo<PlaygroundAgent[]>(() => data?.agents ?? [], [data])

  React.useEffect(() => {
    if (!agents.length) {
      if (selectedAgentId !== null) setSelectedAgentId(null)
      return
    }
    if (!selectedAgentId || !agents.some((agent) => agent.id === selectedAgentId)) {
      setSelectedAgentId(agents[0].id)
    }
  }, [agents, selectedAgentId])

  const selectedAgent = React.useMemo<PlaygroundAgent | null>(() => {
    if (!selectedAgentId) return null
    return agents.find((agent) => agent.id === selectedAgentId) ?? null
  }, [agents, selectedAgentId])

  if (isLoading) {
    return (
      <PlaygroundLoading
        message={t('ai_assistant.playground.loadingAgents', 'Loading AI agents...')}
      />
    )
  }

  if (isError) {
    return (
      <Alert variant="destructive" data-ai-playground-error>
        <AlertCircle className="size-4" aria-hidden />
        <AlertTitle>
          {t('ai_assistant.playground.loadErrorTitle', 'Failed to load AI agents')}
        </AlertTitle>
        <AlertDescription>
          <span>{error instanceof Error ? error.message : String(error)}</span>
          <div className="mt-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                void refetch()
              }}
            >
              <RefreshCcw className="size-4" aria-hidden />
              <span>{t('ai_assistant.playground.retry', 'Retry')}</span>
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    )
  }

  if (!agents.length) {
    return <PlaygroundNoAgents />
  }

  return (
    <div className="flex flex-col gap-4" data-ai-playground>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">
          {t('ai_assistant.playground.title', 'AI Playground')}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t(
            'ai_assistant.playground.subtitle',
            'Exercise every registered AI agent end-to-end. Use the debug panel to inspect request and response payloads, and the object-mode tab to preview structured output.',
          )}
        </p>
      </header>

      <section className="flex flex-col gap-3 rounded-lg border border-border bg-background p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-2 sm:flex-1">
            <Label htmlFor="ai-playground-agent-picker">
              {t('ai_assistant.playground.agentPickerLabel', 'Agent')}
            </Label>
            <select
              id="ai-playground-agent-picker"
              data-ai-playground-agent-picker
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={selectedAgentId ?? ''}
              onChange={(event) => setSelectedAgentId(event.target.value)}
            >
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.label} ({agent.id})
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-3 sm:flex-shrink-0">
            <Label htmlFor="ai-playground-debug" className="text-sm">
              {t('ai_assistant.playground.debugToggle', 'Debug panel')}
            </Label>
            <Switch
              id="ai-playground-debug"
              checked={debugEnabled}
              onCheckedChange={(next: boolean) => setDebugEnabled(next)}
              aria-label={t('ai_assistant.playground.debugToggle', 'Debug panel')}
              data-ai-playground-debug-toggle
            />
            <IconButton
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                void refetch()
              }}
              aria-label={t('ai_assistant.playground.refresh', 'Refresh agents')}
              disabled={isFetching}
            >
              <RefreshCcw className="size-4" aria-hidden />
            </IconButton>
          </div>
        </div>
        {selectedAgent ? <AgentDetails agent={selectedAgent} /> : null}
      </section>

      {selectedAgent ? (
        <Tabs
          value={tab}
          onValueChange={(next: string) => setTab(next === 'object' ? 'object' : 'chat')}
        >
          <TabsList>
            <TabsTrigger value="chat">
              {t('ai_assistant.playground.tabs.chat', 'Chat')}
            </TabsTrigger>
            <TabsTrigger value="object">
              {t('ai_assistant.playground.tabs.object', 'Object mode')}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="chat">
            <ChatLane agent={selectedAgent} debug={debugEnabled} />
          </TabsContent>
          <TabsContent value="object">
            <ObjectLane agent={selectedAgent} />
          </TabsContent>
        </Tabs>
      ) : null}
    </div>
  )
}

export default AiPlaygroundPageClient
