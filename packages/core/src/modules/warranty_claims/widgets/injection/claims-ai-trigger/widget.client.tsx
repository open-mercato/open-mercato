"use client"

/**
 * Claims list AiChat injection widget (client).
 *
 * Mirrors the customers `ai-assistant-trigger` widget: a compact trigger in
 * the DataTable `:search-trailing` injection slot (right next to the claims
 * list search input). Clicking the trigger opens a right-side sheet
 * embedding `<AiChat>` for the `warranty_claims.claims_assistant` agent —
 * the same agent used on the claim detail page. When more claims-domain
 * agents are added, the popover picker becomes the extension point.
 *
 * `pageContext` shape matches spec §10.1 (view / recordType / recordId /
 * extra). The host DataTable provides selection + total information through
 * the `context` prop injected by `<InjectionSpot>`.
 */

import * as React from 'react'
import { ChevronDown, Clock, ListChecks, MessageSquare, PanelRightOpen, Search } from 'lucide-react'
import { AiChat, type AiChatSuggestion, type AiChatContextItem } from '@open-mercato/ui/ai/AiChat'
import { AiIcon } from '@open-mercato/ui/ai/AiIcon'
import { useAiDock } from '@open-mercato/ui/ai/AiDock'
import { useAiChatSessions } from '@open-mercato/ui/ai/AiChatSessions'
import { ChatPaneTabs } from '@open-mercato/ui/ai/ChatPaneTabs'
import { Button } from '@open-mercato/ui/primitives/button'
import { ButtonGroup } from '@open-mercato/ui/primitives/button-group'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'

export const WARRANTY_CLAIMS_AI_INJECT_AGENT_ID = 'warranty_claims.claims_assistant'

export const WARRANTY_CLAIMS_AI_INJECT_VIEW = 'warranty_claims.claims.list'

export interface WarrantyClaimsAiInjectPageContext {
  view: typeof WARRANTY_CLAIMS_AI_INJECT_VIEW
  recordType: null
  recordId: string | null
  extra: {
    selectedCount: number
    totalMatching: number
  }
}

export function computeWarrantyClaimsAiInjectPageContext(
  context: HostInjectionContext | undefined,
): WarrantyClaimsAiInjectPageContext {
  return buildPageContext(context)
}

interface HostInjectionContext {
  tableId?: string | null
  title?: string
  selectedRowIds?: string[]
  selectedCount?: number
  total?: number
  totalMatching?: number
  rowCount?: number
}

