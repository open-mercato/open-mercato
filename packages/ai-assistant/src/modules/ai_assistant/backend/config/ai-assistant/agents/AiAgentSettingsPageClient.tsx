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
  ShieldOff,
  Trash2,
  Wand2,
  Wrench,
} from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Radio, RadioGroup } from '@open-mercato/ui/primitives/radio'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
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
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useAiShortcuts } from '@open-mercato/ui/ai'

// The agent picker is deliberately duplicated between the playground and this
// settings page. Duplicated markup is under the 50-line threshold, so extraction
// stays deferred per the Step 4.6 brief.

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
  defaultProvider: string | null
  defaultModel: string | null
  defaultBaseUrl: string | null
  allowRuntimeModelOverride: boolean
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

type ProviderConfig = {
  id: string
  name: string
  defaultModel: string
  configured: boolean
  defaultModels: Array<{ id: string; name: string }>
}

type AgentResolution = {
  agentId: string
  moduleId: string
  allowRuntimeModelOverride: boolean
  codeDefaultProviderId: string | null
  codeDefaultModelId: string | null
  override: {
    providerId: string | null
    modelId: string | null
    baseURL: string | null
    updatedAt: string
  } | null
  runtimeOverrideAllowlist: {
    env: TenantAllowlist | null
    tenant: TenantAllowlist | null
    effective: EffectiveAllowlist
    envVarNames: {
      providers: string
      modelsByProvider: Record<string, string>
    }
  }
  providerId: string
  modelId: string
  baseURL: string | null
  source: string
}

type TenantAllowlist = {
  allowedProviders: string[] | null
  allowedModelsByProvider: Record<string, string[]>
}

type EffectiveAllowlist = {
  providers: string[] | null
  modelsByProvider: Record<string, string[]>
  hasRestrictions: boolean
  tenantOverridesActive: boolean
}

type RuntimeSettingsResponse = {
  availableProviders: ProviderConfig[]
  agents: AgentResolution[]
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
  const { result, status } = await apiCallOrThrow<AgentsResponse>(
    '/api/ai_assistant/ai/agents',
    { method: 'GET', credentials: 'include' },
    { errorMessage: 'Failed to load agents' },
  )
  if (!result) throw new Error(`Failed to load agents (${status})`)
  return result
}

