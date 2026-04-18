'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AlertCircle,
  Bot,
  BookOpen,
  CheckCircle2,
  Image as ImageIcon,
  FileText,
  Loader2,
  Paperclip,
  RefreshCcw,
  Save,
  Wand2,
  Wrench,
} from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Label } from '@open-mercato/ui/primitives/label'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@open-mercato/ui/primitives/tooltip'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { useAiShortcuts } from '@open-mercato/ui/ai'

// Step 4.6: the <select>-based agent picker is deliberately duplicated between the
// playground and this settings page. Duplicated markup is under the 50-line
// threshold, so extraction stays deferred per the Step 4.6 brief.

type AgentTool = {
  name: string
  displayName: string
  isMutation: boolean
  registered: boolean
}

type AgentSettings = {
  id: string
  moduleId: string
  label: string
  description: string
  systemPrompt: string
  executionMode: 'chat' | 'object'
  mutationPolicy: string
  readOnly: boolean
  maxSteps: number | null
  allowedTools: string[]
  tools: AgentTool[]
  requiredFeatures: string[]
  acceptedMediaTypes: string[]
  hasOutputSchema: boolean
}

type AgentsResponse = {
  agents: AgentSettings[]
  total: number
}

const PROMPT_SECTION_IDS = [
  'role',
  'scope',
  'data',
  'tools',
  'attachments',
  'mutationPolicy',
  'responseStyle',
  'overrides',
] as const

type PromptSectionId = (typeof PROMPT_SECTION_IDS)[number]

const mutationPolicyStatusMap: StatusMap<string> = {
  'read-only': 'neutral',
  'confirm-required': 'warning',
  'destructive-confirm-required': 'error',
}

const executionModeStatusMap: StatusMap<'chat' | 'object'> = {
  chat: 'info',
  object: 'success',
}

