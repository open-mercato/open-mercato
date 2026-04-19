"use client"

import * as React from 'react'
import { Bot, Loader2, Send, Square, User } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { Alert, AlertDescription, AlertTitle } from '../primitives/alert'
import { Button } from '../primitives/button'
import { IconButton } from '../primitives/icon-button'
import { Label } from '../primitives/label'
import { Textarea } from '../primitives/textarea'
import {
  defaultAiUiPartRegistry,
  isReservedAiUiPartId,
  type AiUiPartComponentId,
  type AiUiPartRegistry,
} from './ui-part-registry'
import { useAiChat, type AiChatMessage } from './useAiChat'
import { useAiShortcuts } from './useAiShortcuts'

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

function MessageRow({ message }: { message: AiChatMessage }) {
  const t = useT()
  const isAssistant = message.role === 'assistant'
  const label = isAssistant
    ? t('ai_assistant.chat.assistantRoleLabel', 'Assistant')
    : t('ai_assistant.chat.userRoleLabel', 'You')
  const Icon = isAssistant ? Bot : User
  return (
    <div
      className={cn(
        'flex gap-3 px-3 py-2',
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
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        <div className="whitespace-pre-wrap text-sm">{message.content}</div>
      </div>
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

/**
 * Embeddable AI chat component. Binds to the dispatcher route
 * `POST /api/ai_assistant/ai/chat?agent=<module>.<agent>` via
 * {@link createAiAgentTransport}. Phase 2 WS-A deliverable (Step 4.1).
 *
 * - Keyboard: `Cmd/Ctrl+Enter` submits; `Escape` aborts streaming (or blurs
 *   the composer when idle).
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
}: AiChatProps) {
  const t = useT()
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)
  const transcriptRef = React.useRef<HTMLDivElement | null>(null)
  const [input, setInput] = React.useState('')

  const chat = useAiChat({
    agent,
    apiPath,
    pageContext,
    attachmentIds,
    debug,
    initialMessages,
    onError,
    conversationId,
  })

  const isStreaming = chat.status === 'streaming'
  const isSubmitting = chat.status === 'submitting'
  const isBusy = isStreaming || isSubmitting

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

  const handleSubmit = React.useCallback(() => {
    const value = input
    if (!value.trim() || isBusy) return
    setInput('')
    void chat.sendMessage(value)
  }, [chat, input, isBusy])

  const cancelOrBlur = React.useCallback(() => {
    if (isBusy) {
      chat.cancel()
      return
    }
    textareaRef.current?.blur()
  }, [chat, isBusy])

  const { handleKeyDown } = useAiShortcuts({
    onSubmit: handleSubmit,
    onCancel: cancelOrBlur,
  })

  React.useEffect(() => {
    const node = transcriptRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [chat.messages])

  const resolvedPlaceholder =
    placeholder ?? t('ai_assistant.chat.composerPlaceholder', 'Message the AI agent...')

  const errorVariant = mapErrorCodeToVariant(chat.error?.code)

  return (
    <section
      className={cn(
        'flex h-full min-h-[320px] flex-col gap-3 rounded-lg border border-border bg-background p-3',
        className,
      )}
      aria-label={t('ai_assistant.chat.regionLabel', 'AI chat')}
      data-ai-chat-agent={agent}
      data-ai-chat-conversation-id={chat.conversationId}
    >
      <div
        ref={transcriptRef}
        role="log"
        aria-live="polite"
        aria-label={t('ai_assistant.chat.transcriptLabel', 'Chat transcript')}
        className="flex-1 space-y-2 overflow-y-auto pr-1"
      >
        {chat.messages.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            {t(
              'ai_assistant.chat.emptyTranscript',
              'No messages yet. Ask the agent anything to get started.',
            )}
          </p>
        ) : (
          chat.messages.map((message) => (
            <MessageRow key={message.id} message={message} />
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
        {isSubmitting ? (
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
        className="flex flex-col gap-2"
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
        <Textarea
          id="ai-chat-composer"
          ref={textareaRef}
          value={input}
          placeholder={resolvedPlaceholder}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          rows={3}
          aria-label={t('ai_assistant.chat.composerLabel', 'Message composer')}
          className="resize-none"
        />
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {t(
              'ai_assistant.chat.shortcutHint',
              'Press Cmd/Ctrl+Enter to send, Escape to cancel.',
            )}
          </p>
          <div className="flex items-center gap-2">
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
              disabled={isBusy || input.trim().length === 0}
              aria-label={t('ai_assistant.chat.send', 'Send message')}
            >
              <Send className="size-4" aria-hidden />
              <span>{t('ai_assistant.chat.send', 'Send message')}</span>
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
