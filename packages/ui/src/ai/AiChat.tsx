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

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        handleSubmit()
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        if (isBusy) {
          chat.cancel()
          return
        }
        textareaRef.current?.blur()
      }
    },
    [chat, handleSubmit, isBusy],
  )

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
        <div
          className="rounded-md border border-border bg-muted/60 p-2 text-xs"
          data-ai-chat-debug="true"
        >
          <div className="mb-1 font-semibold">
            {t('ai_assistant.chat.debugPanelTitle', 'Debug panel')}
          </div>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono">
            {JSON.stringify(
              {
                request: chat.lastRequestDebug,
                response: chat.lastResponseDebug,
                status: chat.status,
              },
              null,
              2,
            )}
          </pre>
        </div>
      ) : null}
    </section>
  )
}

export default AiChat
