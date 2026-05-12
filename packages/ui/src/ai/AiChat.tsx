"use client"

import * as React from 'react'
import {
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Lightbulb,
  Loader2,
  Paperclip,
  Plus,
  Send,
  Square,
  User,
  Wrench,
  X,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { Alert, AlertDescription, AlertTitle } from '../primitives/alert'
import { Button } from '../primitives/button'
import { IconButton } from '../primitives/icon-button'
import { Label } from '../primitives/label'
import { Textarea } from '../primitives/textarea'
import { apiCall } from '../backend/utils/apiCall'
import { parseAiContentSegments } from './AiMessageContent'
import {
  ModelPicker,
  type ModelPickerProvider,
  type ModelPickerValue,
} from './ModelPicker'
import { RecordCard } from './records/RecordCard'
import {
  defaultAiUiPartRegistry,
  isReservedAiUiPartId,
  type AiUiPartComponentId,
  type AiUiPartRegistry,
} from './ui-part-registry'
import {
  useAiChat,
  type AiChatMessage,
  type AiChatMessageFile,
  type AiChatMessageUiPart,
  type AiChatToolCallSnapshot,
} from './useAiChat'
import { useAiChatUpload } from './useAiChatUpload'
import { useAiShortcuts } from './useAiShortcuts'

// Cap inline previews so we do not blow past localStorage quota (~5MB on most
// browsers). Images larger than this still upload + send to the LLM as inline
// base64 server-side; only the in-chat preview is dropped on reload.
const PREVIEW_DATA_URL_MAX_BYTES = 2 * 1024 * 1024
const COMPACT_FOOTER_MAX_WIDTH = 640

const MODEL_PICKER_STORAGE_PREFIX = 'om-ai-model-picker:'

function readModelPickerValue(agentId: string): ModelPickerValue | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(`${MODEL_PICKER_STORAGE_PREFIX}${agentId}`)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as Record<string, unknown>).providerId === 'string' &&
      typeof (parsed as Record<string, unknown>).modelId === 'string'
    ) {
      const value = parsed as ModelPickerValue
      return { providerId: value.providerId, modelId: value.modelId }
    }
    return null
  } catch {
    return null
  }
}

function writeModelPickerValue(agentId: string, value: ModelPickerValue | null): void {
  if (typeof window === 'undefined') return
  try {
    const key = `${MODEL_PICKER_STORAGE_PREFIX}${agentId}`
    if (value === null) {
      window.localStorage.removeItem(key)
    } else {
      window.localStorage.setItem(key, JSON.stringify({ providerId: value.providerId, modelId: value.modelId }))
    }
  } catch {
    // Quota exceeded / privacy mode — silently ignore.
  }
}

interface ModelsApiResponse {
  agentId: string
  allowRuntimeModelOverride: boolean
  defaultProviderId: string | null
  defaultModelId: string | null
  defaultProviderName?: string | null
  defaultModelName?: string | null
  providers: ModelPickerProvider[]
}

function useAgentModels(agent: string): {
  providers: ModelPickerProvider[]
  allowRuntimeModelOverride: boolean
  defaultLabel: string | null
  loaded: boolean
} {
  const [providers, setProviders] = React.useState<ModelPickerProvider[]>([])
  const [allowRuntimeModelOverride, setAllowRuntimeModelOverride] = React.useState(false)
  const [defaultLabel, setDefaultLabel] = React.useState<string | null>(null)
  const [loaded, setLoaded] = React.useState(false)

  React.useEffect(() => {
    const modelsUrl = `/api/ai_assistant/ai/agents/${encodeURIComponent(agent)}/models`
    setLoaded(false)
    setDefaultLabel(null)
    void apiCall<ModelsApiResponse>(modelsUrl).then((result) => {
      if (!result.ok || !result.result) {
        setLoaded(true)
        return
      }
      setAllowRuntimeModelOverride(result.result.allowRuntimeModelOverride)
      setProviders(result.result.providers)
      setDefaultLabel(
        result.result.defaultProviderName && result.result.defaultModelName
          ? `${result.result.defaultProviderName} / ${result.result.defaultModelName}`
          : result.result.defaultProviderId && result.result.defaultModelId
            ? `${result.result.defaultProviderId} / ${result.result.defaultModelId}`
            : null,
      )
      setLoaded(true)
    })
  }, [agent])

  return { providers, allowRuntimeModelOverride, defaultLabel, loaded }
}

function firstAvailableModelPickerValue(
  providers: ModelPickerProvider[],
): ModelPickerValue | null {
  for (const provider of providers) {
    const model = provider.models[0]
    if (model) {
      return { providerId: provider.id, modelId: model.id }
    }
  }
  return null
}

function isModelPickerValueAvailable(
  value: ModelPickerValue,
  providers: ModelPickerProvider[],
): boolean {
  return providers.some(
    (provider) =>
      provider.id === value.providerId &&
      provider.models.some((model) => model.id === value.modelId),
  )
}

async function readFileAsDataUrl(file: File): Promise<string | undefined> {
  if (!file.type.startsWith('image/')) return undefined
  if (file.size > PREVIEW_DATA_URL_MAX_BYTES) return undefined
  return new Promise<string | undefined>((resolve) => {
    const reader = new FileReader()
    reader.onload = () =>
      resolve(typeof reader.result === 'string' ? reader.result : undefined)
    reader.onerror = () => resolve(undefined)
    try {
      reader.readAsDataURL(file)
    } catch {
      resolve(undefined)
    }
  })
}

/**
 * Optional resolved-tool snapshot the host can feed into the debug panel.
 * Step 4.6 wires this from the `GET /api/ai_assistant/ai/agents` response
 * (`tools[]`). Step 5.3+ will replace the manual wiring with a streamed
 * `debug` part once the dispatcher emits one.
 */
export interface AiChatDebugTool {
  name: string
  displayName?: string
  isMutation?: boolean
  requiredFeatures?: string[]
}

/**
 * Resolved prompt-section snapshot for the debug panel. Until Phase 3 Step
 * 5.3 lands structured `PromptTemplate.sections`, hosts synthesise this
 * from the agent's `systemPrompt` + additive overrides.
 */
export interface AiChatDebugPromptSection {
  id: string
  source?: 'default' | 'override' | 'placeholder'
  text?: string
}

/** Quick-action suggestion shown in the welcome state. */
export interface AiChatSuggestion {
  label: string
  prompt: string
  icon?: React.ReactNode
}

/** Context item displayed as a chip/pill in the chat header. */
export interface AiChatContextItem {
  label: string
  detail?: string
}

