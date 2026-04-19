'use client'

import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  Bot,
  BookOpen,
  CheckCircle2,
  History,
  Image as ImageIcon,
  FileText,
  Loader2,
  Lock,
  Paperclip,
  RefreshCcw,
  Save,
  ShieldAlert,
  Trash2,
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

type OverrideVersion = {
  id: string
  agentId: string
  version: number
  sections: Record<string, string>
  notes: string | null
  createdByUserId: string | null
  createdAt: string
  updatedAt: string
}

type OverrideResponse = {
  agentId: string
  override: OverrideVersion | null
  versions: OverrideVersion[]
}

async function fetchOverride(agentId: string): Promise<OverrideResponse> {
  const res = await fetch(
    `/api/ai_assistant/ai/agents/${encodeURIComponent(agentId)}/prompt-override`,
    { method: 'GET', credentials: 'include' },
  )
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `Failed to load prompt override (${res.status})`)
  }
  return (await res.json()) as OverrideResponse
}

type MutationPolicy = 'read-only' | 'confirm-required' | 'destructive-confirm-required'

const MUTATION_POLICY_OPTIONS: MutationPolicy[] = [
  'read-only',
  'destructive-confirm-required',
  'confirm-required',
]

// Higher number = less restrictive. Mirrors
// `lib/agent-policy.ts#POLICY_RESTRICTIVENESS` — UI must match the server's
// escalation guard so disabled options line up with 400 responses.
const POLICY_RESTRICTIVENESS_UI: Record<MutationPolicy, number> = {
  'read-only': 0,
  'destructive-confirm-required': 1,
  'confirm-required': 2,
}

type MutationPolicyOverrideRow = {
  id: string
  agentId: string
  mutationPolicy: MutationPolicy
  notes: string | null
  createdByUserId: string | null
  createdAt: string
  updatedAt: string
}

type MutationPolicyResponse = {
  agentId: string
  codeDeclared: MutationPolicy
  override: MutationPolicyOverrideRow | null
}

async function fetchMutationPolicy(agentId: string): Promise<MutationPolicyResponse> {
  const res = await fetch(
    `/api/ai_assistant/ai/agents/${encodeURIComponent(agentId)}/mutation-policy`,
    { method: 'GET', credentials: 'include' },
  )
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `Failed to load mutation policy (${res.status})`)
  }
  return (await res.json()) as MutationPolicyResponse
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