const mediaTypeIconMap: Record<string, React.ElementType> = {
  image: ImageIcon,
  pdf: FileText,
  file: Paperclip,
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

function SettingsLoading({ message }: { message: string }) {
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

function EmptyAgents() {
  const t = useT()
  return (
    <EmptyState
      icon={<Bot className="size-6" aria-hidden />}
      title={t(
        'ai_assistant.agents.empty.title',
        'No AI agents are registered for your role yet.',
      )}
      description={t(
        'ai_assistant.agents.empty.description',
        'Declare agents inside `packages/<module>/src/modules/<module>/ai-agents.ts`, run `yarn generate`, and ensure the caller holds the agent\'s required features.',
      )}
    >
      <div className="mt-2 inline-flex items-center gap-2 text-xs text-muted-foreground">
        <BookOpen className="size-3" aria-hidden />
        <span>
          {t(
            'ai_assistant.agents.empty.docLabel',
            'See packages/ai-assistant/AGENTS.md for the agent definition reference.',
          )}
        </span>
      </div>
    </EmptyState>
  )
}

function PromptSectionEditor({
  sectionId,
  defaultText,
  overrideText,
  override,
  onToggleOverride,
  onOverrideChange,
  onSaveShortcut,
}: {
  sectionId: PromptSectionId
  defaultText: string
  overrideText: string
  override: boolean
  onToggleOverride: (next: boolean) => void
  onOverrideChange: (next: string) => void
  onSaveShortcut: () => void
}) {
  const t = useT()
  const sectionLabel = t(
    `ai_assistant.agents.prompt.sections.${sectionId}`,
    sectionId.charAt(0).toUpperCase() + sectionId.slice(1),
  )
  const textareaId = `ai-agent-prompt-${sectionId}`

  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)
  const { handleKeyDown } = useAiShortcuts({
    onSubmit: onSaveShortcut,
    onCancel: () => {
      textareaRef.current?.blur()
    },
  })

  return (
    <div
      className="flex flex-col gap-2 rounded-md border border-border bg-muted/20 p-3"
      data-ai-agent-prompt-section={sectionId}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-overline font-semibold uppercase tracking-wider text-muted-foreground">
            {sectionLabel}
          </span>
          <span className="text-xs text-muted-foreground">
            {override
              ? t(
                  'ai_assistant.agents.prompt.overrideModeLabel',
                  'Override mode — replaces the default when persistence lands.',
                )
              : t(
                  'ai_assistant.agents.prompt.defaultModeLabel',
                  'Default — shipped with the agent definition.',
                )}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor={`${textareaId}-toggle`} className="text-xs">
            {t('ai_assistant.agents.prompt.toggleOverride', 'Override')}
          </Label>
          <Switch
            id={`${textareaId}-toggle`}
            checked={override}
            onCheckedChange={(next: boolean) => onToggleOverride(next)}
            aria-label={t('ai_assistant.agents.prompt.toggleOverride', 'Override')}
            data-ai-agent-prompt-toggle={sectionId}
          />
        </div>
      </div>
      {override ? (
        <Textarea
          id={textareaId}
          ref={textareaRef}
          rows={4}
          value={overrideText}
          onChange={(event) => onOverrideChange(event.target.value)}
          onKeyDown={handleKeyDown}
          className="resize-y font-mono text-xs"
          placeholder={t(
            'ai_assistant.agents.prompt.overridePlaceholder',
            'Write the replacement text for this section...',
          )}
          aria-label={`${sectionLabel} override`}
          data-ai-agent-prompt-override={sectionId}
        />
      ) : (
        <pre
          className="max-h-40 overflow-auto rounded border border-border bg-background p-2 text-xs font-mono whitespace-pre-wrap"
          data-ai-agent-prompt-default={sectionId}
        >
          {defaultText}
        </pre>
      )}
    </div>
  )
}

function ToolRow({ tool }: { tool: AgentTool }) {
  const t = useT()
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2"
      data-ai-agent-tool-row={tool.name}
    >
      <div className="flex items-start gap-2 min-w-0">
        <Wrench className="mt-0.5 size-4 text-muted-foreground" aria-hidden />
        <div className="flex flex-col min-w-0">
          <span className="truncate text-sm font-medium">{tool.displayName}</span>
          <span className="truncate text-xs font-mono text-muted-foreground">{tool.name}</span>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {tool.isMutation ? (
          <StatusBadge variant="warning" dot>
            {t('ai_assistant.agents.tools.mutationBadge', 'Mutation')}
          </StatusBadge>
        ) : (
          <StatusBadge variant="neutral" dot>
            {t('ai_assistant.agents.tools.readBadge', 'Read')}
          </StatusBadge>
        )}
        {!tool.registered ? (
          <StatusBadge variant="error" dot>
            {t('ai_assistant.agents.tools.missingBadge', 'Missing')}
          </StatusBadge>
        ) : null}
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center gap-1">
              <Label
                htmlFor={`ai-agent-tool-${tool.name}`}
                className="text-xs text-muted-foreground"
              >
                {t('ai_assistant.agents.tools.enabledLabel', 'Enabled')}
              </Label>
              <Switch
                id={`ai-agent-tool-${tool.name}`}
                checked
                disabled
                aria-label={t('ai_assistant.agents.tools.enabledLabel', 'Enabled')}
                data-ai-agent-tool-switch={tool.name}
              />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {t(
              'ai_assistant.agents.tools.tooltipDisabled',
              'Editable after Phase 3 lands mutation policy controls.',
            )}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}

function AttachmentPolicyBadges({ mediaTypes }: { mediaTypes: string[] }) {
  const t = useT()
  if (!mediaTypes.length) {
    return (
      <Badge variant="neutral">
        {t('ai_assistant.agents.attachments.noneBadge', 'No attachments accepted')}
      </Badge>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {mediaTypes.map((mediaType) => {
        const Icon = mediaTypeIconMap[mediaType] ?? Paperclip
        return (
          <Badge
            key={mediaType}
            variant="info"
            className="gap-1.5"
            data-ai-agent-attachment-badge={mediaType}
          >
            <Icon className="size-3" aria-hidden />
            <span className="font-mono text-xs">{mediaType}</span>
          </Badge>
        )
      })}
    </div>
  )
}

function AgentDetailPanel({ agent }: { agent: AgentSettings }) {
  const t = useT()
  const [overrideFlags, setOverrideFlags] = React.useState<Record<PromptSectionId, boolean>>(() => ({
    role: false,
    scope: false,
    data: false,
    tools: false,
    attachments: false,
    mutationPolicy: false,
    responseStyle: false,
    overrides: false,
  }))
  const [overrideDrafts, setOverrideDrafts] = React.useState<Record<PromptSectionId, string>>(() => ({
    role: '',
    scope: '',
    data: '',
    tools: '',
    attachments: '',
    mutationPolicy: '',
    responseStyle: '',
    overrides: '',
  }))
  const [isSaving, setIsSaving] = React.useState(false)
  const [saveState, setSaveState] = React.useState<
    | { kind: 'idle' }
    | { kind: 'pending'; message: string }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' })

  // Reset override state whenever the selected agent changes.
  React.useEffect(() => {
    setOverrideFlags({
      role: false,
      scope: false,
      data: false,
      tools: false,
      attachments: false,
      mutationPolicy: false,
      responseStyle: false,
      overrides: false,
    })
    setOverrideDrafts({
      role: '',
      scope: '',
      data: '',
      tools: '',
      attachments: '',
      mutationPolicy: '',
      responseStyle: '',
      overrides: '',
    })
    setSaveState({ kind: 'idle' })
  }, [agent.id])

  const activeOverrides = React.useMemo(() => {
    const payload: Record<string, string> = {}
    for (const section of PROMPT_SECTION_IDS) {
      if (overrideFlags[section]) {
        payload[section] = overrideDrafts[section]
      }
    }
    return payload
  }, [overrideDrafts, overrideFlags])

  const hasAnyOverride = Object.keys(activeOverrides).length > 0

  const handleSave = React.useCallback(async () => {
    if (isSaving) return
    setIsSaving(true)
    setSaveState({ kind: 'idle' })
    try {
      const res = await fetch(
        `/api/ai_assistant/ai/agents/${encodeURIComponent(agent.id)}/prompt-override`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ overrides: activeOverrides }),
        },
      )
      const payload = (await res.json().catch(() => ({}))) as {
        pending?: boolean
        message?: string
        error?: string
      }
      if (!res.ok) {
        setSaveState({
          kind: 'error',
          message: payload.error ?? `Failed to submit overrides (${res.status}).`,
        })
        return
      }
      setSaveState({
        kind: 'pending',
        message:
          payload.message ??
          t(
            'ai_assistant.agents.prompt.pendingMessage',
            'Prompt overrides accepted. Persistence lands in Phase 3 Step 5.3.',
          ),
      })
    } catch (err) {
      setSaveState({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setIsSaving(false)
    }
  }, [activeOverrides, agent.id, isSaving, t])

  return (
    <div className="flex flex-col gap-4" data-ai-agent-detail={agent.id}>
      <section className="rounded-lg border border-border bg-background p-4">
        <h2 className="text-xl font-semibold">{agent.label}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{agent.description}</p>
        <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <div>
            <dt className="text-overline font-semibold uppercase tracking-wider text-muted-foreground">
              {t('ai_assistant.agents.meta.module', 'Module')}
            </dt>
            <dd className="mt-1 font-mono text-xs">{agent.moduleId}</dd>
          </div>
          <div>
            <dt className="text-overline font-semibold uppercase tracking-wider text-muted-foreground">
              {t('ai_assistant.agents.meta.id', 'Agent id')}
            </dt>
            <dd className="mt-1 font-mono text-xs">{agent.id}</dd>
          </div>
          <div>
            <dt className="text-overline font-semibold uppercase tracking-wider text-muted-foreground">
              {t('ai_assistant.agents.meta.executionMode', 'Execution mode')}
            </dt>
            <dd className="mt-1">
              <StatusBadge variant={executionModeStatusMap[agent.executionMode]}>
                {agent.executionMode}
              </StatusBadge>
            </dd>
          </div>
          <div>
            <dt className="text-overline font-semibold uppercase tracking-wider text-muted-foreground">
              {t('ai_assistant.agents.meta.mutationPolicy', 'Mutation policy')}
            </dt>
            <dd className="mt-1">
              <StatusBadge
                variant={mutationPolicyStatusMap[agent.mutationPolicy] ?? 'neutral'}
                dot
              >
                {agent.mutationPolicy}
              </StatusBadge>
            </dd>
          </div>
          <div>
            <dt className="text-overline font-semibold uppercase tracking-wider text-muted-foreground">
              {t('ai_assistant.agents.meta.readOnly', 'Read-only')}
            </dt>
            <dd className="mt-1 text-xs">
              {agent.readOnly
                ? t('ai_assistant.agents.meta.readOnlyYes', 'Yes')
                : t('ai_assistant.agents.meta.readOnlyNo', 'No')}
            </dd>
          </div>
          <div>
            <dt className="text-overline font-semibold uppercase tracking-wider text-muted-foreground">
              {t('ai_assistant.agents.meta.maxSteps', 'Max steps')}
            </dt>
            <dd className="mt-1 font-mono text-xs">
              {agent.maxSteps ?? t('ai_assistant.agents.meta.unlimited', 'Unlimited')}
            </dd>
          </div>
        </dl>
      </section>

      <section
        className="rounded-lg border border-border bg-background p-4"
        data-ai-agent-prompt-editor={agent.id}
      >
        <header className="flex items-center justify-between gap-3 border-b border-border pb-3">
          <div>
            <h3 className="text-sm font-semibold">
              {t('ai_assistant.agents.prompt.title', 'Prompt sections')}
            </h3>
            <p className="text-xs text-muted-foreground">
              {t(
                'ai_assistant.agents.prompt.subtitle',
                'Toggle any section to write an additive override. Saving sends the overrides to a placeholder route today; real persistence lands with Step 5.3.',
              )}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() => void handleSave()}
            disabled={isSaving || !hasAnyOverride}
            data-ai-agent-prompt-save
          >
            {isSaving ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Save className="size-4" aria-hidden />
            )}
            <span>{t('ai_assistant.agents.prompt.save', 'Save overrides')}</span>
          </Button>
        </header>
        <div className="mt-3">
          <Alert variant="info" data-ai-agent-prompt-notice>
            <Wand2 className="size-4" aria-hidden />
            <AlertTitle>
              {t('ai_assistant.agents.prompt.noticeTitle', 'Prompt overrides are local-only today')}
            </AlertTitle>
            <AlertDescription>
              {t(
                'ai_assistant.agents.prompt.noticeBody',
                'Submitting this form calls a placeholder endpoint that responds with `{ pending: true }`. Versioned prompt-override storage lands with Phase 3 Step 5.3.',
              )}
            </AlertDescription>
          </Alert>
        </div>
        {saveState.kind === 'pending' ? (
          <Alert variant="success" className="mt-3" data-ai-agent-prompt-state="pending">
            <CheckCircle2 className="size-4" aria-hidden />
            <AlertTitle>
              {t('ai_assistant.agents.prompt.pendingTitle', 'Overrides accepted')}
            </AlertTitle>
            <AlertDescription>{saveState.message}</AlertDescription>
          </Alert>
        ) : null}
        {saveState.kind === 'error' ? (
          <Alert variant="destructive" className="mt-3" data-ai-agent-prompt-state="error">
            <AlertCircle className="size-4" aria-hidden />
            <AlertTitle>
              {t('ai_assistant.agents.prompt.errorTitle', 'Failed to submit overrides')}
            </AlertTitle>
            <AlertDescription>{saveState.message}</AlertDescription>
          </Alert>
        ) : null}
        <div className="mt-3 flex flex-col gap-3">
          <div>
            <span className="text-overline font-semibold uppercase tracking-wider text-muted-foreground">
              {t('ai_assistant.agents.prompt.fullSystemPromptLabel', 'Full system prompt (default)')}
            </span>
            <pre className="mt-2 max-h-40 overflow-auto rounded border border-border bg-muted/30 p-2 text-xs font-mono whitespace-pre-wrap">
              {agent.systemPrompt}
            </pre>
          </div>
          {PROMPT_SECTION_IDS.map((sectionId) => (
            <PromptSectionEditor
              key={sectionId}
              sectionId={sectionId}
              defaultText={
                sectionId === 'role'
                  ? agent.systemPrompt
                  : t(
                      'ai_assistant.agents.prompt.defaultSectionPlaceholder',
                      'No default copy declared for this section — the agent ships a single systemPrompt. Override to inject additional text once Step 5.3 lands.',
                    )
              }
              overrideText={overrideDrafts[sectionId]}
              override={overrideFlags[sectionId]}
              onToggleOverride={(next) =>
                setOverrideFlags((prev) => ({ ...prev, [sectionId]: next }))
              }
              onOverrideChange={(next) =>
                setOverrideDrafts((prev) => ({ ...prev, [sectionId]: next }))
              }
              onSaveShortcut={() => void handleSave()}
            />
          ))}
        </div>
      </section>

      <section
        className="rounded-lg border border-border bg-background p-4"
        data-ai-agent-tools-list={agent.id}
      >
        <header className="flex items-center justify-between gap-3 border-b border-border pb-3">
          <div>
            <h3 className="text-sm font-semibold">
              {t('ai_assistant.agents.tools.title', 'Allowed tools')}
            </h3>
            <p className="text-xs text-muted-foreground">
              {t(
                'ai_assistant.agents.tools.subtitle',
                'Read-only surface in Phase 2. Editing the per-tool toggle and mutation policy lands in Step 5.4 / Phase 3.',
              )}
            </p>
          </div>
          <Badge variant="neutral" className="font-mono text-xs">
            {agent.tools.length}
          </Badge>
        </header>
        <div className="mt-3 flex flex-col gap-2">
          {agent.tools.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t(
                'ai_assistant.agents.tools.emptyBody',
                'This agent declares no tools in its allowedTools whitelist.',
              )}
            </p>
          ) : (
            agent.tools.map((tool) => <ToolRow key={tool.name} tool={tool} />)
          )}
        </div>
      </section>

      <section
        className="rounded-lg border border-border bg-background p-4"
        data-ai-agent-attachments={agent.id}
      >
        <header className="flex items-center justify-between gap-3 border-b border-border pb-3">
          <div>
            <h3 className="text-sm font-semibold">
              {t('ai_assistant.agents.attachments.title', 'Attachment policy')}
            </h3>
            <p className="text-xs text-muted-foreground">
              {t(
                'ai_assistant.agents.attachments.subtitle',
                'Accepted media types the agent declares. Read-only in Phase 2.',
              )}
            </p>
          </div>
        </header>
        <div className="mt-3">
          <AttachmentPolicyBadges mediaTypes={agent.acceptedMediaTypes} />
        </div>
      </section>
    </div>
  )
}

