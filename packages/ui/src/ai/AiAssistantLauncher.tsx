"use client"

/**
 * Global AI assistant launcher.
 *
 * Reusable component that:
 *   - Hides itself when the AI runtime is not configured (no provider key,
 *     `/api/ai_assistant/health` returns non-OK, or `/api/ai_assistant/ai/agents`
 *     returns zero accessible agents for the caller).
 *   - Exposes a compact icon trigger styled for the topbar.
 *   - Opens a Cmd-K-style searchable dialog listing every typed agent the
 *     caller is allowed to launch — searchable by label, description, or id —
 *     so it scales to many assistants.
 *   - On agent select, opens `<AiChat>` in a right-side sheet with empty
 *     `pageContext` (the picker is intentionally page-agnostic; per-page
 *     triggers continue to embed `<AiChat>` directly with their own context).
 *   - Binds a global keyboard shortcut (default Cmd/Ctrl+L) that opens the
 *     picker. Cmd+K stays reserved for global search; Cmd+J stays reserved
 *     for the legacy OpenCode command palette. Browsers normally use
 *     Cmd/Ctrl+L for "focus address bar"; we `preventDefault()` so the
 *     launcher wins when an Open Mercato page has focus.
 */

import * as React from 'react'
import {
  Bot,
  Boxes,
  HelpCircle,
  Lightbulb,
  Loader2,
  PanelRightOpen,
  Search,
  Sparkles,
} from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { apiCall } from '../backend/utils/apiCall'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../primitives/dialog'
import { Button } from '../primitives/button'
import { IconButton } from '../primitives/icon-button'
import { Kbd, KbdShortcut } from '../primitives/kbd'
import { useAiDock } from './AiDock'
import { useAiChatSessions } from './AiChatSessions'
import { ChatPaneTabs } from './ChatPaneTabs'
import type { AiChatContextItem, AiChatSuggestion } from './AiChat'

// Lazy-load the chat surface so AppShell tests (and any other importers that
// don't actually open the launcher) avoid pulling the AI SDK runtime — which
// touches `TransformStream` and breaks under jsdom.
const LazyAiChat = React.lazy(async () => {
  const mod = await import('./AiChat')
  return { default: mod.AiChat }
})

export interface AiAssistantLauncherAgent {
  id: string
  label: string
  description?: string | null
  moduleId?: string | null
  /**
   * `read-only` (default), `confirm-required`, or
   * `destructive-confirm-required`. Surfaced as a small badge in the picker
   * row so operators can see at a glance which assistants can write.
   */
  mutationPolicy?: string | null
  keywords?: string[]
}

export interface AiAssistantLauncherProps {
  /**
   * Trigger placement. `topbar` (default) = rounded-rectangle pill button
   * matching the global-search trigger (icon + "AI" label + ⌘L kbd hint).
   * `inline` is a back-compat alias and renders the same trigger.
   */
  variant?: 'topbar' | 'inline'
  /**
   * Optional override of the agents endpoint. Defaults to
   * `/api/ai_assistant/ai/agents` from the typed agent dispatcher.
   */
  agentsEndpoint?: string
  /**
   * Optional override of the health endpoint. Defaults to
   * `/api/ai_assistant/health`. The launcher hides itself when this returns
   * non-2xx OR a JSON body with `{ healthy: false }`.
   */
  healthEndpoint?: string
  /**
   * When true, skip the health check (useful in tests / hosts that already
   * gated visibility by feature). Defaults to false.
   */
  skipHealthCheck?: boolean
  /**
   * Disable the global keyboard shortcut binding (Cmd/Ctrl+L). Useful for
   * nested launchers in dialogs / portals where the host owns shortcut
   * handling.
   */
  disableGlobalShortcut?: boolean
  className?: string
}

interface AgentsResponse {
  agents?: Array<{
    id?: string | null
    label?: string | null
    description?: string | null
    moduleId?: string | null
    mutationPolicy?: string | null
    keywords?: string[] | null
  }>
  aiConfigured?: boolean
}

interface HealthResponse {
  healthy?: boolean
  status?: string | null
}

const DEFAULT_AGENTS_ENDPOINT = '/api/ai_assistant/ai/agents'
const DEFAULT_HEALTH_ENDPOINT = '/api/ai_assistant/health'

function isMutationCapable(policy: string | null | undefined): boolean {
  return policy === 'confirm-required' || policy === 'destructive-confirm-required'
}