function MutationPolicySection({ agent }: { agent: AgentSettings }) {
  const t = useT()
  const queryClient = useQueryClient()

  const query = useQuery<MutationPolicyResponse>({
    queryKey: ['ai_assistant', 'agent_settings', 'mutation_policy', agent.id],
    queryFn: () => fetchMutationPolicy(agent.id),
    retry: false,
  })

  const codeDeclared = (query.data?.codeDeclared ?? (agent.mutationPolicy as MutationPolicy))
  const currentOverride = query.data?.override ?? null

  const [selected, setSelected] = React.useState<MutationPolicy | null>(null)
  const [isSaving, setIsSaving] = React.useState(false)
  const [isClearing, setIsClearing] = React.useState(false)
  const [state, setState] = React.useState<
    | { kind: 'idle' }
    | { kind: 'success'; message: string }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' })

  React.useEffect(() => {
    setSelected(currentOverride?.mutationPolicy ?? null)
    setState({ kind: 'idle' })
  }, [agent.id, currentOverride?.mutationPolicy])

  const codeRank = POLICY_RESTRICTIVENESS_UI[codeDeclared] ?? 0
  const effectivePolicy: MutationPolicy = (() => {
    if (!currentOverride) return codeDeclared
    const overrideRank = POLICY_RESTRICTIVENESS_UI[currentOverride.mutationPolicy]
    return overrideRank < codeRank ? currentOverride.mutationPolicy : codeDeclared
  })()

  const hasChange = selected !== null && selected !== (currentOverride?.mutationPolicy ?? null)

  const save = React.useCallback(async () => {
    if (!selected || isSaving) return
    setIsSaving(true)
    setState({ kind: 'idle' })
    try {
      const res = await fetch(
        `/api/ai_assistant/ai/agents/${encodeURIComponent(agent.id)}/mutation-policy`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ mutationPolicy: selected }),
        },
      )
      const payload = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
        code?: string
        codeDeclared?: MutationPolicy
        requested?: MutationPolicy
      }
      if (!res.ok) {
        const message =
          payload.code === 'escalation_not_allowed'
            ? (payload.error ??
                t(
                  'ai_assistant.agents.mutation_policy.errors.escalationNotAllowed',
                  'Cannot upgrade beyond the agent\'s declared policy — this is a code-level change.',
                ))
            : (payload.error ??
                `Failed to save mutation policy (${res.status}).`)
        setState({ kind: 'error', message })
        return
      }
      setState({
        kind: 'success',
        message: t(
          'ai_assistant.agents.mutation_policy.savedMessage',
          'Mutation policy override saved.',
        ),
      })
      await queryClient.invalidateQueries({
        queryKey: ['ai_assistant', 'agent_settings', 'mutation_policy', agent.id],
      })
    } catch (err) {
      setState({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setIsSaving(false)
    }
  }, [agent.id, isSaving, queryClient, selected, t])

  const clear = React.useCallback(async () => {
    if (isClearing) return
    setIsClearing(true)
    setState({ kind: 'idle' })
    try {
      const res = await fetch(
        `/api/ai_assistant/ai/agents/${encodeURIComponent(agent.id)}/mutation-policy`,
        {
          method: 'DELETE',
          credentials: 'include',
        },
      )
      const payload = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
      }
      if (!res.ok) {
        setState({
          kind: 'error',
          message: payload.error ?? `Failed to clear override (${res.status}).`,
        })
        return
      }
      setState({
        kind: 'success',
        message: t(
          'ai_assistant.agents.mutation_policy.clearedMessage',
          'Mutation policy override cleared; agent is using its code-declared policy.',
        ),
      })
      await queryClient.invalidateQueries({
        queryKey: ['ai_assistant', 'agent_settings', 'mutation_policy', agent.id],
      })
    } catch (err) {
      setState({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setIsClearing(false)
    }
  }, [agent.id, isClearing, queryClient, t])

  return (
    <section
      className="rounded-lg border border-border bg-background p-4"
      data-ai-agent-mutation-policy={agent.id}
    >
      <header className="flex items-center justify-between gap-3 border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className="size-4 text-muted-foreground" aria-hidden />
          <div>
            <h3 className="text-sm font-semibold">
              {t('ai_assistant.agents.mutation_policy.title', 'Mutation policy')}
            </h3>
            <p className="text-xs text-muted-foreground">
              {t(
                'ai_assistant.agents.mutation_policy.subtitle',
                'Downgrade this agent\'s mutation capability per tenant. Upgrading beyond the code-declared policy is blocked by the server.',
              )}
            </p>
          </div>
        </div>
        <StatusBadge
          variant={mutationPolicyStatusMap[effectivePolicy] ?? 'neutral'}
          dot
          data-ai-agent-mutation-policy-effective
        >
          {effectivePolicy}
        </StatusBadge>
      </header>

      <div className="mt-3 flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <span className="text-overline font-semibold uppercase tracking-wider text-muted-foreground">
              {t('ai_assistant.agents.mutation_policy.codeDeclared', 'Code-declared')}
            </span>
            <div className="mt-1 flex items-center gap-2">
              <StatusBadge
                variant={mutationPolicyStatusMap[codeDeclared] ?? 'neutral'}
                dot
                data-ai-agent-mutation-policy-code-declared
              >
                {codeDeclared}
              </StatusBadge>
              <Lock className="size-3 text-muted-foreground" aria-hidden />
              <span className="text-xs text-muted-foreground">
                {t(
                  'ai_assistant.agents.mutation_policy.codeDeclaredHint',
                  'Compiled into the agent definition.',
                )}
              </span>
            </div>
          </div>
          <div>
            <span className="text-overline font-semibold uppercase tracking-wider text-muted-foreground">
              {t('ai_assistant.agents.mutation_policy.tenantOverride', 'Tenant override')}
            </span>
            <div className="mt-1">
              {currentOverride ? (
                <StatusBadge
                  variant={mutationPolicyStatusMap[currentOverride.mutationPolicy] ?? 'neutral'}
                  dot
                  data-ai-agent-mutation-policy-override-current
                >
                  {currentOverride.mutationPolicy}
                </StatusBadge>
              ) : (
                <span
                  className="text-xs text-muted-foreground"
                  data-ai-agent-mutation-policy-override-empty
                >
                  {t(
                    'ai_assistant.agents.mutation_policy.noOverride',
                    'No override — using code-declared policy.',
                  )}
                </span>
              )}
            </div>
          </div>
        </div>

        <Alert variant="info" data-ai-agent-mutation-policy-notice>
          <ShieldAlert className="size-4" aria-hidden />
          <AlertTitle>
            {t(
              'ai_assistant.agents.mutation_policy.noticeTitle',
              'Downgrade only — escalation is a code change',
            )}
          </AlertTitle>
          <AlertDescription>
            {t(
              'ai_assistant.agents.mutation_policy.noticeBody',
              'Overrides can only make the policy more restrictive. Options more permissive than the code-declared policy are disabled and rejected server-side.',
            )}
          </AlertDescription>
        </Alert>

        {query.isLoading ? (
          <SettingsLoading
            message={t(
              'ai_assistant.agents.mutation_policy.loading',
              'Loading mutation policy...',
            )}
          />
        ) : query.isError ? (
          <Alert variant="destructive" data-ai-agent-mutation-policy-load-error>
            <AlertCircle className="size-4" aria-hidden />
            <AlertTitle>
              {t(
                'ai_assistant.agents.mutation_policy.loadErrorTitle',
                'Failed to load mutation policy',
              )}
            </AlertTitle>
            <AlertDescription>
              {query.error instanceof Error ? query.error.message : String(query.error)}
            </AlertDescription>
          </Alert>
        ) : (
          <div
            className="flex flex-col gap-2"
            role="radiogroup"
            aria-label={t(
              'ai_assistant.agents.mutation_policy.pickerLabel',
              'Mutation policy override',
            )}
            data-ai-agent-mutation-policy-picker
          >
            {MUTATION_POLICY_OPTIONS.map((option) => {
              const optionRank = POLICY_RESTRICTIVENESS_UI[option]
              const wouldEscalate = optionRank > codeRank
              const isSelected = selected === option
              return (
                <Tooltip key={option}>
                  <TooltipTrigger asChild>
                    <label
                      className={`flex items-start gap-3 rounded-md border px-3 py-2 text-sm cursor-pointer transition-colors ${
                        wouldEscalate
                          ? 'border-border bg-muted/30 cursor-not-allowed opacity-60'
                          : isSelected
                            ? 'border-primary bg-primary/5'
                            : 'border-border bg-background hover:bg-muted/40'
                      }`}
                      data-ai-agent-mutation-policy-option={option}
                      data-ai-agent-mutation-policy-option-disabled={wouldEscalate ? 'true' : 'false'}
                    >
                      <input
                        type="radio"
                        name={`mutation-policy-${agent.id}`}
                        value={option}
                        checked={isSelected}
                        disabled={wouldEscalate}
                        onChange={() => {
                          if (wouldEscalate) return
                          setSelected(option)
                        }}
                        className="mt-0.5"
                        aria-disabled={wouldEscalate}
                      />
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <span className="flex items-center gap-2">
                          <StatusBadge
                            variant={mutationPolicyStatusMap[option] ?? 'neutral'}
                            dot
                          >
                            {option}
                          </StatusBadge>
                          {wouldEscalate ? (
                            <Lock className="size-3 text-muted-foreground" aria-hidden />
                          ) : null}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {t(
                            `ai_assistant.agents.mutation_policy.options.${option}`,
                            option,
                          )}
                        </span>
                      </div>
                    </label>
                  </TooltipTrigger>
                  {wouldEscalate ? (
                    <TooltipContent>
                      {t(
                        'ai_assistant.agents.mutation_policy.escalationTooltip',
                        "Cannot be set above the agent's declared policy — this is a code-level change.",
                      )}
                    </TooltipContent>
                  ) : null}
                </Tooltip>
              )
            })}
          </div>
        )}

        {state.kind === 'success' ? (
          <Alert variant="success" data-ai-agent-mutation-policy-state="success">
            <CheckCircle2 className="size-4" aria-hidden />
            <AlertTitle>
              {t('ai_assistant.agents.mutation_policy.savedTitle', 'Mutation policy updated')}
            </AlertTitle>
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        ) : null}
        {state.kind === 'error' ? (
          <Alert variant="destructive" data-ai-agent-mutation-policy-state="error">
            <AlertCircle className="size-4" aria-hidden />
            <AlertTitle>
              {t(
                'ai_assistant.agents.mutation_policy.errorTitle',
                'Failed to update mutation policy',
              )}
            </AlertTitle>
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void clear()}
            disabled={isClearing || isSaving || !currentOverride}
            data-ai-agent-mutation-policy-clear
          >
            {isClearing ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Trash2 className="size-4" aria-hidden />
            )}
            <span>{t('ai_assistant.agents.mutation_policy.clear', 'Clear override')}</span>
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void save()}
            disabled={isSaving || isClearing || !hasChange || selected === null}
            data-ai-agent-mutation-policy-save
          >
            {isSaving ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Save className="size-4" aria-hidden />
            )}
            <span>{t('ai_assistant.agents.mutation_policy.save', 'Save override')}</span>
          </Button>
        </div>
      </div>
    </section>
  )
}