interface ClaimsAiTriggerProps {
  context?: HostInjectionContext
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function buildPageContext(context: HostInjectionContext | undefined): WarrantyClaimsAiInjectPageContext {
  const selectedIdsRaw = Array.isArray(context?.selectedRowIds) ? context?.selectedRowIds ?? [] : []
  const selectedIds = selectedIdsRaw.map(readString).filter((id) => id.length > 0)
  const selectedCount = selectedIds.length > 0
    ? selectedIds.length
    : readNumber(context?.selectedCount)
  const totalMatching = readNumber(context?.totalMatching ?? context?.total ?? context?.rowCount)
  const recordId = selectedIds.length > 0 ? selectedIds.join(',') : null
  return {
    view: WARRANTY_CLAIMS_AI_INJECT_VIEW,
    recordType: null,
    recordId,
    extra: {
      selectedCount,
      totalMatching,
    },
  }
}

function useClaimsSuggestions(hasSelection: boolean, selectedCount: number): AiChatSuggestion[] {
  const t = useT()
  return React.useMemo(() => {
    if (hasSelection) {
      return [
        {
          label: t(
            'warranty_claims.ai_assistant.suggestions.summarizeSelected',
            'Summarize selected claims',
          ),
          prompt: `Give me a summary of my ${selectedCount} selected claims — status, SLA, and next step`,
          icon: <ListChecks className="size-4" />,
        },
        {
          label: t(
            'warranty_claims.ai_assistant.suggestions.triageSelected',
            'Suggest triage for selected',
          ),
          prompt: `Suggest triage for my ${selectedCount} selected claims: eligibility, dispositions, and priority`,
          icon: <MessageSquare className="size-4" />,
        },
        {
          label: t(
            'warranty_claims.ai_assistant.suggestions.nextActionsSelected',
            'Next actions for selected',
          ),
          prompt: `What is the next recommended action for each of my ${selectedCount} selected claims?`,
          icon: <Clock className="size-4" />,
        },
      ]
    }
    return [
      {
        label: t('warranty_claims.ai_assistant.suggestions.overdueClaims', 'Overdue claims'),
        prompt: 'Which open claims are overdue or at risk of missing their SLA?',
        icon: <Clock className="size-4" />,
      },
      {
        label: t('warranty_claims.ai_assistant.suggestions.summarizeQueue', 'Summarize the queue'),
        prompt: 'Summarize the current warranty claims queue by status and priority',
        icon: <ListChecks className="size-4" />,
      },
      {
        label: t('warranty_claims.ai_assistant.suggestions.awaitingReply', 'Claims awaiting a reply'),
        prompt: 'Which claims are waiting on a staff reply to the customer?',
        icon: <MessageSquare className="size-4" />,
      },
      {
        label: t('warranty_claims.ai_assistant.suggestions.searchClaims', 'Find a claim'),
        prompt: 'Search for a claim by claim number, customer, or product',
        icon: <Search className="size-4" />,
      },
    ]
  }, [hasSelection, selectedCount, t])
}

function useClaimsContextItems(pageContext: WarrantyClaimsAiInjectPageContext): AiChatContextItem[] {
  const t = useT()
  return React.useMemo(() => {
    const items: AiChatContextItem[] = []
    const { selectedCount, totalMatching } = pageContext.extra
    if (selectedCount > 0) {
      items.push({
        label: t('warranty_claims.ai_assistant.context.selectedClaims', '{count} claims selected')
          .replace('{count}', String(selectedCount)),
      })
    } else if (totalMatching > 0) {
      items.push({
        label: t('warranty_claims.ai_assistant.context.matchingClaims', '{count} claims in view')
          .replace('{count}', String(totalMatching)),
      })
    }
    return items
  }, [pageContext, t])
}

interface ViewCopy {
  welcomeDescriptionAll: string
  welcomeDescriptionSelection: string
  descriptionWithSelection: string
  triggerAriaLabel: string
}

function useViewCopy(selectedCount: number): ViewCopy {
  const t = useT()
  return React.useMemo(() => {
    const replaceCount = (value: string) => value.replace('{count}', String(selectedCount))
    return {
      welcomeDescriptionAll: t(
        'warranty_claims.ai_assistant.sheet.welcomeDescriptionAll',
        'Ask me anything about your warranty claims queue:',
      ),
      welcomeDescriptionSelection: replaceCount(
        t(
          'warranty_claims.ai_assistant.sheet.welcomeDescriptionSelection',
          'Ready to explore your {count} selected claims:',
        ),
      ),
      descriptionWithSelection: replaceCount(
        t(
          'warranty_claims.ai_assistant.sheet.descriptionWithSelection',
          'Working with {count} selected claims. Ask about their status, SLA, and next steps.',
        ),
      ),
      triggerAriaLabel: t(
        'warranty_claims.ai_assistant.trigger.ariaLabel',
        'Open AI assistant for warranty claims',
      ),
    }
  }, [selectedCount, t])
}

interface ClaimsAgentDescriptor {
  id: string
  label: string
  description: string
  icon: React.ReactNode
}

function useClaimsAgents(): ClaimsAgentDescriptor[] {
  const t = useT()
  return React.useMemo(
    () => [
      {
        id: WARRANTY_CLAIMS_AI_INJECT_AGENT_ID,
        label: t('warranty_claims.ai_assistant.agents.claims.label', 'Claims Assistant'),
        description: t(
          'warranty_claims.ai_assistant.agents.claims.description',
          'Triage claims, check entitlement, and draft replies.',
        ),
        icon: <AiIcon className="size-4" />,
      },
    ],
    [t],
  )
}

export default function ClaimsAiTriggerWidget({ context }: ClaimsAiTriggerProps) {
  const t = useT()
  const dock = useAiDock()
  const [open, setOpen] = React.useState(false)
  const [popoverOpen, setPopoverOpen] = React.useState(false)
  const [activeAgent, setActiveAgent] = React.useState<string>(WARRANTY_CLAIMS_AI_INJECT_AGENT_ID)
  const [lastAgent, setLastAgent] = React.useState<string | null>(null)
  const pageContext = React.useMemo(() => buildPageContext(context), [context])
  const agents = useClaimsAgents()

  const selectedCount = pageContext.extra.selectedCount
  const hasSelection = selectedCount > 0
  const suggestions = useClaimsSuggestions(hasSelection, selectedCount)
  const contextItems = useClaimsContextItems(pageContext)
  const viewCopy = useViewCopy(selectedCount)

  const openAgent = React.useCallback((agentId: string) => {
    setActiveAgent(agentId)
    setLastAgent(agentId)
    setPopoverOpen(false)
    if (dock.state.assistant?.agent === agentId) {
      dock.dock(dock.state.assistant)
      setOpen(false)
      return
    }
    setOpen(true)
  }, [dock])

  const handleSelectAgent = React.useCallback((agentId: string) => {
    openAgent(agentId)
  }, [openAgent])

  const handleMainTriggerClick = React.useCallback(() => {
    if (agents.length === 1) {
      openAgent(agents[0].id)
      return
    }
    if (lastAgent && agents.some((agent) => agent.id === lastAgent)) {
      openAgent(lastAgent)
      return
    }
    setPopoverOpen(true)
  }, [agents, lastAgent, openAgent])

  const handleDock = React.useCallback(() => {
    const agent = agents.find((entry) => entry.id === activeAgent) ?? agents[0]
    if (!agent) return
    dock.dock({
      agent: agent.id,
      label: agent.label,
      description: t('warranty_claims.ai_assistant.dock.subtitle', 'Warranty claims'),
      pageContext: pageContext as unknown as Record<string, unknown>,
      placeholder: t(
        'warranty_claims.ai_assistant.sheet.composerPlaceholder',
        'Ask about claims, SLAs, entitlement...',
      ),
      suggestions,
      contextItems,
      welcomeTitle: t('warranty_claims.ai_assistant.sheet.welcomeTitle', 'Claims Assistant'),
      welcomeDescription: hasSelection
        ? viewCopy.welcomeDescriptionSelection
        : viewCopy.welcomeDescriptionAll,
    })
    setOpen(false)
  }, [
    activeAgent,
    agents,
    contextItems,
    dock,
    hasSelection,
    pageContext,
    suggestions,
    t,
    viewCopy,
  ])

  const triggerLabel = viewCopy.triggerAriaLabel

  const labelText = t('warranty_claims.ai_assistant.trigger.label', 'AI')
  const moreAgentsLabel = t(
    'warranty_claims.ai_assistant.trigger.moreAgentsAriaLabel',
    'Choose an AI assistant',
  )

  return (
    <>
      <ButtonGroup>
        <Button
          type="button"
          variant="outline"
          onClick={handleMainTriggerClick}
          data-ai-warranty-claims-inject-trigger=""
          aria-label={triggerLabel}
          title={triggerLabel}
          className={cn('relative', 'hover:bg-brand-violet/10')}
        >
          <AiIcon className="size-4" />
          <span>{labelText}</span>
          {hasSelection ? (
            <span
              className="absolute -top-1 -right-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-xs font-medium leading-none text-primary-foreground"
              data-ai-warranty-claims-inject-selected-count={selectedCount}
            >
              {selectedCount}
            </span>
          ) : null}
        </Button>
        {agents.length > 1 ? (
          <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            <PopoverTrigger asChild>
              <IconButton
                type="button"
                variant="outline"
                aria-label={moreAgentsLabel}
                title={moreAgentsLabel}
                data-ai-warranty-claims-inject-picker=""
              >
                <ChevronDown className="size-4" aria-hidden />
              </IconButton>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-1">
              <div className="px-3 pt-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('warranty_claims.ai_assistant.popover.heading', 'AI assistants')}
              </div>
              <div className="flex flex-col gap-0.5">
                {agents.map((agent) => (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => handleSelectAgent(agent.id)}
                    data-ai-warranty-claims-inject-agent-option={agent.id}
                    className="flex items-start gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-none"
                  >
                    <span className="mt-0.5 inline-flex size-6 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
                      {agent.icon}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block font-medium leading-tight">{agent.label}</span>
                      <span className="block text-xs text-muted-foreground leading-snug">
                        {agent.description}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        ) : null}
      </ButtonGroup>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className={cn(
            // Mobile: full-screen sheet (no rounded corners, fills the
            // viewport). Desktop (≥sm): right-anchored side sheet.
            // The Dialog primitive ships a centering transform at the sm
            // breakpoint (`sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2
            // sm:-translate-y-1/2 sm:inset-auto`); each must be overridden
            // at the same `sm:` breakpoint or the panel renders half off
            // the viewport.
            'top-0 left-0 right-0 bottom-0 translate-x-0 translate-y-0 max-w-none w-screen h-svh max-h-svh rounded-none',
            'sm:top-0 sm:bottom-0 sm:right-0 sm:left-auto sm:translate-x-0 sm:translate-y-0',
            'sm:max-w-xl sm:w-full sm:rounded-l-xl sm:h-screen sm:max-h-screen',
            'flex flex-col gap-3 p-4 z-banner',
          )}
          data-ai-warranty-claims-inject-sheet=""
        >
          <DialogHeader>
            <div className="flex items-center gap-3 pr-8">
              {/* Dock button lives on the LEFT — the Dialog primitive
                  auto-renders an X close button absolutely positioned in
                  the top-right corner, so anything we drop in the header's
                  right side visually collides with it. Mobile hides the
                  dock entirely (the side panel is desktop-only). */}
              <IconButton
                type="button"
                variant="ghost"
                size="sm"
                aria-label={t('warranty_claims.ai_assistant.sheet.dock', 'Dock to side')}
                title={t('warranty_claims.ai_assistant.sheet.dock', 'Dock to side')}
                onClick={handleDock}
                data-ai-warranty-claims-inject-dock=""
                className="hidden lg:inline-flex shrink-0"
              >
                <PanelRightOpen className="size-4" aria-hidden />
              </IconButton>
              <DialogTitle className="flex-1 min-w-0 truncate">
                {t('warranty_claims.ai_assistant.sheet.title', 'Claims AI assistant')}
              </DialogTitle>
              {hasSelection ? (
                <span
                  className="shrink-0 inline-flex items-center rounded-full border border-border bg-secondary px-2 py-0.5 text-xs text-secondary-foreground"
                  data-ai-warranty-claims-inject-selection-pill=""
                  data-ai-warranty-claims-inject-selected-count={selectedCount}
                >
                  {t(
                    'warranty_claims.ai_assistant.sheet.selectionPill',
                    'Acting on {count} selected',
                  ).replace('{count}', String(selectedCount))}
                </span>
              ) : null}
            </div>
            <DialogDescription>
              {hasSelection
                ? viewCopy.descriptionWithSelection
                : t(
                    'warranty_claims.ai_assistant.sheet.description',
                    'Your claims desk copilot. Ask about claims, SLAs, entitlement, and next steps.',
                  )}
            </DialogDescription>
          </DialogHeader>
          <ClaimsChatBody
            activeAgent={activeAgent}
            pageContext={pageContext}
            suggestions={suggestions}
            contextItems={contextItems}
            hasSelection={hasSelection}
            viewCopy={viewCopy}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}

interface ClaimsChatBodyProps {
  activeAgent: string
  pageContext: WarrantyClaimsAiInjectPageContext
  suggestions: AiChatSuggestion[]
  contextItems: AiChatContextItem[]
  hasSelection: boolean
  viewCopy: ViewCopy
}

function ClaimsChatBody({
  activeAgent,
  pageContext,
  suggestions,
  contextItems,
  hasSelection,
  viewCopy,
}: ClaimsChatBodyProps) {
  const t = useT()
  const sessions = useAiChatSessions()
  const session = sessions.getActiveSession(activeAgent)

  // Lazily ensure an open session exists. Running `ensureSession` inside an
  // effect (not inline during render) keeps the provider's setState calls
  // outside of the render phase. The first frame may render without a
  // session — that's fine, we render the tab strip alone until the next
  // tick when the new session is committed and `getActiveSession` returns it.
  React.useEffect(() => {
    if (!session) sessions.ensureSession(activeAgent)
  }, [activeAgent, session, sessions])

  return (
    <>
      <ChatPaneTabs agentId={activeAgent} className="border-b" />
      <div className="min-h-0 flex-1" data-ai-warranty-claims-inject-chat-container="">
        {session ? (
          <AiChat
            // `key` forces a fresh mount when the active tab changes so the
            // AI SDK's status doesn't leak across sessions.
            key={session.id}
            agent={activeAgent}
            conversationId={session.conversationId}
            pageContext={pageContext as unknown as Record<string, unknown>}
            className="h-full"
            placeholder={t(
              'warranty_claims.ai_assistant.sheet.composerPlaceholder',
              'Ask about claims, SLAs, entitlement...',
            )}
            suggestions={suggestions}
            contextItems={contextItems}
            welcomeTitle={t('warranty_claims.ai_assistant.sheet.welcomeTitle', 'Claims Assistant')}
            welcomeDescription={
              hasSelection
                ? viewCopy.welcomeDescriptionSelection
                : viewCopy.welcomeDescriptionAll
            }
          />
        ) : null}
      </div>
    </>
  )
}