function normalizeAgents(payload: AgentsResponse | null | undefined): AiAssistantLauncherAgent[] {
  if (!payload || !Array.isArray(payload.agents)) return []
  const result: AiAssistantLauncherAgent[] = []
  for (const raw of payload.agents) {
    if (!raw || typeof raw.id !== 'string' || raw.id.length === 0) continue
    if (typeof raw.label !== 'string' || raw.label.length === 0) continue
    result.push({
      id: raw.id,
      label: raw.label,
      description: typeof raw.description === 'string' ? raw.description : null,
      moduleId: typeof raw.moduleId === 'string' ? raw.moduleId : null,
      mutationPolicy:
        typeof raw.mutationPolicy === 'string' ? raw.mutationPolicy : null,
      keywords: Array.isArray(raw.keywords)
        ? raw.keywords.filter((value): value is string => typeof value === 'string' && value.length > 0)
        : [],
    })
  }
  return result
}

function matchesQuery(agent: AiAssistantLauncherAgent, query: string): boolean {
  if (!query) return true
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  if (agent.label.toLowerCase().includes(needle)) return true
  if (agent.id.toLowerCase().includes(needle)) return true
  if (agent.description && agent.description.toLowerCase().includes(needle)) return true
  if (agent.moduleId && agent.moduleId.toLowerCase().includes(needle)) return true
  if (agent.keywords && agent.keywords.some((keyword) => keyword.toLowerCase().includes(needle))) return true
  return false
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (target.isContentEditable) return true
  return false
}