export interface AiChatProps {
  agent: string
  apiPath?: string
  pageContext?: Record<string, unknown>
  attachmentIds?: string[]
  initialMessages?: Array<{ role: 'user' | 'assistant'; content: string }>
  debug?: boolean
  className?: string
  placeholder?: string
  onMutationRequested?: (pendingActionId: string) => void
  onError?: (err: { code?: string; message: string }) => void
  /**
   * Optional stable conversation id. Forwarded verbatim to
   * `POST /api/ai_assistant/ai/chat` request bodies and reused across
   * turns so the Step 5.6 `prepareMutation` idempotency hash stays
   * stable across retries within the same chat. When omitted, the hook
   * mints a fresh random id once on mount — remounting the component
   * resets the conversation.
   */
  conversationId?: string
  /**
   * Optional UI-part registry. Defaults to the module-global
   * {@link defaultAiUiPartRegistry}. Pass a scoped registry from
   * {@link createAiUiPartRegistry} when embedding multiple `<AiChat>`
   * instances that should not share registrations (playground, tests).
   */
  registry?: AiUiPartRegistry
  /**
   * Optional list of server-emitted UI parts to render inside the chat
   * transcript. The registry resolves each part via `componentId`. Phase 3
   * will populate this from the streamed dispatcher response; Phase 2 WS-A
   * leaves the wiring exposed so hosts can preview the registry path.
   */
  uiParts?: Array<{
    componentId: AiUiPartComponentId
    payload?: unknown
    pendingActionId?: string
  }>
  /**
   * Optional resolved-tool map for the debug panel. Ignored when
   * `debug` is falsy.
   */
  debugTools?: AiChatDebugTool[]
  /**
   * Optional resolved prompt sections for the debug panel. Ignored when
   * `debug` is falsy.
   */
  debugPromptSections?: AiChatDebugPromptSection[]
  /** Suggested prompts shown in the empty / welcome state. */
  suggestions?: AiChatSuggestion[]
  /** Context items shown as pills above the transcript (e.g. selected products). */
  contextItems?: AiChatContextItem[]
  /** Welcome heading shown when there are no messages yet. */
  welcomeTitle?: string
  /** Welcome description shown below the heading. */
  welcomeDescription?: string
  /** Initial compact composer state used before the footer has been measured. */
  defaultCompactFooter?: boolean
}

interface ServerEmittedUiPartRef {
  componentId: AiUiPartComponentId
  payload?: unknown
  pendingActionId?: string
}

function mapErrorCodeToVariant(
  code: string | undefined,
): 'destructive' | 'warning' {
  if (!code) return 'destructive'
  // Policy denies that describe a filtered tool or attachment surface a
  // warning alert; caller can still continue. Hard denials (agent_unknown,
  // agent_features_denied, unauthenticated, execution_mode_not_supported,
  // mutation_blocked_by_*, validation_error) surface destructive alerts.
  const warningCodes = new Set<string>([
    'tool_not_whitelisted',
    'tool_features_denied',
    'attachment_type_not_accepted',
  ])
  return warningCodes.has(code) ? 'warning' : 'destructive'
}

const MARKDOWN_TYPOGRAPHY_CLASS = cn(
  '[&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0',
  '[&_ul]:my-2 [&_ol]:my-2 [&_ul]:ml-4 [&_ol]:ml-4 [&_ul]:list-disc [&_ol]:list-decimal',
  '[&_li]:my-0.5',
  '[&_h1]:mt-3 [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-semibold',
  '[&_h2]:mt-3 [&_h2]:mb-2 [&_h2]:text-sm [&_h2]:font-semibold',
  '[&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold',
  '[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2',
  '[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs',
  '[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-border [&_pre]:bg-muted [&_pre]:p-3',
  '[&_pre_code]:bg-transparent [&_pre_code]:p-0',
  '[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground',
  '[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_table]:text-xs',
  '[&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-medium',
  '[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1',
)