export function AiAgentSettingsPageClient() {
  const t = useT()
  const [selectedAgentId, setSelectedAgentId] = React.useState<string | null>(null)

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<AgentsResponse>({
    queryKey: ['ai_assistant', 'agent_settings', 'agents'],
    queryFn: fetchAgents,
  })

  const agents = React.useMemo<AgentSettings[]>(() => data?.agents ?? [], [data])

  React.useEffect(() => {
    if (!agents.length) {
      if (selectedAgentId !== null) setSelectedAgentId(null)
      return
    }
    if (!selectedAgentId || !agents.some((agent) => agent.id === selectedAgentId)) {
      setSelectedAgentId(agents[0].id)
    }
  }, [agents, selectedAgentId])

  const selectedAgent = React.useMemo<AgentSettings | null>(() => {
    if (!selectedAgentId) return null
    return agents.find((agent) => agent.id === selectedAgentId) ?? null
  }, [agents, selectedAgentId])

  if (isLoading) {
    return (
      <SettingsLoading
        message={t('ai_assistant.agents.loadingAgents', 'Loading AI agents...')}
      />
    )
  }

  if (isError) {
    return (
      <Alert variant="destructive" data-ai-agent-settings-error>
        <AlertCircle className="size-4" aria-hidden />
        <AlertTitle>
          {t('ai_assistant.agents.loadErrorTitle', 'Failed to load AI agents')}
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
              <span>{t('ai_assistant.agents.retry', 'Retry')}</span>
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    )
  }

  if (!agents.length) {
    return <EmptyAgents />
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex flex-col gap-4" data-ai-agent-settings>
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight">
            {t('ai_assistant.agents.title', 'AI Agents')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t(
              'ai_assistant.agents.subtitle',
              'Inspect every registered agent and draft additive prompt-section overrides. Prompt overrides are local-only today — persistence lands in Phase 3 Step 5.3.',
            )}
          </p>
        </header>

        <section
          className="flex flex-col gap-3 rounded-lg border border-border bg-background p-3"
          data-ai-agent-settings-picker-wrap
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex flex-col gap-2 sm:flex-1">
              <Label htmlFor="ai-agent-settings-picker">
                {t('ai_assistant.agents.agentPickerLabel', 'Agent')}
              </Label>
              <select
                id="ai-agent-settings-picker"
                data-ai-agent-settings-picker
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
            <div className="flex items-center gap-2 sm:flex-shrink-0">
              <IconButton
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  void refetch()
                }}
                aria-label={t('ai_assistant.agents.refresh', 'Refresh agents')}
                disabled={isFetching}
              >
                <RefreshCcw className="size-4" aria-hidden />
              </IconButton>
            </div>
          </div>
        </section>

        {selectedAgent ? <AgentDetailPanel agent={selectedAgent} /> : null}
      </div>
    </TooltipProvider>
  )
}

export default AiAgentSettingsPageClient