export function AiAssistantLauncher({
  variant: _variant = 'topbar',
  agentsEndpoint = DEFAULT_AGENTS_ENDPOINT,
  healthEndpoint = DEFAULT_HEALTH_ENDPOINT,
  skipHealthCheck = false,
  disableGlobalShortcut = false,
  className,
}: AiAssistantLauncherProps) {
  const t = useT()
  const dock = useAiDock()
  const [healthy, setHealthy] = React.useState<boolean | null>(skipHealthCheck ? true : null)
  const [agents, setAgents] = React.useState<AiAssistantLauncherAgent[]>([])
  const [agentsLoaded, setAgentsLoaded] = React.useState(false)
  const [agentsError, setAgentsError] = React.useState<string | null>(null)
  // `aiConfigured: false` → no LLM provider key in env. Hide the launcher
  // silently rather than letting the operator click into a chat that will
  // immediately throw `no_provider_configured`.
  const [aiConfigured, setAiConfigured] = React.useState<boolean | null>(null)
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const [activeAgent, setActiveAgent] = React.useState<AiAssistantLauncherAgent | null>(null)
  const [chatOpen, setChatOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [highlight, setHighlight] = React.useState(0)

  // Health check — best-effort signal only. We do NOT gate the launcher
  // behind it any more: a flaky / slow / transiently-401 health endpoint on
  // page refresh used to leave the launcher permanently hidden because the
  // agents effect short-circuited on `healthy !== true`. Now `healthy` is
  // purely advisory; the launcher's visibility is driven by the agents
  // endpoint, which is the authoritative source — it returns zero agents
  // when AI is not configured anyway. Treat *any* non-explicit-false health
  // response (including network errors and unreachable endpoints) as
  // "probably healthy" so the agents fetch always runs.
  React.useEffect(() => {
    if (skipHealthCheck) return
    let cancelled = false
    apiCall<HealthResponse>(healthEndpoint, {
      credentials: 'same-origin',
      headers: { 'x-om-forbidden-redirect': '0', 'x-om-unauthorized-redirect': '0' },
    })
      .then((call) => {
        if (cancelled) return
        if (!call.ok) {
          // Don't hide the launcher on 4xx/5xx — fall back to "unknown"
          // (treated as healthy below) and let the agents endpoint decide.
          setHealthy(true)
          return
        }
        const body = call.result
        if (body && typeof body === 'object' && body.healthy === false) {
          setHealthy(false)
          return
        }
        setHealthy(true)
      })
      .catch(() => {
        if (cancelled) return
        // Network errors are treated as "probably healthy" too — the
        // agents endpoint is authoritative for visibility.
        setHealthy(true)
      })
    return () => {
      cancelled = true
    }
  }, [healthEndpoint, skipHealthCheck])

  // Agents — fetched on mount, independently of the health check. The
  // endpoint already filters by the caller's ACL features server-side, so
  // an empty response is the right signal to hide the launcher. Loading
  // these here (instead of behind `healthy === true`) makes the launcher
  // resilient to a flaky / slow / transiently-401 health endpoint that
  // would otherwise leave it permanently hidden after a page refresh.
  React.useEffect(() => {
    if (agentsLoaded) return
    let cancelled = false
    apiCall<AgentsResponse>(agentsEndpoint, {
      credentials: 'same-origin',
      headers: { 'x-om-forbidden-redirect': '0', 'x-om-unauthorized-redirect': '0' },
    })
      .then((call) => {
        if (cancelled) return
        if (!call.ok) {
          setAgents([])
          setAgentsError(`agents endpoint returned ${call.status}`)
          setAgentsLoaded(true)
          return
        }
        if (call.result) {
          setAgents(normalizeAgents(call.result))
          setAgentsError(null)
          if (typeof call.result.aiConfigured === 'boolean') {
            setAiConfigured(call.result.aiConfigured)
          }
        } else {
          setAgents([])
          setAgentsError('Empty agents response')
        }
        setAgentsLoaded(true)
      })
      .catch((error) => {
        if (cancelled) return
        setAgents([])
        setAgentsError(error instanceof Error ? error.message : String(error))
        setAgentsLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [agentsEndpoint, agentsLoaded])

  const filteredAgents = React.useMemo(
    () => agents.filter((agent) => matchesQuery(agent, query)),
    [agents, query],
  )

  // Reset highlight when the filtered set changes; clamp to a valid index.
  React.useEffect(() => {
    if (filteredAgents.length === 0) {
      if (highlight !== 0) setHighlight(0)
      return
    }
    if (highlight >= filteredAgents.length) setHighlight(0)
  }, [filteredAgents, highlight])

  const openPicker = React.useCallback(() => {
    setQuery('')
    setHighlight(0)
    setPickerOpen(true)
  }, [])

  const handleSelectAgent = React.useCallback((agent: AiAssistantLauncherAgent) => {
    if (dock.state.assistant?.agent === agent.id) {
      dock.dock(dock.state.assistant)
      setPickerOpen(false)
      setChatOpen(false)
      return
    }
    setActiveAgent(agent)
    setPickerOpen(false)
    setChatOpen(true)
  }, [dock])

  // Global Cmd/Ctrl+L — opens the picker. We bind on `keydown` at the
  // document level and ignore events from text-entry targets so it never
  // interferes with typing inside inputs/textarea. Browsers normally focus
  // the address bar on Cmd/Ctrl+L; `preventDefault()` reclaims the combo
  // when an Open Mercato page has focus.
  React.useEffect(() => {
    if (disableGlobalShortcut) return
    if (typeof window === 'undefined') return
    if (healthy !== true) return
    if (!agentsLoaded || agents.length === 0) return
    const listener = (event: KeyboardEvent) => {
      const isModifier = event.metaKey || event.ctrlKey
      if (!isModifier) return
      if (event.shiftKey || event.altKey) return
      if (event.key !== 'l' && event.key !== 'L') return
      if (isTextEntryTarget(event.target)) return
      event.preventDefault()
      openPicker()
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [agents.length, agentsLoaded, disableGlobalShortcut, healthy, openPicker])

  const handlePickerKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (filteredAgents.length === 0) {
        if (event.key === 'Escape') {
          setPickerOpen(false)
        }
        return
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setHighlight((current) => (current + 1) % filteredAgents.length)
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setHighlight((current) => (current - 1 + filteredAgents.length) % filteredAgents.length)
      } else if (event.key === 'Enter') {
        event.preventDefault()
        const target = filteredAgents[highlight] ?? filteredAgents[0]
        if (target) handleSelectAgent(target)
      } else if (event.key === 'Escape') {
        setPickerOpen(false)
      }
    },
    [filteredAgents, handleSelectAgent, highlight],
  )

  const triggerLabel = t('ai_assistant.launcher.triggerAriaLabel', 'Open AI assistant')
  const dialogTitle = t('ai_assistant.launcher.dialogTitle', 'AI assistants')
  const dialogDescription = t(
    'ai_assistant.launcher.dialogDescription',
    'Pick an assistant. Use ↑/↓ to navigate, Enter to launch, Esc to close.',
  )
  const placeholder = t('ai_assistant.launcher.searchPlaceholder', 'Search assistants...')
  const emptyText = t('ai_assistant.launcher.empty', 'No assistants match your search.')
  const noneText = t(
    'ai_assistant.launcher.none',
    'No assistants are available for your account.',
  )
  const writesBadge = t('ai_assistant.launcher.writesBadge', 'Can write')

  const launcherSuggestions = React.useMemo<AiChatSuggestion[]>(
    () => {
      const generic: AiChatSuggestion[] = [
        {
          label: t('ai_assistant.launcher.welcome.suggestion1', 'What can you help me with?'),
          prompt: 'What can you help me with on this tenant?',
          icon: <Sparkles className="size-4" />,
        },
        {
          label: t('ai_assistant.launcher.welcome.suggestion2', 'Show what data you can access'),
          prompt: 'Describe the data you can read for this tenant — entities, fields, and limits.',
          icon: <Bot className="size-4" />,
        },
        {
          label: t('ai_assistant.launcher.welcome.suggestion3', 'Suggest things to try'),
          prompt:
            'Suggest five concrete questions I could ask you that would surface useful insights for this tenant.',
          icon: <Lightbulb className="size-4" />,
        },
        {
          label: t('ai_assistant.launcher.welcome.suggestion4', 'How do I use this assistant?'),
          prompt:
            'Walk me through how to use this assistant: when to ask, what tools you call, and how confirmations work.',
          icon: <HelpCircle className="size-4" />,
        },
      ]
      // Agent-specific entry-points. The launcher is the only chat surface
      // that's page-agnostic, so we tailor suggestions per active agent
      // here instead of embedding hard-coded prompts in every per-page
      // widget. Catalog agents get the dynamic-UI-part demo prompt that
      // surfaces the inline `catalog.stats-card`.
      const isCatalog =
        activeAgent?.id === 'catalog.catalog_assistant' ||
        activeAgent?.id === 'catalog.merchandising_assistant' ||
        activeAgent?.moduleId === 'catalog'
      if (isCatalog) {
        return [
          {
            label: t(
              'ai_assistant.launcher.welcome.catalogStats',
              'Show catalog overview',
            ),
            prompt: 'Show me a quick catalog overview using the stats card.',
            icon: <Boxes className="size-4" />,
          },
          ...generic,
        ]
      }
      return generic
    },
    [t, activeAgent],
  )

  // The launcher is page-agnostic — it has no record-level context to pin.
  // Context chips render only when records are actually attached (selection,
  // file uploads, etc.); a chip showing just the agent's name is redundant
  // because the agent is already named in the dialog/dock header.
  const launcherContextItems = React.useMemo<AiChatContextItem[]>(() => [], [])

  // Hide the launcher entirely when no agents are accessible. We deliberately
  // keep the SSR shell empty rather than rendering a disabled button —
  // operators should not see a dead AI control. Visibility is driven by the
  // agents endpoint alone: an empty list is the authoritative "no AI here"
  // signal, and the health check is purely advisory (a flaky health endpoint
  // on refresh used to leave this trigger permanently hidden).
  // Treat `healthy === false` (an explicit `{ healthy: false }` body) as a
  // hard veto so we still hide when the runtime explicitly opts out, but
  // unknown / pending health does NOT block the agents fetch result.
  const shouldRender =
    healthy !== false &&
    aiConfigured !== false &&
    agentsLoaded &&
    agents.length > 0

  if (!shouldRender) return null

  const shortLabel = t('ai_assistant.launcher.triggerLabel', 'AI')

  return (
    <>
      {/* Desktop: rounded rectangle pill matching the global-search trigger
          (variant=ghost, size=sm, icon + label + ⌘L kbd hint). */}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={openPicker}
        className={cn('hidden sm:inline-flex items-center gap-2', className)}
        data-ai-launcher-trigger=""
        aria-label={triggerLabel}
        title={triggerLabel}
      >
        <Sparkles className="size-4" aria-hidden />
        <span>{shortLabel}</span>
        <span className="ml-2 rounded border px-1 text-xs text-muted-foreground">
          ⌘L
        </span>
      </Button>
      {/* Mobile fallback: icon-only button — same pattern as global search. */}
      <IconButton
        type="button"
        variant="ghost"
        size="sm"
        className="sm:hidden"
        onClick={openPicker}
        aria-label={triggerLabel}
        data-ai-launcher-trigger-mobile=""
      >
        <Sparkles className="size-4" aria-hidden />
      </IconButton>
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent
          className="sm:max-w-lg p-0 gap-0 overflow-hidden"
          data-ai-launcher-picker=""
          onKeyDown={handlePickerKeyDown}
        >
          <DialogHeader className="px-4 pt-4 pb-2">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Sparkles className="size-4 text-primary" aria-hidden />
              {dialogTitle}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {dialogDescription}
            </DialogDescription>
          </DialogHeader>
          <div className="border-y border-border bg-muted/30 px-3 py-2">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <input
                autoFocus
                type="text"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setHighlight(0)
                }}
                placeholder={placeholder}
                className="w-full rounded-md border border-input bg-background px-8 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                data-ai-launcher-search-input=""
              />
            </div>
          </div>
          <div
            className="max-h-80 overflow-y-auto py-1"
            data-ai-launcher-list=""
            role="listbox"
            aria-label={dialogTitle}
          >
            {filteredAgents.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                {agents.length === 0 ? noneText : emptyText}
              </div>
            ) : (
              filteredAgents.map((agent, index) => {
                const isActive = index === highlight
                const writes = isMutationCapable(agent.mutationPolicy)
                return (
                  <button
                    key={agent.id}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    onMouseEnter={() => setHighlight(index)}
                    onClick={() => handleSelectAgent(agent)}
                    data-ai-launcher-agent-id={agent.id}
                    data-active={isActive ? 'true' : 'false'}
                    className={cn(
                      'flex w-full items-start gap-3 px-3 py-2 text-left text-sm transition-colors',
                      isActive ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
                    )}
                  >
                    <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Sparkles className="size-3.5" aria-hidden />
                    </span>
                    <span className="flex-1 min-w-0 space-y-0.5">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-medium leading-tight">
                          {agent.label}
                        </span>
                        <span
                          className="inline-flex items-center rounded-full border border-border bg-secondary px-1.5 py-0 text-[10px] font-medium uppercase tracking-wide text-secondary-foreground"
                          data-ai-beta-chip=""
                        >
                          {t('ai_assistant.chat.betaChip', 'beta')}
                        </span>
                        {writes ? (
                          <span
                            className="inline-flex items-center rounded-full border border-border bg-secondary px-1.5 py-0 text-[10px] font-medium text-secondary-foreground"
                            data-ai-launcher-writes=""
                          >
                            {writesBadge}
                          </span>
                        ) : null}
                      </span>
                      {agent.description ? (
                        <span className="block truncate text-xs text-muted-foreground">
                          {agent.description}
                        </span>
                      ) : null}
                      <span className="block truncate font-mono text-[10px] text-muted-foreground/80">
                        {agent.id}
                      </span>
                    </span>
                  </button>
                )
              })
            )}
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-2">
              <KbdShortcut keys={['↑', '↓']} />{' '}
              {t('ai_assistant.launcher.hint.navigate', 'Navigate')}
              <span className="mx-1 text-border">·</span>
              <Kbd>Enter</Kbd> {t('ai_assistant.launcher.hint.launch', 'Launch')}
              <span className="mx-1 text-border">·</span>
              <Kbd>Esc</Kbd> {t('ai_assistant.launcher.hint.close', 'Close')}
            </span>
            <span className="hidden sm:inline-flex items-center gap-1">
              <KbdShortcut keys={['⌘', 'L']} />
            </span>
          </div>
          {agentsError ? (
            <div
              className="border-t border-status-error-border bg-status-error-bg px-3 py-1.5 text-[11px] text-status-error-foreground"
              data-ai-launcher-error=""
            >
              <Loader2 className="mr-1 inline size-3 animate-spin" aria-hidden />
              {agentsError}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog open={chatOpen} onOpenChange={setChatOpen}>
        <DialogContent
          className={cn(
            // Mobile: full-screen sheet (matches per-page assistant
            // triggers). Desktop (≥sm): right-anchored side sheet so the
            // chat doesn't appear randomly cropped or off-center.
            // The Dialog primitive applies a centering transform at the
            // sm breakpoint (`sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2
            // sm:-translate-y-1/2 sm:inset-auto`); each piece must be
            // overridden at the same breakpoint or the panel renders half
            // off the viewport on the left.
            'top-0 left-0 right-0 bottom-0 translate-x-0 translate-y-0 max-w-none w-screen h-svh max-h-svh rounded-none',
            'sm:top-0 sm:bottom-0 sm:right-0 sm:left-auto sm:translate-x-0 sm:translate-y-0',
            'sm:max-w-xl sm:w-[36rem] sm:rounded-l-2xl sm:h-screen sm:max-h-screen',
            'flex flex-col gap-3 p-4 z-[70]',
          )}
          data-ai-launcher-sheet=""
        >
          <DialogHeader>
            <div className="flex items-center gap-3 pr-8">
              {/* Dock button on the LEFT to avoid colliding with the
                  Dialog primitive's auto-rendered X close button in the
                  top-right corner. Desktop-only — the side dock panel
                  itself is hidden on mobile. */}
              <IconButton
                type="button"
                variant="ghost"
                size="sm"
                aria-label={t('ai_assistant.launcher.sheet.dock', 'Dock to side')}
                title={t('ai_assistant.launcher.sheet.dock', 'Dock to side')}
                onClick={() => {
                  if (!activeAgent) return
                  dock.dock({
                    agent: activeAgent.id,
                    label: activeAgent.label,
                    description:
                      activeAgent.moduleId ??
                      t('ai_assistant.launcher.dock.subtitle', 'AI assistant'),
                    pageContext: {},
                    placeholder: t(
                      'ai_assistant.launcher.composerPlaceholder',
                      'Ask anything…',
                    ),
                    suggestions: launcherSuggestions,
                    contextItems: launcherContextItems,
                    welcomeTitle: activeAgent.label,
                    welcomeDescription:
                      activeAgent.description ??
                      t(
                        'ai_assistant.launcher.welcome.fallback',
                        'How can I help?',
                      ),
                  })
                  setChatOpen(false)
                }}
                data-ai-launcher-dock=""
                className="hidden lg:inline-flex shrink-0"
              >
                <PanelRightOpen className="size-4" aria-hidden />
              </IconButton>
              <DialogTitle className="flex-1 min-w-0 flex items-center gap-2">
                <Sparkles className="size-4 text-primary shrink-0" aria-hidden />
                <span className="min-w-0 truncate">{activeAgent?.label ?? dialogTitle}</span>
                <span
                  className="inline-flex shrink-0 items-center rounded-full border border-border bg-secondary px-1.5 py-0 text-[10px] font-medium uppercase tracking-wide text-secondary-foreground"
                  data-ai-beta-chip=""
                >
                  {t('ai_assistant.chat.betaChip', 'beta')}
                </span>
              </DialogTitle>
            </div>
            {activeAgent?.description ? (
              <DialogDescription>{activeAgent.description}</DialogDescription>
            ) : null}
          </DialogHeader>
          {activeAgent ? (
            <LauncherChatBody
              activeAgent={activeAgent}
              suggestions={launcherSuggestions}
              contextItems={launcherContextItems}
              welcomeFallback={t(
                'ai_assistant.launcher.welcome.fallback',
                'How can I help?',
              )}
              placeholder={t(
                'ai_assistant.launcher.composerPlaceholder',
                'Ask anything…',
              )}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}

interface LauncherChatBodyProps {
  activeAgent: AiAssistantLauncherAgent
  suggestions: AiChatSuggestion[]
  contextItems: AiChatContextItem[]
  welcomeFallback: string
  placeholder: string
}

function LauncherChatBody({
  activeAgent,
  suggestions,
  contextItems,
  welcomeFallback,
  placeholder,
}: LauncherChatBodyProps) {
  const sessions = useAiChatSessions()
  const session = sessions.getActiveSession(activeAgent.id)

  React.useEffect(() => {
    if (!session) sessions.ensureSession(activeAgent.id)
  }, [activeAgent.id, session, sessions])

  return (
    <>
      <ChatPaneTabs agentId={activeAgent.id} className="border-b" />
      <div className="min-h-0 flex-1" data-ai-launcher-chat-container="">
        {session ? (
          <React.Suspense fallback={null}>
            <LazyAiChat
              key={session.id}
              agent={activeAgent.id}
              conversationId={session.conversationId}
              pageContext={{}}
              className="h-full"
              placeholder={placeholder}
              suggestions={suggestions}
              contextItems={contextItems}
              welcomeTitle={activeAgent.label}
              welcomeDescription={activeAgent.description ?? welcomeFallback}
            />
          </React.Suspense>
        ) : null}
      </div>
    </>
  )
}

export default AiAssistantLauncher