const MARKDOWN_COMPONENTS = {
  a: ({ node, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { node?: unknown }) => (
    <a {...props} target="_blank" rel="noreferrer" />
  ),
}

function MarkdownChunk({ text }: { text: string }) {
  if (!text.trim()) return null
  return (
    <div className={cn('text-sm', MARKDOWN_TYPOGRAPHY_CLASS)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  )
}

function MessageContent({ content, isAssistant }: { content: string; isAssistant: boolean }) {
  if (!isAssistant) {
    return <div className="whitespace-pre-wrap text-sm">{content}</div>
  }
  if (!content) {
    return null
  }
  const segments = parseAiContentSegments(content)
  if (segments.length === 0) {
    return null
  }
  return (
    <div className="space-y-1" data-ai-message-content="">
      {segments.map((segment, index) => {
        if (segment.kind === 'record-card') {
          return <RecordCard key={`card-${index}`} data={segment.payload} />
        }
        if (segment.kind === 'invalid-card') {
          return (
            <pre
              key={`raw-${index}`}
              className="my-2 max-h-60 overflow-auto rounded-md border border-dashed border-border bg-muted p-2 text-xs"
              data-ai-record-card-invalid={segment.info}
            >
              {segment.raw}
            </pre>
          )
        }
        return <MarkdownChunk key={`md-${index}`} text={segment.text} />
      })}
    </div>
  )
}

function safeStringify(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function ToolCallList({ toolCalls }: { toolCalls: AiChatToolCallSnapshot[] }) {
  const t = useT()
  const [openId, setOpenId] = React.useState<string | null>(null)
  if (!toolCalls || toolCalls.length === 0) return null
  return (
    <div className="space-y-1" data-ai-chat-tool-calls="">
      {toolCalls.map((call) => {
        const isOpen = openId === call.id
        const isError = call.state === 'error'
        const isPending = call.state === 'pending'
        const isComplete = call.state === 'complete'
        const statusLabel = isError
          ? t('ai_assistant.chat.toolError', 'failed')
          : isPending
            ? t('ai_assistant.chat.toolRunning', 'running…')
            : t('ai_assistant.chat.toolDone', 'done')
        return (
          <div
            key={call.id}
            className={cn(
              'rounded-md border border-border bg-muted/30',
              isError ? 'border-destructive/40 bg-destructive/5' : '',
            )}
            data-ai-chat-tool-call={call.toolName}
            data-ai-chat-tool-state={call.state}
          >
            <button
              type="button"
              onClick={() => setOpenId(isOpen ? null : call.id)}
              className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs font-medium hover:bg-muted/60"
            >
              {isOpen ? (
                <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
              ) : (
                <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden />
              )}
              {isPending ? (
                <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden />
              ) : (
                <Wrench
                  className={cn(
                    'size-3.5',
                    isError ? 'text-destructive' : 'text-muted-foreground',
                  )}
                  aria-hidden
                />
              )}
              <span className="font-mono">{call.toolName}</span>
              <span
                className={cn(
                  'ml-auto text-[10px] uppercase tracking-wide',
                  isError
                    ? 'text-destructive'
                    : isComplete
                      ? 'text-status-success-text'
                      : 'text-muted-foreground',
                )}
              >
                {statusLabel}
              </span>
            </button>
            {isOpen ? (
              <div className="space-y-1 border-t border-border/60 px-2 py-1.5 text-xs">
                {call.input !== undefined ? (
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {t('ai_assistant.chat.toolInput', 'Input')}
                    </div>
                    <pre className="mt-0.5 max-h-32 overflow-auto rounded bg-background p-1.5 font-mono text-[11px]">
                      {safeStringify(call.input)}
                    </pre>
                  </div>
                ) : null}
                {call.output !== undefined && !isError ? (
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {t('ai_assistant.chat.toolOutput', 'Output')}
                    </div>
                    <pre className="mt-0.5 max-h-32 overflow-auto rounded bg-background p-1.5 font-mono text-[11px]">
                      {safeStringify(call.output)}
                    </pre>
                  </div>
                ) : null}
                {call.errorMessage ? (
                  <div className="text-destructive">{call.errorMessage}</div>
                ) : null}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function ReasoningPanel({ text, streaming }: { text: string; streaming: boolean }) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  if (!text) return null
  return (
    <div
      className="rounded-md border border-border bg-muted/30"
      data-ai-chat-reasoning={streaming ? 'streaming' : 'complete'}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs font-medium hover:bg-muted/60"
      >
        {open ? (
          <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden />
        )}
        <Lightbulb className="size-3.5 text-muted-foreground" aria-hidden />
        <span>{t('ai_assistant.chat.reasoning', 'Reasoning')}</span>
        {streaming ? (
          <Loader2
            className="ml-1 size-3 animate-spin text-muted-foreground"
            aria-hidden
          />
        ) : null}
      </button>
      {open ? (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap border-t border-border/60 px-2 py-1.5 text-xs text-muted-foreground">
          {text}
        </pre>
      ) : null}
    </div>
  )
}

function MessageRow({
  message,
  registry,
  onMutationRequested,
}: {
  message: AiChatMessage
  registry?: AiUiPartRegistry
  onMutationRequested?: (pendingActionId: string) => void
}) {
  const t = useT()
  const isAssistant = message.role === 'assistant'
  const label = isAssistant
    ? t('ai_assistant.chat.assistantRoleLabel', 'Assistant')
    : t('ai_assistant.chat.userRoleLabel', 'You')
  const Icon = isAssistant ? Bot : User
  const [copied, setCopied] = React.useState(false)
  const copyTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    }
  }, [])

  const handleCopy = React.useCallback(async () => {
    const text = message.content
    if (!text) return
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        const textarea = document.createElement('textarea')
        textarea.value = text
        textarea.setAttribute('readonly', '')
        textarea.style.position = 'absolute'
        textarea.style.left = '-9999px'
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
      }
      setCopied(true)
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      copyTimerRef.current = setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard API blocked (no permission, http context) — silently fail.
    }
  }, [message.content])

  return (
    <div
      className={cn(
        'group/message flex gap-3 px-3 py-2',
        isAssistant ? 'bg-muted/40 rounded-md' : '',
      )}
      data-role={message.role}
    >
      <div
        className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded-full',
          isAssistant
            ? 'bg-primary/10 text-primary'
            : 'bg-secondary text-secondary-foreground',
        )}
        aria-hidden
      >
        <Icon className="size-4" />
      </div>
      <div className="flex-1 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-medium text-muted-foreground">{label}</div>
          {message.content ? (
            <IconButton
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleCopy}
              aria-label={
                copied
                  ? t('ai_assistant.chat.copied', 'Copied')
                  : t('ai_assistant.chat.copyMessage', 'Copy message')
              }
              data-ai-chat-copy-button=""
              className="opacity-0 transition-opacity group-hover/message:opacity-100 focus-visible:opacity-100"
            >
              {copied ? (
                <Check className="size-3.5 text-status-success-icon" aria-hidden />
              ) : (
                <Copy className="size-3.5" aria-hidden />
              )}
            </IconButton>
          ) : null}
        </div>
        {message.files && message.files.length > 0 ? (
          <div className="flex flex-wrap gap-2 py-1">
            {message.files.map((file, i) =>
              file.previewUrl ? (
                <img
                  key={i}
                  src={file.previewUrl}
                  alt={file.name}
                  className="max-h-32 max-w-[200px] rounded-md border border-border object-cover"
                />
              ) : (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs"
                >
                  <Paperclip className="size-3" aria-hidden />
                  {file.name}
                </span>
              ),
            )}
          </div>
        ) : null}
        {isAssistant && message.reasoning ? (
          <ReasoningPanel
            text={message.reasoning}
            streaming={message.reasoningStreaming === true}
          />
        ) : null}
        {isAssistant && message.toolCalls && message.toolCalls.length > 0 ? (
          <ToolCallList toolCalls={message.toolCalls} />
        ) : null}
        <MessageContent content={message.content} isAssistant={isAssistant} />
        {isAssistant && registry && message.uiParts && message.uiParts.length > 0 ? (
          <MessageUiParts
            parts={message.uiParts}
            registry={registry}
            onMutationRequested={onMutationRequested}
          />
        ) : null}
      </div>
    </div>
  )
}

function MessageUiParts({
  parts,
  registry,
  onMutationRequested,
}: {
  parts: AiChatMessageUiPart[]
  registry: AiUiPartRegistry
  onMutationRequested?: (pendingActionId: string) => void
}) {
  return (
    <div className="mt-2 flex flex-col gap-2" data-ai-message-ui-parts="">
      {parts.map((part) => (
        <AiUiPartRenderer
          key={part.key}
          part={{
            componentId: part.componentId as AiUiPartComponentId,
            payload: part.payload,
            pendingActionId: part.pendingActionId,
          }}
          registry={registry}
          onMutationRequested={onMutationRequested}
        />
      ))}
    </div>
  )
}

function UnknownUiPartPlaceholder({ componentId }: { componentId: AiUiPartComponentId }) {
  const t = useT()
  return (
    <div
      className="inline-flex items-center gap-2 rounded-full border border-dashed border-border bg-muted px-3 py-1 text-xs text-muted-foreground"
      data-ai-ui-part-placeholder={componentId}
    >
      <span>
        {t('ai_assistant.chat.uiPartPending', 'Pending UI part:')} {componentId}
      </span>
    </div>
  )
}

function AiUiPartRenderer({
  part,
  registry,
  onMutationRequested,
}: {
  part: ServerEmittedUiPartRef
  registry: AiUiPartRegistry
  onMutationRequested?: (pendingActionId: string) => void
}) {
  const Component = registry.resolve(part.componentId)
  const isReserved = isReservedAiUiPartId(part.componentId)
  React.useEffect(() => {
    if (Component) return
    if (isReserved) return
    try {
      // eslint-disable-next-line no-console
      console.warn(
        `[AiChat] No component registered for UI part "${part.componentId}".`,
      )
    } catch {
      // noop
    }
  }, [Component, part.componentId, isReserved])
  React.useEffect(() => {
    if (part.pendingActionId) {
      onMutationRequested?.(part.pendingActionId)
    }
  }, [part.pendingActionId, onMutationRequested])
  if (!Component) {
    return <UnknownUiPartPlaceholder componentId={part.componentId} />
  }
  return (
    <Component
      componentId={part.componentId}
      payload={part.payload}
      pendingActionId={part.pendingActionId}
    />
  )
}

function WelcomeState({
  title,
  description,
  suggestions,
  onSuggestionClick,
}: {
  title?: string
  description?: string
  suggestions?: AiChatSuggestion[]
  onSuggestionClick: (prompt: string) => void
}) {
  const t = useT()
  const heading = title ?? t('ai_assistant.chat.welcomeTitle', 'How can I help?')
  const desc =
    description ??
    t(
      'ai_assistant.chat.welcomeDescription',
      'Ask me anything about your data. Here are some things I can do:',
    )
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-8">
      <div
        className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary"
        aria-hidden
      >
        <Bot className="size-6" />
      </div>
      <div className="space-y-1 text-center">
        <h3 className="text-sm font-semibold">{heading}</h3>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
      {suggestions && suggestions.length > 0 ? (
        <div className="flex w-full max-w-md flex-col gap-2" data-ai-chat-suggestions="">
          {suggestions.map((suggestion, index) => (
            <button
              key={index}
              type="button"
              className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
              onClick={() => onSuggestionClick(suggestion.prompt)}
              data-ai-chat-suggestion={index}
            >
              {suggestion.icon ? (
                <span className="shrink-0 text-muted-foreground" aria-hidden>
                  {suggestion.icon}
                </span>
              ) : null}
              <span>{suggestion.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function ContextItemsPill({ items }: { items: AiChatContextItem[] }) {
  if (items.length === 0) return null
  return (
    <div
      className="flex flex-wrap gap-1.5 border-b border-border px-3 py-2"
      data-ai-chat-context-items=""
    >
      {items.map((item, index) => (
        <span
          key={index}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2 py-0.5 text-xs text-secondary-foreground"
          data-ai-chat-context-item={index}
          title={item.detail}
        >
          {item.label}
        </span>
      ))}
    </div>
  )
}

/**
 * Embeddable AI chat component. Binds to the dispatcher route
 * `POST /api/ai_assistant/ai/chat?agent=<module>.<agent>` via
 * {@link createAiAgentTransport}. Phase 2 WS-A deliverable (Step 4.1).
 *
 * - Keyboard: `Enter` submits; `Shift+Enter` inserts a newline; `Escape`
 *   aborts streaming (or blurs the composer when idle).
 * - Error envelopes from the dispatcher surface as `Alert` + `onError`.
 * - UI parts render via the client-side registry; unknown parts render a
 *   neutral placeholder chip so mutation-card slots reserved for Phase 3
 *   never throw before their implementations land.
 */
export function AiChat({
  agent,
  apiPath,
  pageContext,
  attachmentIds,
  initialMessages,
  debug,
  className,
  placeholder,
  onMutationRequested,
  onError,
  registry,
  uiParts: uiPartsProp,
  debugTools,
  debugPromptSections,
  conversationId,
  suggestions,
  contextItems,
  welcomeTitle,
  welcomeDescription,
  defaultCompactFooter = false,
}: AiChatProps) {
  const t = useT()
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)
  const transcriptRef = React.useRef<HTMLDivElement | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const [input, setInput] = React.useState('')
  type PendingAttachment = {
    file: File
    attachmentId?: string
    /**
     * Base64 data URL of the image (capped by PREVIEW_DATA_URL_MAX_BYTES).
     * Stored on the message so the preview survives a reload — durable
     * server URLs were intentionally avoided because the LLM provider can
     * never reach a localhost dev URL anyway, and HTTP fetches add latency
     * the chat doesn't need.
     */
    previewDataUrl?: string
    error?: string
  }
  const [pendingFiles, setPendingFiles] = React.useState<PendingAttachment[]>([])
  const upload = useAiChatUpload()
  const isUploading = upload.busy
  const footerRef = React.useRef<HTMLDivElement | null>(null)
  const [isCompactFooter, setIsCompactFooter] = React.useState(defaultCompactFooter)

  React.useEffect(() => {
    const element = footerRef.current
    if (!element || typeof ResizeObserver === 'undefined') return

    const updateCompactState = (width: number) => {
      setIsCompactFooter(width < COMPACT_FOOTER_MAX_WIDTH)
    }

    updateCompactState(element.getBoundingClientRect().width)
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      updateCompactState(entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const uploadedAttachmentIds = React.useMemo(
    () =>
      pendingFiles
        .map((entry) => entry.attachmentId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    [pendingFiles],
  )

  const allAttachmentIds = React.useMemo(
    () => [...(attachmentIds ?? []), ...uploadedAttachmentIds],
    [attachmentIds, uploadedAttachmentIds],
  )

  const {
    providers: modelProviders,
    allowRuntimeModelOverride,
    defaultLabel: modelDefaultLabel,
    loaded: modelProvidersLoaded,
  } = useAgentModels(agent)

  const [modelPickerValue, setModelPickerValue] = React.useState<ModelPickerValue | null>(() =>
    readModelPickerValue(agent),
  )

  const effectiveModelPickerValue = React.useMemo(() => {
    if (!modelProvidersLoaded || !allowRuntimeModelOverride || modelProviders.length === 0) {
      return null
    }
    if (modelPickerValue && isModelPickerValueAvailable(modelPickerValue, modelProviders)) {
      return modelPickerValue
    }
    return firstAvailableModelPickerValue(modelProviders)
  }, [
    allowRuntimeModelOverride,
    modelPickerValue,
    modelProviders,
    modelProvidersLoaded,
  ])

  React.useEffect(() => {
    setModelPickerValue(readModelPickerValue(agent))
  }, [agent])

  React.useEffect(() => {
    if (!modelProvidersLoaded) return
    if (!allowRuntimeModelOverride || modelProviders.length === 0) {
      if (modelPickerValue !== null) {
        setModelPickerValue(null)
        writeModelPickerValue(agent, null)
      }
      return
    }
    if (modelPickerValue && !isModelPickerValueAvailable(modelPickerValue, modelProviders)) {
      const fallback = firstAvailableModelPickerValue(modelProviders)
      setModelPickerValue(fallback)
      writeModelPickerValue(agent, fallback)
    }
  }, [
    agent,
    allowRuntimeModelOverride,
    modelPickerValue,
    modelProviders,
    modelProvidersLoaded,
  ])

  const handleModelPickerChange = React.useCallback(
    (value: ModelPickerValue | null) => {
      setModelPickerValue(value)
      writeModelPickerValue(agent, value)
    },
    [agent],
  )

  const chat = useAiChat({
    agent,
    apiPath,
    pageContext,
    attachmentIds: allAttachmentIds.length > 0 ? allAttachmentIds : undefined,
    debug,
    initialMessages,
    onError,
    conversationId,
    providerOverride: effectiveModelPickerValue?.providerId ?? null,
    modelOverride: effectiveModelPickerValue?.modelId ?? null,
  })

  const isStreaming = chat.status === 'streaming'
  const isSubmitting = chat.status === 'submitting'
  const isBusy = isStreaming || isSubmitting

  // Surface a "Thinking..." placeholder so the chat does not look frozen.
  // Visible whenever ANY of the following is true while a turn is in flight:
  //   (a) we're still in the submit phase before the first stream chunk
  //   (b) streaming, but no content / reasoning / tool calls have arrived yet
  //   (c) streaming, and at least one tool call is still in `pending` state
  //       (the model is waiting on a tool result — the previous version
  //        treated `toolCalls.length > 0` as "has content" and hid the
  //        indicator the moment the first tool started, even though the
  //        model had not produced any user-visible output yet)
  //   (d) streaming, and the last visible event was a finished tool call
  //       — the model is reasoning about the result before emitting more
  //       text or kicking off the next tool
  //   (e) streaming, but no delta has landed in the last ~300 ms (idle gap)
  const lastAssistant = React.useMemo(() => {
    for (let index = chat.messages.length - 1; index >= 0; index -= 1) {
      const candidate = chat.messages[index]
      if (candidate?.role === 'assistant') return candidate
    }
    return null
  }, [chat.messages])

  const trimmedContent = lastAssistant?.content?.trim() ?? ''
  const hasReasoning = !!(lastAssistant?.reasoning && lastAssistant.reasoning.length > 0)
  const toolCalls = lastAssistant?.toolCalls ?? []
  const hasPendingToolCall = toolCalls.some((call) => call.state === 'pending')
  const hasCompletedToolCall = toolCalls.some(
    (call) => call.state === 'complete' || call.state === 'error',
  )
  const hasAnyVisibleSignal = !!(
    trimmedContent || hasReasoning || toolCalls.length > 0
  )

  const assistantStreamSnapshot = React.useMemo(() => {
    if (!lastAssistant) return ''
    const toolSig = toolCalls
      .map((call) => `${call.id}:${call.state}:${call.output != null ? 1 : 0}`)
      .join('|')
    return [
      lastAssistant.id,
      lastAssistant.content?.length ?? 0,
      lastAssistant.reasoning?.length ?? 0,
      lastAssistant.reasoningStreaming ? 1 : 0,
      toolSig,
    ].join('#')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastAssistant])

  const lastStreamUpdateRef = React.useRef<number>(Date.now())
  const lastSnapshotRef = React.useRef<string>('')
  const [, setStreamTick] = React.useState(0)

  React.useEffect(() => {
    if (assistantStreamSnapshot !== lastSnapshotRef.current) {
      lastSnapshotRef.current = assistantStreamSnapshot
      lastStreamUpdateRef.current = Date.now()
      setStreamTick((value) => value + 1)
    }
  }, [assistantStreamSnapshot])

  React.useEffect(() => {
    if (!isStreaming && !isSubmitting) return
    const interval = window.setInterval(() => {
      setStreamTick((value) => value + 1)
    }, 200)
    return () => window.clearInterval(interval)
  }, [isStreaming, isSubmitting])

  const idleDuringStream =
    isStreaming && Date.now() - lastStreamUpdateRef.current >= 300

  const showThinkingIndicator =
    isSubmitting ||
    (isStreaming &&
      (
        !hasAnyVisibleSignal ||
        hasPendingToolCall ||
        // Tool just returned and the model hasn't started speaking yet.
        (hasCompletedToolCall && !trimmedContent) ||
        idleDuringStream
      ))

  const activeRegistry = registry ?? defaultAiUiPartRegistry

  // Reserved UI parts. Phase 3 will populate this from the streamed response;
  // for Phase 2 WS-A it stays empty unless the host surfaces test/debug parts
  // via the optional `uiParts` prop so the registry resolution path can be
  // exercised without waiting for the runtime emitter.
  const uiParts: ServerEmittedUiPartRef[] = React.useMemo(
    () => (uiPartsProp ?? []).map((part) => ({
      componentId: part.componentId,
      payload: part.payload,
      pendingActionId: part.pendingActionId,
    })),
    [uiPartsProp],
  )

  const hasUploadingFiles = React.useMemo(
    () => pendingFiles.some((entry) => !entry.attachmentId && !entry.error),
    [pendingFiles],
  )

  const handleSendMessage = React.useCallback(
    (text: string) => {
      if (!text.trim() || isBusy) return
      // Block send while any attachment is still uploading. Without this guard
      // the message would ship with an empty attachmentIds list (the chip is
      // visible but the server hasn't returned an id yet), the model would
      // never see the file, and `setPendingFiles([])` below would erase the
      // chip — so the upload finishes into the void. Surface the wait via the
      // disabled Send button + composer hint instead.
      if (hasUploadingFiles || isUploading) return
      const filesToAttach = pendingFiles.map((entry): AiChatMessageFile => {
        const isImage = entry.file.type.startsWith('image/')
        const fallback = isImage ? URL.createObjectURL(entry.file) : undefined
        return {
          name: entry.file.name,
          type: entry.file.type,
          previewUrl: isImage ? (entry.previewDataUrl ?? fallback) : undefined,
        }
      })
      setInput('')
      setPendingFiles([])
      void chat.sendMessage(text, filesToAttach.length > 0 ? filesToAttach : undefined)
    },
    [chat, hasUploadingFiles, isBusy, isUploading, pendingFiles],
  )

  const handleSubmit = React.useCallback(() => {
    handleSendMessage(input)
  }, [handleSendMessage, input])

  // Listen for "Fix with AI" requests dispatched by the failure variant
  // of `MutationResultCard`. Any rendered failure card can fire a custom
  // DOM event with the prompt — this side-steps having to thread a
  // sendMessage callback through the UI-part registry while keeping the
  // chat the single owner of message creation. Idempotency is handled
  // server-side: `prepareMutation` only dedupes against active `pending`
  // rows, so a retry after a terminal failure always produces a fresh
  // pending action.
  React.useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail
      const message = detail?.message
      if (typeof message !== 'string' || message.trim().length === 0) return
      handleSendMessage(message)
    }
    window.addEventListener('om-ai-chat-fix-request', handler as EventListener)
    return () => {
      window.removeEventListener('om-ai-chat-fix-request', handler as EventListener)
    }
  }, [handleSendMessage])

  const cancelOrBlur = React.useCallback(() => {
    if (isBusy) {
      chat.cancel()
      return
    }
    textareaRef.current?.blur()
  }, [chat, isBusy])

  const handleFileSelect = React.useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? [])
      if (files.length === 0) return
      const queued: PendingAttachment[] = files.map((file) => ({ file }))
      setPendingFiles((prev) => [...prev, ...queued])
      const [previewResults, result] = await Promise.all([
        Promise.all(files.map((file) => readFileAsDataUrl(file))),
        upload.upload(files),
      ])
      // Pair upload outcomes back to chips by input INDEX, not by filename.
      // The server may sanitize the uploaded name (whitespace, unicode,
      // dangerous characters), and two files in the same batch can share a
      // name — both cases broke the previous Map-by-fileName matching and
      // left the chip stuck on the spinner forever.
      const idByIndex = new Map<number, string>()
      for (const item of result.items) {
        if (typeof item.inputIndex === 'number') idByIndex.set(item.inputIndex, item.attachmentId)
      }
      const errorByIndex = new Map<number, string>()
      for (const failure of result.failed) {
        if (typeof failure.inputIndex === 'number') errorByIndex.set(failure.inputIndex, failure.message)
      }
      setPendingFiles((prev) => {
        const next = prev.slice()
        const baseIndex = next.length - files.length
        for (let offset = 0; offset < files.length; offset += 1) {
          const index = baseIndex + offset
          if (index < 0) continue
          const entry = next[index]
          if (!entry) continue
          const dataUrl = previewResults[offset]
          const patch: PendingAttachment = {
            ...entry,
            previewDataUrl: dataUrl ?? entry.previewDataUrl,
          }
          if (!patch.attachmentId) {
            const id = idByIndex.get(offset)
            if (id) {
              patch.attachmentId = id
              patch.error = undefined
            } else {
              // Defensive fallback: if neither success nor failure carried an
              // index for this slot (older transports, partial outcome), the
              // chip would otherwise stay on the spinner. Mark it as a
              // generic error so the user can remove it and retry instead of
              // staring at a dead spinner that also blocks the Send button.
              const explicitError = errorByIndex.get(offset)
              patch.error =
                explicitError ??
                'Upload finished without a server response. Remove the file and try again.'
            }
          }
          next[index] = patch
        }
        return next
      })
      if (fileInputRef.current) fileInputRef.current.value = ''
    },
    [upload],
  )

  const removePendingFile = React.useCallback((index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const { handleKeyDown } = useAiShortcuts({
    onSubmit: handleSubmit,
    onCancel: cancelOrBlur,
  })

  React.useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  // Sticky-bottom autoscroll: only re-pin to the bottom when the user is
  // already there (or within a small tolerance). If they have scrolled up to
  // read an earlier part of a long response, every streaming delta would
  // otherwise yank them back to the tail and make the message look truncated.
  // Tolerance is generous enough to absorb sub-pixel rounding, but tight
  // enough that an intentional scroll-up keeps the user where they want.
  const stickToBottomRef = React.useRef(true)
  const SCROLL_STICK_TOLERANCE_PX = 64

  React.useEffect(() => {
    const node = transcriptRef.current
    if (!node) return
    const handleScroll = () => {
      const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight
      stickToBottomRef.current = distanceFromBottom <= SCROLL_STICK_TOLERANCE_PX
    }
    node.addEventListener('scroll', handleScroll, { passive: true })
    return () => node.removeEventListener('scroll', handleScroll)
  }, [])

  React.useEffect(() => {
    const node = transcriptRef.current
    if (!node) return
    if (!stickToBottomRef.current) return
    node.scrollTop = node.scrollHeight
  }, [chat.messages])

  // Mark the body so floating UI surfaces (e.g. the demo feedback FAB) can
  // hide themselves while the chat is open and would otherwise overlay the
  // composer's send button. CSS lives in `apps/mercato/src/app/globals.css`
  // alongside the column-chooser precedent.
  React.useEffect(() => {
    if (typeof document === 'undefined') return
    const previous = document.body.getAttribute('data-ai-chat-open')
    document.body.setAttribute('data-ai-chat-open', 'true')
    return () => {
      if (previous === null) {
        document.body.removeAttribute('data-ai-chat-open')
      } else {
        document.body.setAttribute('data-ai-chat-open', previous)
      }
    }
  }, [])

  const handleNewConversation = React.useCallback(() => {
    chat.reset()
    setInput('')
    setPendingFiles([])
    upload.reset()
    setTimeout(() => textareaRef.current?.focus(), 0)
  }, [chat, upload])

  const resolvedPlaceholder =
    placeholder ?? t('ai_assistant.chat.composerPlaceholder', 'Message the AI agent...')

  const errorVariant = mapErrorCodeToVariant(chat.error?.code)

  return (
    <section
      className={cn(
        'flex h-full min-h-[320px] min-w-0 flex-col gap-3 overflow-hidden rounded-lg border border-border bg-background p-3',
        className,
      )}
      aria-label={t('ai_assistant.chat.regionLabel', 'AI chat')}
      data-ai-chat-agent={agent}
      data-ai-chat-conversation-id={chat.conversationId}
    >
      <div className="flex min-w-0 items-center justify-between gap-2 border-b border-border pb-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted-foreground">
          {contextItems && contextItems.length > 0 ? (
            <ContextItemsPill items={contextItems} />
          ) : (
            <span className="font-mono opacity-70" aria-hidden>
              {chat.conversationId.slice(0, 8)}
            </span>
          )}
        </div>
        <IconButton
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleNewConversation}
          disabled={isBusy}
          aria-label={t('ai_assistant.chat.newConversation', 'Start new conversation')}
          title={t('ai_assistant.chat.newConversation', 'Start new conversation')}
          data-ai-chat-new-conversation=""
        >
          <Plus className="size-4" aria-hidden />
        </IconButton>
      </div>
      <div
        ref={transcriptRef}
        role="log"
        aria-live="polite"
        aria-label={t('ai_assistant.chat.transcriptLabel', 'Chat transcript')}
        className="min-w-0 flex-1 space-y-2 overflow-y-auto overflow-x-hidden pr-1"
      >
        {chat.messages.length === 0 ? (
          <WelcomeState
            title={welcomeTitle}
            description={welcomeDescription}
            suggestions={suggestions}
            onSuggestionClick={handleSendMessage}
          />
        ) : (
          chat.messages.map((message) => (
            <MessageRow
              key={message.id}
              message={message}
              registry={activeRegistry}
              onMutationRequested={onMutationRequested}
            />
          ))
        )}
        {uiParts.map((part, index) => (
          <AiUiPartRenderer
            key={`${part.componentId}-${index}`}
            part={part}
            registry={activeRegistry}
            onMutationRequested={onMutationRequested}
          />
        ))}
        {showThinkingIndicator ? (
          <div
            className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground"
            data-ai-chat-state="thinking"
          >
            <Loader2 className="size-4 animate-spin" aria-hidden />
            <span>{t('ai_assistant.chat.thinking', 'Thinking...')}</span>
          </div>
        ) : null}
      </div>

      {chat.error ? (
        <Alert variant={errorVariant} data-ai-chat-error={chat.error.code ?? 'unknown'}>
          <AlertTitle>
            {t('ai_assistant.chat.errorTitle', 'Agent dispatch failed')}
          </AlertTitle>
          <AlertDescription>
            {chat.error.code ? (
              <span className="mr-2 font-mono text-xs">{chat.error.code}</span>
            ) : null}
            {chat.error.message}
          </AlertDescription>
        </Alert>
      ) : null}

      <form
        className="flex min-w-0 flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          handleSubmit()
        }}
      >
        <Label
          htmlFor="ai-chat-composer"
          className="sr-only"
        >
          {t('ai_assistant.chat.composerLabel', 'Message composer')}
        </Label>
        {pendingFiles.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 rounded-md border border-border bg-muted/30 px-2 py-1.5" data-ai-chat-attachments="">
            {pendingFiles.map((entry, index) => (
              <span
                key={index}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-xs"
                title={entry.error ? entry.error : undefined}
                data-ai-chat-attachment-state={
                  entry.error ? 'error' : entry.attachmentId ? 'ready' : 'uploading'
                }
              >
                <Paperclip className="size-3 text-muted-foreground" aria-hidden />
                <span className="max-w-[120px] truncate">{entry.file.name}</span>
                {!entry.attachmentId && !entry.error ? (
                  <Loader2 className="size-3 animate-spin text-muted-foreground" aria-hidden />
                ) : null}
                <button
                  type="button"
                  className="ml-0.5 rounded-full p-0.5 hover:bg-muted"
                  onClick={() => removePendingFile(index)}
                  aria-label={t('ai_assistant.chat.removeFile', 'Remove file')}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
            {isUploading ? <Loader2 className="size-3 animate-spin text-muted-foreground" aria-hidden /> : null}
          </div>
        ) : null}
        <Textarea
          id="ai-chat-composer"
          ref={textareaRef}
          value={input}
          placeholder={resolvedPlaceholder}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          rows={3}
          aria-label={t('ai_assistant.chat.composerLabel', 'Message composer')}
          className="min-w-0 resize-none"
        />
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,.pdf,.doc,.docx,.txt,.csv"
          className="hidden"
          onChange={handleFileSelect}
          data-ai-chat-file-input=""
        />
        <div
          ref={footerRef}
          className="flex min-w-0 items-center justify-between gap-2"
          data-ai-chat-footer=""
          data-ai-chat-footer-compact={isCompactFooter ? 'true' : 'false'}
        >
          <div className="flex min-w-0 items-center gap-2">
            <IconButton
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={isBusy || isUploading}
              aria-label={t('ai_assistant.chat.attachFile', 'Attach file')}
            >
              <Paperclip className="size-4" aria-hidden />
            </IconButton>
            {allowRuntimeModelOverride && modelProviders.length > 0 ? (
              <ModelPicker
                agentId={agent}
                value={effectiveModelPickerValue}
                onChange={handleModelPickerChange}
                availableProviders={modelProviders}
                disabled={isBusy}
                compact={isCompactFooter}
                defaultLabel={modelDefaultLabel}
                className="shrink-0"
              />
            ) : null}
            <p className={cn('text-xs text-muted-foreground', isCompactFooter && 'hidden')}>
              {hasUploadingFiles || isUploading
                ? t(
                    'ai_assistant.chat.uploadingHint',
                    'Uploading attachments… Send is disabled until they finish.',
                  )
                : t(
                    'ai_assistant.chat.shortcutHint',
                    'Press Enter to send, Shift+Enter for new line.',
                  )}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {isStreaming ? (
              <IconButton
                type="button"
                variant="outline"
                size="sm"
                onClick={() => chat.cancel()}
                aria-label={t('ai_assistant.chat.cancel', 'Cancel streaming response')}
              >
                <Square className="size-4" aria-hidden />
              </IconButton>
            ) : null}
            <Button
              type="submit"
              size="sm"
              disabled={
                isBusy ||
                isUploading ||
                hasUploadingFiles ||
                input.trim().length === 0
              }
              aria-label={
                hasUploadingFiles || isUploading
                  ? t('ai_assistant.chat.sendWaitingForUpload', 'Waiting for upload to finish…')
                  : t('ai_assistant.chat.send', 'Send message')
              }
              title={
                hasUploadingFiles || isUploading
                  ? t('ai_assistant.chat.sendWaitingForUpload', 'Waiting for upload to finish…')
                  : undefined
              }
              className={cn(isCompactFooter && 'w-8 px-0')}
            >
              <Send className="size-4" aria-hidden />
              {!isCompactFooter ? (
                <span>{t('ai_assistant.chat.send', 'Send message')}</span>
              ) : null}
            </Button>
          </div>
        </div>
      </form>

      {debug ? (
        <AiChatDebugPanel
          tools={debugTools}
          promptSections={debugPromptSections}
          lastRequestDebug={chat.lastRequestDebug}
          lastResponseDebug={chat.lastResponseDebug}
          status={chat.status}
          errorCode={chat.error?.code}
        />
      ) : null}
    </section>
  )
}

interface DebugPanelProps {
  tools?: AiChatDebugTool[]
  promptSections?: AiChatDebugPromptSection[]
  lastRequestDebug: { url: string; body: unknown } | null
  lastResponseDebug: { status: number; text: string } | null
  status: 'idle' | 'submitting' | 'streaming'
  errorCode?: string
}

function AiChatDebugPanel({
  tools,
  promptSections,
  lastRequestDebug,
  lastResponseDebug,
  status,
  errorCode,
}: DebugPanelProps) {
  const t = useT()
  return (
    <div
      className="flex flex-col gap-2 rounded-md border border-border bg-muted/60 p-2 text-xs"
      data-ai-chat-debug="true"
    >
      <div className="font-semibold">
        {t('ai_assistant.chat.debug.panelTitle', 'Debug panel')}
      </div>

      <details className="rounded border border-border bg-background" data-ai-chat-debug-section="tools" open>
        <summary className="cursor-pointer px-2 py-1 font-semibold">
          {t('ai_assistant.chat.debug.toolsSection', 'Resolved tools')}
          {tools ? (
            <span className="ml-2 font-mono text-muted-foreground">({tools.length})</span>
          ) : null}
        </summary>
        <div className="px-2 pb-2">
          {tools && tools.length > 0 ? (
            <ul className="flex flex-col gap-1" data-ai-chat-debug-tools>
              {tools.map((tool) => (
                <li
                  key={tool.name}
                  className="flex flex-col rounded border border-border bg-muted/40 px-2 py-1"
                  data-ai-chat-debug-tool={tool.name}
                >
                  <span className="font-mono">{tool.name}</span>
                  {tool.displayName ? (
                    <span className="text-muted-foreground">{tool.displayName}</span>
                  ) : null}
                  <span className="mt-1 flex flex-wrap gap-2 text-muted-foreground">
                    <span>
                      {tool.isMutation
                        ? t('ai_assistant.chat.debug.toolMutation', 'mutation')
                        : t('ai_assistant.chat.debug.toolRead', 'read')}
                    </span>
                    {tool.requiredFeatures && tool.requiredFeatures.length > 0 ? (
                      <span className="font-mono">
                        [{tool.requiredFeatures.join(', ')}]
                      </span>
                    ) : (
                      <span>
                        {t('ai_assistant.chat.debug.toolNoFeatures', 'no required features')}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">
              {t(
                'ai_assistant.chat.debug.toolsEmpty',
                'No tools resolved for this agent yet.',
              )}
            </p>
          )}
        </div>
      </details>

      <details
        className="rounded border border-border bg-background"
        data-ai-chat-debug-section="promptSections"
      >
        <summary className="cursor-pointer px-2 py-1 font-semibold">
          {t('ai_assistant.chat.debug.promptSection', 'Prompt sections')}
          {promptSections ? (
            <span className="ml-2 font-mono text-muted-foreground">({promptSections.length})</span>
          ) : null}
        </summary>
        <div className="px-2 pb-2">
          {promptSections && promptSections.length > 0 ? (
            <ul className="flex flex-col gap-1" data-ai-chat-debug-prompt-sections>
              {promptSections.map((section) => (
                <li
                  key={section.id}
                  className="rounded border border-border bg-muted/40 px-2 py-1"
                  data-ai-chat-debug-prompt-section-id={section.id}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono">{section.id}</span>
                    <span className="text-muted-foreground">
                      {section.source === 'override'
                        ? t('ai_assistant.chat.debug.promptOverride', 'override')
                        : section.source === 'placeholder'
                          ? t('ai_assistant.chat.debug.promptPlaceholder', 'placeholder')
                          : t('ai_assistant.chat.debug.promptDefault', 'default')}
                    </span>
                  </div>
                  {section.text ? (
                    <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap font-mono text-muted-foreground">
                      {section.text}
                    </pre>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">
              {t(
                'ai_assistant.chat.debug.promptEmpty',
                'No prompt sections resolved for this agent.',
              )}
            </p>
          )}
        </div>
      </details>

      <details
        className="rounded border border-border bg-background"
        data-ai-chat-debug-section="lastRequest"
      >
        <summary className="cursor-pointer px-2 py-1 font-semibold">
          {t('ai_assistant.chat.debug.lastRequestSection', 'Last request')}
        </summary>
        <div className="px-2 pb-2">
          {lastRequestDebug ? (
            <pre
              className="max-h-40 overflow-auto whitespace-pre-wrap font-mono"
              data-ai-chat-debug-last-request
            >
              {JSON.stringify(lastRequestDebug, null, 2)}
            </pre>
          ) : (
            <p className="text-muted-foreground">
              {t(
                'ai_assistant.chat.debug.lastRequestEmpty',
                'No request has been sent yet.',
              )}
            </p>
          )}
        </div>
      </details>

      <details
        className="rounded border border-border bg-background"
        data-ai-chat-debug-section="lastResponse"
      >
        <summary className="cursor-pointer px-2 py-1 font-semibold">
          {t('ai_assistant.chat.debug.lastResponseSection', 'Last response')}
        </summary>
        <div className="px-2 pb-2">
          {lastResponseDebug ? (
            <pre
              className="max-h-40 overflow-auto whitespace-pre-wrap font-mono"
              data-ai-chat-debug-last-response
            >
              {JSON.stringify(
                { status: lastResponseDebug.status, text: lastResponseDebug.text, errorCode },
                null,
                2,
              )}
            </pre>
          ) : (
            <p className="text-muted-foreground">
              {t(
                'ai_assistant.chat.debug.lastResponseEmpty',
                'No response received yet.',
              )}
            </p>
          )}
        </div>
      </details>

      <div className="text-muted-foreground" data-ai-chat-debug-status={status}>
        {t('ai_assistant.chat.debug.statusLabel', 'Status:')}{' '}
        <span className="font-mono">{status}</span>
      </div>
    </div>
  )
}

export default AiChat