async function fetchRuntimeSettings(): Promise<RuntimeSettingsResponse> {
  const { result, status } = await apiCallOrThrow<RuntimeSettingsResponse>(
    '/api/ai_assistant/settings',
    { method: 'GET', credentials: 'include' },
    { errorMessage: 'Failed to load runtime settings' },
  )
  if (!result) throw new Error(`Failed to load runtime settings (${status})`)
  return result
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
  const { result, status } = await apiCallOrThrow<OverrideResponse>(
    `/api/ai_assistant/ai/agents/${encodeURIComponent(agentId)}/prompt-override`,
    { method: 'GET', credentials: 'include' },
    { errorMessage: 'Failed to load prompt override' },
  )
  if (!result) throw new Error(`Failed to load prompt override (${status})`)
  return result
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
  const { result, status } = await apiCallOrThrow<MutationPolicyResponse>(
    `/api/ai_assistant/ai/agents/${encodeURIComponent(agentId)}/mutation-policy`,
    { method: 'GET', credentials: 'include' },
    { errorMessage: 'Failed to load mutation policy' },
  )
  if (!result) throw new Error(`Failed to load mutation policy (${status})`)
  return result
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col">
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
      className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2"
      data-ai-agent-tool-row={tool.name}
    >
      <div className="flex items-start gap-2 min-w-0">
        <Wrench className="mt-0.5 size-4 text-muted-foreground" aria-hidden />
        <div className="flex flex-col min-w-0">
          <span className="truncate text-sm font-medium">{tool.displayName}</span>
          <span className="truncate text-xs font-mono text-muted-foreground">{tool.name}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
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
  const { runMutation: runSavePolicyMutation } = useGuardedMutation({
    contextId: `ai-agent-mutation-policy-save-${agent.id}`,
  })
  const { runMutation: runClearPolicyMutation } = useGuardedMutation({
    contextId: `ai-agent-mutation-policy-clear-${agent.id}`,
  })

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
      await runSavePolicyMutation({
        operation: async () => {
          const { ok, status, result } = await apiCall<{
            ok?: boolean
            error?: string
            code?: string
            codeDeclared?: MutationPolicy
            requested?: MutationPolicy
          }>(
            `/api/ai_assistant/ai/agents/${encodeURIComponent(agent.id)}/mutation-policy`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ mutationPolicy: selected }),
            },
          )
          const payload = result ?? {}
          if (!ok) {
            const message =
              payload.code === 'escalation_not_allowed'
                ? (payload.error ??
                    t(
                      'ai_assistant.agents.mutation_policy.errors.escalationNotAllowed',
                      'Cannot upgrade beyond the agent\'s declared policy — this is a code-level change.',
                    ))
                : (payload.error ??
                    `Failed to save mutation policy (${status}).`)
            throw new Error(message)
          }
        },
        context: {},
      })
      const successMessage = t(
        'ai_assistant.agents.mutation_policy.savedMessage',
        'Mutation policy override saved.',
      )
      setState({ kind: 'success', message: successMessage })
      flash(successMessage, 'success')
      await queryClient.invalidateQueries({
        queryKey: ['ai_assistant', 'agent_settings', 'mutation_policy', agent.id],
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setState({ kind: 'error', message })
      flash(message, 'error')
    } finally {
      setIsSaving(false)
    }
  }, [agent.id, isSaving, queryClient, runSavePolicyMutation, selected, t])

  const clear = React.useCallback(async () => {
    if (isClearing) return
    setIsClearing(true)
    setState({ kind: 'idle' })
    try {
      await runClearPolicyMutation({
        operation: async () => {
          const { ok, status, result } = await apiCall<{
            ok?: boolean
            error?: string
          }>(
            `/api/ai_assistant/ai/agents/${encodeURIComponent(agent.id)}/mutation-policy`,
            {
              method: 'DELETE',
              credentials: 'include',
            },
          )
          const payload = result ?? {}
          if (!ok) {
            throw new Error(payload.error ?? `Failed to clear override (${status}).`)
          }
        },
        context: {},
      })
      const successMessage = t(
        'ai_assistant.agents.mutation_policy.clearedMessage',
        'Mutation policy override cleared; agent is using its code-declared policy.',
      )
      setState({ kind: 'success', message: successMessage })
      flash(successMessage, 'success')
      await queryClient.invalidateQueries({
        queryKey: ['ai_assistant', 'agent_settings', 'mutation_policy', agent.id],
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setState({ kind: 'error', message })
      flash(message, 'error')
    } finally {
      setIsClearing(false)
    }
  }, [agent.id, isClearing, queryClient, t])

  return (
    <section
      className="rounded-lg border border-border bg-background p-4"
      data-ai-agent-mutation-policy={agent.id}
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
        <div className="flex min-w-0 items-start gap-2">
          <ShieldAlert className="size-4 text-muted-foreground" aria-hidden />
          <div className="min-w-0">
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
          className="max-w-full whitespace-normal break-all"
          data-ai-agent-mutation-policy-effective
        >
          {effectivePolicy}
        </StatusBadge>
      </header>

      <div className="mt-3 flex flex-col gap-3">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-3">
          <div className="min-w-0">
            <span className="text-overline font-semibold uppercase tracking-wider text-muted-foreground">
              {t('ai_assistant.agents.mutation_policy.codeDeclared', 'Code-declared')}
            </span>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <StatusBadge
                variant={mutationPolicyStatusMap[codeDeclared] ?? 'neutral'}
                dot
                className="max-w-full whitespace-normal break-all"
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
          <div className="min-w-0">
            <span className="text-overline font-semibold uppercase tracking-wider text-muted-foreground">
              {t('ai_assistant.agents.mutation_policy.tenantOverride', 'Tenant override')}
            </span>
            <div className="mt-1">
              {currentOverride ? (
                <StatusBadge
                  variant={mutationPolicyStatusMap[currentOverride.mutationPolicy] ?? 'neutral'}
                  dot
                  className="max-w-full whitespace-normal break-all"
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
          <RadioGroup
            value={selected ?? ''}
            onValueChange={(value) => {
              setSelected(value as MutationPolicy)
            }}
            className="flex flex-col gap-2"
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
                    <div
                      className={`flex items-start gap-3 rounded-md border px-3 py-2 text-sm cursor-pointer transition-colors ${
                        wouldEscalate
                          ? 'border-border bg-muted/30 cursor-not-allowed opacity-60'
                          : isSelected
                            ? 'border-accent-indigo bg-accent-indigo/5'
                            : 'border-border bg-background hover:bg-muted/40'
                      }`}
                      onClick={() => {
                        if (wouldEscalate) return
                        setSelected(option)
                      }}
                      data-ai-agent-mutation-policy-option={option}
                      data-ai-agent-mutation-policy-option-disabled={wouldEscalate ? 'true' : 'false'}
                    >
                      <Radio
                        value={option}
                        disabled={wouldEscalate}
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
                    </div>
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
          </RadioGroup>
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

        <div className="flex flex-wrap items-center justify-end gap-2">
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

function AgentModelOverrideSection({ agent }: { agent: AgentSettings }) {
  const t = useT()
  const queryClient = useQueryClient()
  const settingsQuery = useQuery<RuntimeSettingsResponse>({
    queryKey: ['ai_assistant', 'agent_settings', 'runtime_settings'],
    queryFn: fetchRuntimeSettings,
    retry: false,
  })

  const agentResolution = settingsQuery.data?.agents.find((entry) => entry.agentId === agent.id) ?? null
  const configuredProviders = React.useMemo(
    () => (settingsQuery.data?.availableProviders ?? []).filter((provider) => provider.configured),
    [settingsQuery.data?.availableProviders],
  )

  const [selectedProviderId, setSelectedProviderId] = React.useState('')
  const [selectedModelId, setSelectedModelId] = React.useState('')
  const [allowedProviders, setAllowedProviders] = React.useState<string[] | null>(null)
  const [allowedModelsByProvider, setAllowedModelsByProvider] = React.useState<Record<string, string[]>>({})
  const [allowlistDirty, setAllowlistDirty] = React.useState(false)
  const [isSaving, setIsSaving] = React.useState(false)
  const [isClearing, setIsClearing] = React.useState(false)
  const [isSavingAllowlist, setIsSavingAllowlist] = React.useState(false)
  const [state, setState] = React.useState<
    | { kind: 'idle' }
    | { kind: 'success'; message: string }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' })
  const { runMutation: runSaveModelOverrideMutation } = useGuardedMutation({
    contextId: `ai-agent-model-override-save-${agent.id}`,
  })
  const { runMutation: runClearModelOverrideMutation } = useGuardedMutation({
    contextId: `ai-agent-model-override-clear-${agent.id}`,
  })
  const { runMutation: runSaveModelAllowlistMutation } = useGuardedMutation({
    contextId: `ai-agent-model-override-allowlist-${agent.id}`,
  })

  React.useEffect(() => {
    const override = agentResolution?.override
    setSelectedProviderId(override?.providerId ?? '')
    setSelectedModelId(override?.modelId ?? '')
    setAllowedProviders(agentResolution?.runtimeOverrideAllowlist.tenant?.allowedProviders ?? null)
    setAllowedModelsByProvider({
      ...(agentResolution?.runtimeOverrideAllowlist.tenant?.allowedModelsByProvider ?? {}),
    })
    setAllowlistDirty(false)
    setState({ kind: 'idle' })
  }, [
    agent.id,
    agentResolution?.override?.modelId,
    agentResolution?.override?.providerId,
    agentResolution?.runtimeOverrideAllowlist.tenant,
  ])

  const selectedProvider = configuredProviders.find((provider) => provider.id === selectedProviderId)
  const isProviderAllowedForPicker = React.useCallback(
    (providerId: string) => {
      if (allowedProviders === null) return true
      return allowedProviders.includes(providerId)
    },
    [allowedProviders],
  )
  const isModelAllowedForPicker = React.useCallback(
    (providerId: string, modelId: string) => {
      const list = allowedModelsByProvider[providerId]
      if (list === undefined) return true
      return list.includes(modelId)
    },
    [allowedModelsByProvider],
  )
  const hasChange =
    selectedProviderId.length > 0 &&
    selectedModelId.length > 0 &&
    (
      selectedProviderId !== (agentResolution?.override?.providerId ?? '') ||
      selectedModelId !== (agentResolution?.override?.modelId ?? '')
    )

  const save = React.useCallback(async () => {
    if (isSaving || !selectedProviderId || !selectedModelId) return
    setIsSaving(true)
    setState({ kind: 'idle' })
    try {
      await runSaveModelOverrideMutation({
        operation: async () => {
          const { ok, status, result } = await apiCall<{ error?: string; code?: string }>(
            '/api/ai_assistant/settings',
            {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({
                agentId: agent.id,
                providerId: selectedProviderId,
                modelId: selectedModelId,
              }),
            },
          )
          if (!ok) {
            throw new Error(result?.error ?? `Failed to save model override (${status}).`)
          }
        },
        context: {},
      })
      const successMessage = t('ai_assistant.agents.model_override.saved', 'Model override saved.')
      setState({ kind: 'success', message: successMessage })
      flash(successMessage, 'success')
      await queryClient.invalidateQueries({
        queryKey: ['ai_assistant', 'agent_settings', 'runtime_settings'],
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setState({ kind: 'error', message })
      flash(message, 'error')
    } finally {
      setIsSaving(false)
    }
  }, [agent.id, isSaving, queryClient, runSaveModelOverrideMutation, selectedModelId, selectedProviderId, t])

  const clear = React.useCallback(async () => {
    if (isClearing) return
    setIsClearing(true)
    setState({ kind: 'idle' })
    try {
      await runClearModelOverrideMutation({
        operation: async () => {
          const { ok, status, result } = await apiCall<{ error?: string }>(
            '/api/ai_assistant/settings',
            {
              method: 'DELETE',
              headers: { 'content-type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ agentId: agent.id }),
            },
          )
          if (!ok) {
            throw new Error(result?.error ?? `Failed to clear model override (${status}).`)
          }
        },
        context: {},
      })
      setSelectedProviderId('')
      setSelectedModelId('')
      const successMessage = t(
        'ai_assistant.agents.model_override.cleared',
        'Model override cleared; the agent is using the normal resolution chain.',
      )
      setState({ kind: 'success', message: successMessage })
      flash(successMessage, 'success')
      await queryClient.invalidateQueries({
        queryKey: ['ai_assistant', 'agent_settings', 'runtime_settings'],
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setState({ kind: 'error', message })
      flash(message, 'error')
    } finally {
      setIsClearing(false)
    }
  }, [agent.id, isClearing, queryClient, runClearModelOverrideMutation, t])

  const toggleAllowedProvider = React.useCallback(
    (providerId: string, next: boolean) => {
      setAllowlistDirty(true)
      setState({ kind: 'idle' })
      setAllowedProviders((current) => {
        if (next) {
          return current === null ? [providerId] : Array.from(new Set([...current, providerId]))
        }
        const baseline = current === null
          ? configuredProviders.map((provider) => provider.id)
          : current
        return baseline.filter((id) => id !== providerId)
      })
    },
    [configuredProviders],
  )

  const toggleAllowedModel = React.useCallback(
    (providerId: string, modelId: string, next: boolean) => {
      setAllowlistDirty(true)
      setState({ kind: 'idle' })
      const provider = configuredProviders.find((entry) => entry.id === providerId)
      const allModelIds = provider?.defaultModels.map((model) => model.id) ?? []
      setAllowedModelsByProvider((current) => {
        const existing = current[providerId]
        const baseline = existing === undefined ? allModelIds : existing
        const nextModels = next
          ? Array.from(new Set([...baseline, modelId]))
          : baseline.filter((id) => id !== modelId)
        return { ...current, [providerId]: nextModels }
      })
    },
    [configuredProviders],
  )

  const resetAllowlistDraft = React.useCallback(() => {
    setAllowedProviders(null)
    setAllowedModelsByProvider({})
    setAllowlistDirty(true)
    setState({ kind: 'idle' })
  }, [])

  const saveAllowlist = React.useCallback(async () => {
    if (isSavingAllowlist) return
    setIsSavingAllowlist(true)
    setState({ kind: 'idle' })
    try {
      await runSaveModelAllowlistMutation({
        operation: async () => {
          const { ok, status, result } = await apiCall<{ error?: string }>(
            '/api/ai_assistant/settings',
            {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({
                agentId: agent.id,
                allowedOverrideProviders: allowedProviders,
                allowedOverrideModelsByProvider: allowedModelsByProvider,
              }),
            },
          )
          if (!ok) {
            throw new Error(result?.error ?? `Failed to save chat override allowlist (${status}).`)
          }
        },
        context: {},
      })
      setAllowlistDirty(false)
      const successMessage = t(
        'ai_assistant.agents.model_override.allowlistSaved',
        'Chat override choices saved.',
      )
      setState({ kind: 'success', message: successMessage })
      flash(successMessage, 'success')
      await queryClient.invalidateQueries({
        queryKey: ['ai_assistant', 'agent_settings', 'runtime_settings'],
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setState({ kind: 'error', message })
      flash(message, 'error')
    } finally {
      setIsSavingAllowlist(false)
    }
  }, [agent.id, allowedModelsByProvider, allowedProviders, isSavingAllowlist, queryClient, runSaveModelAllowlistMutation, t])

  const busy = isSaving || isClearing || isSavingAllowlist

  return (
    <section
      className="rounded-lg border border-border bg-background p-4"
      data-ai-agent-model-override={agent.id}
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
        <div className="flex min-w-0 items-start gap-2">
          <Bot className="size-4 text-muted-foreground" aria-hidden />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">
              {t('ai_assistant.agents.model_override.title', 'Provider and model')}
            </h3>
            <p className="text-xs text-muted-foreground">
              {t(
                'ai_assistant.agents.model_override.subtitle',
                'Override the default provider and model for this tenant and agent.',
              )}
            </p>
          </div>
        </div>
        {agentResolution ? (
          <StatusBadge
            variant="info"
            dot
            className="max-w-full whitespace-normal break-all"
            data-ai-agent-model-override-effective
          >
            {agentResolution.providerId} / {agentResolution.modelId}
          </StatusBadge>
        ) : null}
      </header>

      <div className="mt-3 flex flex-col gap-3">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-3">
          <div className="min-w-0">
            <span className="text-overline font-semibold uppercase tracking-wider text-muted-foreground">
              {t('ai_assistant.agents.model_override.codeDefault', 'Code-declared default')}
            </span>
            <p className="mt-1 break-all font-mono text-xs">
              {agent.defaultProvider ?? t('ai_assistant.agents.model_override.anyProvider', 'first configured')}
              {' / '}
              {agent.defaultModel ?? t('ai_assistant.agents.model_override.providerDefault', 'provider default')}
            </p>
          </div>
          <div className="min-w-0">
            <span className="text-overline font-semibold uppercase tracking-wider text-muted-foreground">
              {t('ai_assistant.agents.model_override.tenantOverride', 'Tenant override')}
            </span>
            <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
              {agentResolution?.override
                ? `${agentResolution.override.providerId ?? '—'} / ${agentResolution.override.modelId ?? '—'}`
                : t('ai_assistant.agents.model_override.noOverride', 'No per-agent override')}
            </p>
          </div>
        </div>

        {settingsQuery.isLoading ? (
          <SettingsLoading
            message={t(
              'ai_assistant.agents.model_override.loading',
              'Loading provider catalog...',
            )}
          />
        ) : settingsQuery.isError ? (
          <Alert variant="destructive" data-ai-agent-model-override-load-error>
            <AlertCircle className="size-4" aria-hidden />
            <AlertTitle>
              {t(
                'ai_assistant.agents.model_override.loadErrorTitle',
                'Failed to load provider catalog',
              )}
            </AlertTitle>
            <AlertDescription>
              {settingsQuery.error instanceof Error
                ? settingsQuery.error.message
                : String(settingsQuery.error)}
            </AlertDescription>
          </Alert>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <Label htmlFor={`ai-agent-model-provider-${agent.id}`} className="text-xs">
                {t('ai_assistant.agents.model_override.provider', 'Provider')}
              </Label>
              <Select
                value={selectedProviderId}
                onValueChange={(value) => {
                  setSelectedProviderId(value)
                  setSelectedModelId('')
                  setState({ kind: 'idle' })
                }}
                disabled={busy || configuredProviders.length === 0}
              >
                <SelectTrigger
                  id={`ai-agent-model-provider-${agent.id}`}
                  className="w-full min-w-0"
                  data-ai-agent-model-provider-select
                >
                  <SelectValue
                    placeholder={t(
                      'ai_assistant.agents.model_override.selectProvider',
                      'Select provider',
                    )}
                  />
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
            <div className="flex min-w-0 flex-col gap-1">
              <Label htmlFor={`ai-agent-model-model-${agent.id}`} className="text-xs">
                {t('ai_assistant.agents.model_override.model', 'Model')}
              </Label>
              <Select
                value={selectedModelId}
                onValueChange={(value) => {
                  setSelectedModelId(value)
                  setState({ kind: 'idle' })
                }}
                disabled={busy || !selectedProvider}
              >
                <SelectTrigger
                  id={`ai-agent-model-model-${agent.id}`}
                  className="w-full min-w-0"
                  data-ai-agent-model-select
                >
                  <SelectValue
                    placeholder={t(
                      'ai_assistant.agents.model_override.selectModel',
                      'Select model',
                    )}
                  />
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
          </div>
        )}

        {agent.allowRuntimeModelOverride ? (
          <div className="rounded-md border border-border bg-muted/20 p-3" data-ai-agent-model-picker-allowlist>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h4 className="text-sm font-semibold">
                  {t(
                    'ai_assistant.agents.model_override.allowlistTitle',
                    'Chat override choices',
                  )}
                </h4>
                <p className="text-xs text-muted-foreground">
                  {t(
                    'ai_assistant.agents.model_override.allowlistHelp',
                    'Limit which provider/model overrides users can pick in the chat footer for this agent.',
                  )}
                </p>
                {agentResolution?.runtimeOverrideAllowlist.env ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    <code className="font-mono text-xs">
                      {agentResolution.runtimeOverrideAllowlist.envVarNames.providers}
                    </code>
                    {' '}
                    {t(
                      'ai_assistant.agents.model_override.envAlsoNarrows',
                      'also narrows this list from env.',
                    )}
                  </p>
                ) : null}
              </div>
              <StatusBadge
                variant={agentResolution?.runtimeOverrideAllowlist.tenant ? 'info' : 'neutral'}
                dot
              >
                {agentResolution?.runtimeOverrideAllowlist.tenant
                  ? t('ai_assistant.agents.model_override.allowlistCustom', 'custom')
                  : t('ai_assistant.agents.model_override.allowlistInherited', 'inherited')}
              </StatusBadge>
            </div>

            <div className="mt-3 flex flex-col gap-3">
              {configuredProviders.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t(
                    'ai_assistant.agents.model_override.allowlistEmpty',
                    'No configured providers are available for chat overrides.',
                  )}
                </p>
              ) : (
                configuredProviders.map((provider) => {
                  const providerEnabled = isProviderAllowedForPicker(provider.id)
                  return (
                    <div key={provider.id} className="rounded-md border border-border bg-background p-3">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id={`ai-agent-picker-provider-${agent.id}-${provider.id}`}
                          checked={providerEnabled}
                          onCheckedChange={(value) =>
                            toggleAllowedProvider(provider.id, value === true)
                          }
                        />
                        <Label
                          htmlFor={`ai-agent-picker-provider-${agent.id}-${provider.id}`}
                          className="text-sm font-medium"
                        >
                          {provider.name}
                        </Label>
                      </div>
                      {providerEnabled ? (
                        <div className="mt-2 grid grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-2">
                          {provider.defaultModels.map((model) => (
                            <label
                              key={model.id}
                              className="flex min-w-0 items-center gap-2 text-xs"
                            >
                              <Checkbox
                                checked={isModelAllowedForPicker(provider.id, model.id)}
                                onCheckedChange={(value) =>
                                  toggleAllowedModel(provider.id, model.id, value === true)
                                }
                              />
                              <span className="truncate font-mono">{model.id}</span>
                              {model.id === provider.defaultModel ? (
                                <Badge variant="outline" className="text-overline">
                                  {t('ai_assistant.agents.model_override.defaultBadge', 'default')}
                                </Badge>
                              ) : null}
                            </label>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  )
                })
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={resetAllowlistDraft}
                disabled={busy}
              >
                {t('ai_assistant.agents.model_override.allowlistReset', 'Inherit')}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => void saveAllowlist()}
                disabled={busy || !allowlistDirty}
                data-ai-agent-model-allowlist-save
              >
                {isSavingAllowlist ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Save className="size-4" aria-hidden />
                )}
                <span>{t('ai_assistant.agents.model_override.allowlistSave', 'Save choices')}</span>
              </Button>
            </div>
          </div>
        ) : null}

        {state.kind === 'success' ? (
          <Alert variant="success" data-ai-agent-model-override-state="success">
            <CheckCircle2 className="size-4" aria-hidden />
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        ) : null}
        {state.kind === 'error' ? (
          <Alert variant="destructive" data-ai-agent-model-override-state="error">
            <AlertCircle className="size-4" aria-hidden />
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void clear()}
            disabled={busy || !agentResolution?.override}
            data-ai-agent-model-clear
          >
            {isClearing ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Trash2 className="size-4" aria-hidden />
            )}
            <span>{t('ai_assistant.agents.model_override.clear', 'Clear override')}</span>
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void save()}
            disabled={busy || !hasChange}
            data-ai-agent-model-save
          >
            {isSaving ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Save className="size-4" aria-hidden />
            )}
            <span>{t('ai_assistant.agents.model_override.save', 'Save override')}</span>
          </Button>
        </div>
      </div>
    </section>
  )
}

type LoopOverrideRow = {
  id: string
  agentId: string | null
  loopDisabled: boolean | null
  loopMaxSteps: number | null
  loopMaxToolCalls: number | null
  loopMaxWallClockMs: number | null
  loopMaxTokens: number | null
  loopStopWhenJson: unknown[] | null
  loopActiveToolsJson: string[] | null
  updatedAt: string
}

type LoopOverrideResponse = {
  agentId: string
  override: LoopOverrideRow | null
}

async function fetchLoopOverride(agentId: string): Promise<LoopOverrideResponse> {
  const { result, status } = await apiCallOrThrow<LoopOverrideResponse>(
    `/api/ai_assistant/ai/agents/${encodeURIComponent(agentId)}/loop-override`,
    { method: 'GET', credentials: 'include' },
    { errorMessage: 'Failed to load loop override' },
  )
  if (!result) throw new Error(`Failed to load loop override (${status})`)
  return result
}

function LoopPolicySection({ agent }: { agent: AgentSettings }) {
  const t = useT()
  const queryClient = useQueryClient()

  const query = useQuery<LoopOverrideResponse>({
    queryKey: ['ai_assistant', 'agent_settings', 'loop_override', agent.id],
    queryFn: () => fetchLoopOverride(agent.id),
    retry: false,
  })

  const currentOverride = query.data?.override ?? null

  const [loopDisabled, setLoopDisabled] = React.useState<boolean>(false)
  const [maxSteps, setMaxSteps] = React.useState<string>('')
  const [maxToolCalls, setMaxToolCalls] = React.useState<string>('')
  const [maxWallClockMs, setMaxWallClockMs] = React.useState<string>('')
  const [maxTokens, setMaxTokens] = React.useState<string>('')
  const [isSaving, setIsSaving] = React.useState(false)
  const [isClearing, setIsClearing] = React.useState(false)
  const [state, setState] = React.useState<
    | { kind: 'idle' }
    | { kind: 'success'; message: string }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' })

  React.useEffect(() => {
    setLoopDisabled(currentOverride?.loopDisabled ?? false)
    setMaxSteps(currentOverride?.loopMaxSteps != null ? String(currentOverride.loopMaxSteps) : '')
    setMaxToolCalls(
      currentOverride?.loopMaxToolCalls != null ? String(currentOverride.loopMaxToolCalls) : '',
    )
    setMaxWallClockMs(
      currentOverride?.loopMaxWallClockMs != null
        ? String(currentOverride.loopMaxWallClockMs)
        : '',
    )
    setMaxTokens(
      currentOverride?.loopMaxTokens != null ? String(currentOverride.loopMaxTokens) : '',
    )
    setState({ kind: 'idle' })
  }, [
    agent.id,
    currentOverride?.loopDisabled,
    currentOverride?.loopMaxSteps,
    currentOverride?.loopMaxToolCalls,
    currentOverride?.loopMaxWallClockMs,
    currentOverride?.loopMaxTokens,
  ])

  const toNullableInt = (value: string): number | null => {
    const trimmed = value.trim()
    if (trimmed === '') return null
    const parsed = parseInt(trimmed, 10)
    return isNaN(parsed) ? null : parsed
  }

  const save = React.useCallback(async () => {
    if (isSaving) return
    setIsSaving(true)
    setState({ kind: 'idle' })
    try {
      const { ok, status, result } = await apiCall<{
        ok?: boolean
        error?: string
        code?: string
      }>(
        `/api/ai_assistant/ai/agents/${encodeURIComponent(agent.id)}/loop-override`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            loopDisabled: loopDisabled || null,
            loopMaxSteps: toNullableInt(maxSteps),
            loopMaxToolCalls: toNullableInt(maxToolCalls),
            loopMaxWallClockMs: toNullableInt(maxWallClockMs),
            loopMaxTokens: toNullableInt(maxTokens),
          }),
        },
      )
      const payload = result ?? {}
      if (!ok) {
        setState({
          kind: 'error',
          message: payload.error ?? `Failed to save loop policy (${status}).`,
        })
        return
      }
      setState({
        kind: 'success',
        message: t('ai_assistant.agents.loop_policy.savedMessage', 'Loop policy override saved.'),
      })
      await queryClient.invalidateQueries({
        queryKey: ['ai_assistant', 'agent_settings', 'loop_override', agent.id],
      })
    } catch (err) {
      setState({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setIsSaving(false)
    }
  }, [agent.id, isSaving, loopDisabled, maxSteps, maxToolCalls, maxWallClockMs, maxTokens, queryClient, t])

  const clear = React.useCallback(async () => {
    if (isClearing) return
    setIsClearing(true)
    setState({ kind: 'idle' })
    try {
      const { ok, status, result } = await apiCall<{ ok?: boolean; error?: string }>(
        `/api/ai_assistant/ai/agents/${encodeURIComponent(agent.id)}/loop-override`,
        { method: 'DELETE', credentials: 'include' },
      )
      const payload = result ?? {}
      if (!ok) {
        setState({
          kind: 'error',
          message: payload.error ?? `Failed to clear loop override (${status}).`,
        })
        return
      }
      setState({
        kind: 'success',
        message: t(
          'ai_assistant.agents.loop_policy.clearedMessage',
          'Loop policy override cleared; agent is using its declared defaults.',
        ),
      })
      await queryClient.invalidateQueries({
        queryKey: ['ai_assistant', 'agent_settings', 'loop_override', agent.id],
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
      data-ai-agent-loop-policy={agent.id}
    >
      <header className="flex items-center justify-between gap-3 border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <ShieldOff className="size-4 text-muted-foreground" aria-hidden />
          <div>
            <h3 className="text-sm font-semibold">
              {t('ai_assistant.agents.loop_policy.title', 'Loop policy')}
            </h3>
            <p className="text-xs text-muted-foreground">
              {t(
                'ai_assistant.agents.loop_policy.subtitle',
                'Set per-tenant budget limits or disable the agentic loop for this agent.',
              )}
            </p>
          </div>
        </div>
        {currentOverride?.loopDisabled ? (
          <Badge variant="destructive" data-ai-agent-loop-disabled-badge>
            {t('ai_assistant.agents.loop_policy.disabledBadge', 'Loop disabled')}
          </Badge>
        ) : null}
      </header>

      <div className="mt-3 flex flex-col gap-4">
        {query.isLoading ? (
          <SettingsLoading
            message={t('ai_assistant.agents.loop_policy.loading', 'Loading loop policy...')}
          />
        ) : query.isError ? (
          <Alert variant="destructive" data-ai-agent-loop-policy-load-error>
            <AlertCircle className="size-4" aria-hidden />
            <AlertTitle>
              {t('ai_assistant.agents.loop_policy.loadErrorTitle', 'Failed to load loop policy')}
            </AlertTitle>
            <AlertDescription>
              {query.error instanceof Error ? query.error.message : String(query.error)}
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
              <div>
                <span className="text-sm font-medium">
                  {t('ai_assistant.agents.loop_policy.killSwitchLabel', 'Kill switch')}
                </span>
                <p className="text-xs text-muted-foreground">
                  {t(
                    'ai_assistant.agents.loop_policy.killSwitchDescription',
                    'When enabled, the agent runs as a single model call with no tool loop.',
                  )}
                </p>
              </div>
              <Switch
                checked={loopDisabled}
                onCheckedChange={(next: boolean) => setLoopDisabled(next)}
                aria-label={t('ai_assistant.agents.loop_policy.killSwitchLabel', 'Kill switch')}
                data-ai-agent-loop-kill-switch
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor={`loop-max-steps-${agent.id}`} className="text-xs">
                  {t('ai_assistant.agents.loop_policy.maxStepsLabel', 'Max steps')}
                </Label>
                <Input
                  id={`loop-max-steps-${agent.id}`}
                  type="number"
                  min={1}
                  max={1000}
                  value={maxSteps}
                  onChange={(event) => setMaxSteps(event.target.value)}
                  placeholder={t('ai_assistant.agents.loop_policy.noOverridePlaceholder', 'No override')}
                  className="h-8 text-sm"
                  data-ai-agent-loop-max-steps
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor={`loop-max-tool-calls-${agent.id}`} className="text-xs">
                  {t('ai_assistant.agents.loop_policy.maxToolCallsLabel', 'Max tool calls')}
                </Label>
                <Input
                  id={`loop-max-tool-calls-${agent.id}`}
                  type="number"
                  min={1}
                  max={10000}
                  value={maxToolCalls}
                  onChange={(event) => setMaxToolCalls(event.target.value)}
                  placeholder={t('ai_assistant.agents.loop_policy.noOverridePlaceholder', 'No override')}
                  className="h-8 text-sm"
                  data-ai-agent-loop-max-tool-calls
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor={`loop-max-wall-clock-${agent.id}`} className="text-xs">
                  {t('ai_assistant.agents.loop_policy.maxWallClockMsLabel', 'Max wall-clock (ms)')}
                </Label>
                <Input
                  id={`loop-max-wall-clock-${agent.id}`}
                  type="number"
                  min={100}
                  max={3600000}
                  value={maxWallClockMs}
                  onChange={(event) => setMaxWallClockMs(event.target.value)}
                  placeholder={t('ai_assistant.agents.loop_policy.noOverridePlaceholder', 'No override')}
                  className="h-8 text-sm"
                  data-ai-agent-loop-max-wall-clock-ms
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor={`loop-max-tokens-${agent.id}`} className="text-xs">
                  {t('ai_assistant.agents.loop_policy.maxTokensLabel', 'Max tokens')}
                </Label>
                <Input
                  id={`loop-max-tokens-${agent.id}`}
                  type="number"
                  min={1}
                  max={10000000}
                  value={maxTokens}
                  onChange={(event) => setMaxTokens(event.target.value)}
                  placeholder={t('ai_assistant.agents.loop_policy.noOverridePlaceholder', 'No override')}
                  className="h-8 text-sm"
                  data-ai-agent-loop-max-tokens
                />
              </div>
            </div>

            {state.kind === 'success' ? (
              <Alert variant="success" data-ai-agent-loop-policy-state="success">
                <CheckCircle2 className="size-4" aria-hidden />
                <AlertTitle>
                  {t('ai_assistant.agents.loop_policy.savedTitle', 'Loop policy updated')}
                </AlertTitle>
                <AlertDescription>{state.message}</AlertDescription>
              </Alert>
            ) : null}
            {state.kind === 'error' ? (
              <Alert variant="destructive" data-ai-agent-loop-policy-state="error">
                <AlertCircle className="size-4" aria-hidden />
                <AlertTitle>
                  {t(
                    'ai_assistant.agents.loop_policy.errorTitle',
                    'Failed to update loop policy',
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
                data-ai-agent-loop-policy-clear
              >
                {isClearing ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Trash2 className="size-4" aria-hidden />
                )}
                <span>{t('ai_assistant.agents.loop_policy.clear', 'Clear override')}</span>
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => void save()}
                disabled={isSaving || isClearing}
                data-ai-agent-loop-policy-save
              >
                {isSaving ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Save className="size-4" aria-hidden />
                )}
                <span>{t('ai_assistant.agents.loop_policy.save', 'Save override')}</span>
              </Button>
            </div>
          </>
        )}
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
  const { runMutation: runSavePromptOverrideMutation } = useGuardedMutation({
    contextId: `ai-agent-prompt-override-save-${agent.id}`,
  })

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
      const payload = await runSavePromptOverrideMutation({
        operation: async () => {
          const { ok, status, result } = await apiCall<{
            ok?: boolean
            pending?: boolean
            version?: number
            updatedAt?: string
            message?: string
            error?: string
            code?: string
            reservedKeys?: string[]
          }>(
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
          const body = result ?? {}
          if (!ok) {
            const message =
              body.code === 'reserved_key'
                ? t(
                    'ai_assistant.agents.override.errors.reservedKey',
                    'Prompt overrides cannot modify policy fields (mutationPolicy, readOnly, allowedTools, acceptedMediaTypes). Remove those sections and retry.',
                  )
                : (body.error ?? `Failed to save overrides (${status}).`)
            throw new Error(message)
          }
          return body
        },
        context: {},
      })
      if (payload.ok === true && typeof payload.version === 'number') {
        const successMessage = t(
          'ai_assistant.agents.override.savedMessage',
          'Prompt override saved.',
        )
        setSaveState({
          kind: 'success',
          version: payload.version,
          message: successMessage,
        })
        flash(successMessage, 'success')
        await queryClient.invalidateQueries({
          queryKey: ['ai_assistant', 'agent_settings', 'override', agent.id],
        })
        return
      }
      // Legacy placeholder response: surfaces the Step-4.5 wording for BC.
      const legacyMessage =
        payload.message ??
        t(
          'ai_assistant.agents.prompt.pendingMessage',
          'Prompt overrides accepted.',
        )
      setSaveState({
        kind: 'success',
        version: 0,
        message: legacyMessage,
      })
      flash(legacyMessage, 'success')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setSaveState({ kind: 'error', message })
      flash(message, 'error')
    } finally {
      setIsSaving(false)
    }
  }, [activeOverrides, agent.id, isSaving, queryClient, runSavePromptOverrideMutation, t])

  return (
    <div className="flex flex-col gap-4" data-ai-agent-detail={agent.id}>
      <section className="rounded-lg border border-border bg-background p-4">
        <h2 className="text-xl font-semibold">{agent.label}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{agent.description}</p>
        <dl className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(min(100%,9rem),1fr))] gap-3 text-sm">
          <div className="min-w-0">
            <dt className="text-overline font-semibold uppercase tracking-wider text-muted-foreground">
              {t('ai_assistant.agents.meta.module', 'Module')}
            </dt>
            <dd className="mt-1 break-all font-mono text-xs">{agent.moduleId}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-overline font-semibold uppercase tracking-wider text-muted-foreground">
              {t('ai_assistant.agents.meta.id', 'Agent id')}
            </dt>
            <dd className="mt-1 break-all font-mono text-xs">{agent.id}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-overline font-semibold uppercase tracking-wider text-muted-foreground">
              {t('ai_assistant.agents.meta.executionMode', 'Execution mode')}
            </dt>
            <dd className="mt-1">
              <StatusBadge variant={executionModeStatusMap[agent.executionMode]}>
                {agent.executionMode}
              </StatusBadge>
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-overline font-semibold uppercase tracking-wider text-muted-foreground">
              {t('ai_assistant.agents.meta.mutationPolicy', 'Mutation policy')}
            </dt>
            <dd className="mt-1">
              <StatusBadge
                variant={mutationPolicyStatusMap[agent.mutationPolicy] ?? 'neutral'}
                dot
                className="max-w-full whitespace-normal break-all"
              >
                {agent.mutationPolicy}
              </StatusBadge>
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-overline font-semibold uppercase tracking-wider text-muted-foreground">
              {t('ai_assistant.agents.meta.readOnly', 'Read-only')}
            </dt>
            <dd className="mt-1 text-xs">
              {agent.readOnly
                ? t('ai_assistant.agents.meta.readOnlyYes', 'Yes')
                : t('ai_assistant.agents.meta.readOnlyNo', 'No')}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-overline font-semibold uppercase tracking-wider text-muted-foreground">
              {t('ai_assistant.agents.meta.maxSteps', 'Max steps')}
            </dt>
            <dd className="mt-1 font-mono text-xs">
              {agent.maxSteps ?? t('ai_assistant.agents.meta.unlimited', 'Unlimited')}
            </dd>
          </div>
        </dl>
      </section>

      <AgentModelOverrideSection agent={agent} />

      <MutationPolicySection agent={agent} />

      <LoopPolicySection agent={agent} />

      <section
        className="rounded-lg border border-border bg-background p-4"
        data-ai-agent-prompt-editor={agent.id}
      >
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
          <div className="min-w-0">
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
              onToggleOverride={(next) => {
                setOverrideFlags((prev) => ({ ...prev, [sectionId]: next }))
                if (next) {
                  setOverrideDrafts((prev) => {
                    if (prev[sectionId]) return prev
                    const defaultText =
                      sectionId === 'role'
                        ? agent.systemPrompt
                        : ''
                    return { ...prev, [sectionId]: defaultText }
                  })
                }
              }}
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
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
          <div className="min-w-0">
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
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
          <div className="flex min-w-0 items-start gap-2">
            <History className="size-4 text-muted-foreground" aria-hidden />
            <div className="min-w-0">
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
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2"
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
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
          <div className="min-w-0">
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
      <div className="flex min-w-0 flex-col gap-4" data-ai-agent-settings>
        <header className="flex min-w-0 flex-col gap-1">
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
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex min-w-[min(100%,16rem)] flex-1 flex-col gap-2">
              <Label htmlFor="ai-agent-settings-picker">
                {t('ai_assistant.agents.agentPickerLabel', 'Agent')}
              </Label>
              <Select
                value={selectedAgentId ?? ''}
                onValueChange={(value) => setSelectedAgentId(value)}
              >
                <SelectTrigger
                  id="ai-agent-settings-picker"
                  data-ai-agent-settings-picker
                  className="w-full min-w-0"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {agents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.label} ({agent.id})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