function AgentDetailPanel({ agent }: { agent: AgentSettings }) {
  const t = useT()
  const queryClient = useQueryClient()
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
    | { kind: 'success'; message: string; version: number }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' })

  const overrideQuery = useQuery<OverrideResponse>({
    queryKey: ['ai_assistant', 'agent_settings', 'override', agent.id],
    queryFn: () => fetchOverride(agent.id),
    retry: false,
  })

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

  // Hydrate drafts when the latest override lands.
  React.useEffect(() => {
    const latest = overrideQuery.data?.override
    if (!latest) return
    const nextFlags: Record<PromptSectionId, boolean> = {
      role: false,
      scope: false,
      data: false,
      tools: false,
      attachments: false,
      mutationPolicy: false,
      responseStyle: false,
      overrides: false,
    }
    const nextDrafts: Record<PromptSectionId, string> = {
      role: '',
      scope: '',
      data: '',
      tools: '',
      attachments: '',
      mutationPolicy: '',
      responseStyle: '',
      overrides: '',
    }
    for (const [rawKey, value] of Object.entries(latest.sections ?? {})) {
      if (typeof value !== 'string') continue
      const key = rawKey as PromptSectionId
      if (PROMPT_SECTION_IDS.includes(key)) {
        nextFlags[key] = true
        nextDrafts[key] = value
      }
    }
    setOverrideFlags(nextFlags)
    setOverrideDrafts(nextDrafts)
  }, [overrideQuery.data?.override])

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
          body: JSON.stringify({
            // Send both keys so a pre-Step-5.3 server still accepts the payload.
            sections: activeOverrides,
            overrides: activeOverrides,
          }),
        },
      )
      const payload = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        pending?: boolean
        version?: number
        updatedAt?: string
        message?: string
        error?: string
        code?: string
        reservedKeys?: string[]
      }
      if (!res.ok) {
        const message =
          payload.code === 'reserved_key'
            ? t(
                'ai_assistant.agents.override.errors.reservedKey',
                'Prompt overrides cannot modify policy fields (mutationPolicy, readOnly, allowedTools, acceptedMediaTypes). Remove those sections and retry.',
              )
            : (payload.error ?? `Failed to save overrides (${res.status}).`)
        setSaveState({ kind: 'error', message })
        return
      }
      if (payload.ok === true && typeof payload.version === 'number') {
        setSaveState({
          kind: 'success',
          version: payload.version,
          message: t(
            'ai_assistant.agents.override.savedMessage',
            'Prompt override saved.',
          ),
        })
        await queryClient.invalidateQueries({
          queryKey: ['ai_assistant', 'agent_settings', 'override', agent.id],
        })
        return
      }
      // Legacy placeholder response: surfaces the Step-4.5 wording for BC.
      setSaveState({
        kind: 'success',
        version: 0,
        message:
          payload.message ??
          t(
            'ai_assistant.agents.prompt.pendingMessage',
            'Prompt overrides accepted.',
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
  }, [activeOverrides, agent.id, isSaving, queryClient, t])

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

      <MutationPolicySection agent={agent} />

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
                'Toggle any section to write an additive override. Saving stores a new tenant-scoped version; built-in section text is always preserved.',
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
              {t('ai_assistant.agents.override.noticeTitle', 'Prompt overrides are additive')}
            </AlertTitle>
            <AlertDescription>
              {t(
                'ai_assistant.agents.override.noticeBody',
                'Overrides append to the built-in sections — they never remove or replace shipped text. Saved versions are tenant-scoped and auditable from the history panel below.',
              )}
            </AlertDescription>
          </Alert>
        </div>
        {saveState.kind === 'success' ? (
          <Alert variant="success" className="mt-3" data-ai-agent-prompt-state="success">
            <CheckCircle2 className="size-4" aria-hidden />
            <AlertTitle>
              {saveState.version > 0
                ? t('ai_assistant.agents.override.savedTitle', 'Prompt override saved')
                : t('ai_assistant.agents.prompt.pendingTitle', 'Overrides accepted')}
            </AlertTitle>
            <AlertDescription>
              {saveState.version > 0
                ? `${saveState.message} ${t('ai_assistant.agents.override.versionLabel', 'Version')} ${saveState.version}.`
                : saveState.message}
            </AlertDescription>
          </Alert>
        ) : null}
        {saveState.kind === 'error' ? (
          <Alert variant="destructive" className="mt-3" data-ai-agent-prompt-state="error">
            <AlertCircle className="size-4" aria-hidden />
            <AlertTitle>
              {t('ai_assistant.agents.override.errorTitle', 'Failed to save prompt override')}
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
        data-ai-agent-override-history={agent.id}
      >
        <header className="flex items-center justify-between gap-3 border-b border-border pb-3">
          <div className="flex items-center gap-2">
            <History className="size-4 text-muted-foreground" aria-hidden />
            <div>
              <h3 className="text-sm font-semibold">
                {t('ai_assistant.agents.override.history.title', 'Prompt override history')}
              </h3>
              <p className="text-xs text-muted-foreground">
                {t(
                  'ai_assistant.agents.override.history.subtitle',
                  'Newest first. Each save creates a new version scoped to the current tenant.',
                )}
              </p>
            </div>
          </div>
          {overrideQuery.data ? (
            <Badge variant="neutral" className="font-mono text-xs">
              {overrideQuery.data.versions.length}
            </Badge>
          ) : null}
        </header>
        <div className="mt-3 flex flex-col gap-2">
          {overrideQuery.isLoading ? (
            <SettingsLoading
              message={t(
                'ai_assistant.agents.override.history.loading',
                'Loading override history...',
              )}
            />
          ) : overrideQuery.isError ? (
            <Alert variant="destructive" data-ai-agent-override-history-error>
              <AlertCircle className="size-4" aria-hidden />
              <AlertTitle>
                {t(
                  'ai_assistant.agents.override.history.errorTitle',
                  'Failed to load override history',
                )}
              </AlertTitle>
              <AlertDescription>
                {overrideQuery.error instanceof Error
                  ? overrideQuery.error.message
                  : String(overrideQuery.error)}
              </AlertDescription>
            </Alert>
          ) : (overrideQuery.data?.versions ?? []).length === 0 ? (
            <p
              className="text-xs text-muted-foreground"
              data-ai-agent-override-history-empty
            >
              {t(
                'ai_assistant.agents.override.history.empty',
                'No prompt overrides have been saved for this agent yet.',
              )}
            </p>
          ) : (
            (overrideQuery.data?.versions ?? []).slice(0, 5).map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2"
                data-ai-agent-override-history-row={entry.version}
              >
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-semibold">
                    {t('ai_assistant.agents.override.versionLabel', 'Version')} {entry.version}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {new Date(entry.updatedAt).toLocaleString()}
                  </span>
                </div>
                <Badge variant="neutral" className="font-mono text-xs">
                  {Object.keys(entry.sections ?? {}).length}{' '}
                  {t('ai_assistant.agents.override.history.sectionsLabel', 'sections')}
                </Badge>
              </div>
            ))
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
              'Inspect every registered agent and manage tenant-scoped additive prompt-section overrides.',
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
