"use client"

/**
 * Step 4.10 — Backend AiChat injection widget (client).
 *
 * Renders a compact, round, icon-only trigger in the DataTable
 * `:search-trailing` injection slot (right next to the list search input).
 * Clicking the trigger opens a popover listing the AI agents this widget
 * exposes — currently `customers.account_assistant`, but the popover is
 * the agreed extension point for additional customers-domain agents
 * (selection digesters, deal-shapers, etc.). Picking an agent opens a
 * right-side sheet embedding `<AiChat>` for that agent.
 *
 * `pageContext` shape matches spec §10.1 (view / recordType / recordId
 * / extra). The host DataTable provides selection + total information
 * through the `context` prop injected by `<InjectionSpot>`.
 */

import * as React from 'react'
import { Building2, ChevronDown, Handshake, PanelRightOpen, Search, Sparkles, Users } from 'lucide-react'
import { AiChat, type AiChatSuggestion, type AiChatContextItem } from '@open-mercato/ui/ai/AiChat'
import { useAiDock } from '@open-mercato/ui/ai/AiDock'
import { useAiChatSessions } from '@open-mercato/ui/ai/AiChatSessions'
import { ChatPaneTabs } from '@open-mercato/ui/ai/ChatPaneTabs'
import { Button } from '@open-mercato/ui/primitives/button'
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

export const CUSTOMERS_AI_INJECT_AGENT_ID = 'customers.account_assistant'

export type CustomersAiInjectView = 'customers.people.list' | 'customers.companies.list'

export interface CustomersAiInjectPageContext {
  view: CustomersAiInjectView
  recordType: null
  recordId: string | null
  extra: {
    selectedCount: number
    totalMatching: number
  }
}

export function computeCustomersAiInjectPageContext(
  context: HostInjectionContext | undefined,
): CustomersAiInjectPageContext {
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

interface AiAssistantTriggerProps {
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

function resolveView(tableId: string | null | undefined): CustomersAiInjectView {
  if (typeof tableId === 'string' && tableId.includes('companies')) {
    return 'customers.companies.list'
  }
  return 'customers.people.list'
}

function buildPageContext(context: HostInjectionContext | undefined): CustomersAiInjectPageContext {
  const selectedIdsRaw = Array.isArray(context?.selectedRowIds) ? context?.selectedRowIds ?? [] : []
  const selectedIds = selectedIdsRaw.map(readString).filter((id) => id.length > 0)
  const selectedCount = selectedIds.length > 0
    ? selectedIds.length
    : readNumber(context?.selectedCount)
  const totalMatching = readNumber(context?.totalMatching ?? context?.total ?? context?.rowCount)
  const recordId = selectedIds.length > 0 ? selectedIds.join(',') : null
  return {
    view: resolveView(context?.tableId),
    recordType: null,
    recordId,
    extra: {
      selectedCount,
      totalMatching,
    },
  }
}

function useCustomerSuggestions(
  view: CustomersAiInjectView,
  hasSelection: boolean,
  selectedCount: number,
): AiChatSuggestion[] {
  const t = useT()
  return React.useMemo(() => {
    if (view === 'customers.companies.list') {
      if (hasSelection) {
        return [
          {
            label: t(
              'customers.ai_assistant.suggestions.summarizeSelectedCompanies',
              'Summarize selected companies',
            ),
            prompt: `Give me a summary of my ${selectedCount} selected companies — size, industry, and recent activity`,
            icon: <Building2 className="size-4" />,
          },
          {
            label: t(
              'customers.ai_assistant.suggestions.dealsForSelectedCompanies',
              'Show deals for selected companies',
            ),
            prompt: `Show me all deals associated with my ${selectedCount} selected companies`,
            icon: <Handshake className="size-4" />,
          },
          {
            label: t(
              'customers.ai_assistant.suggestions.peopleAtSelectedCompanies',
              'List people at selected companies',
            ),
            prompt: `List the contacts (people) associated with my ${selectedCount} selected companies`,
            icon: <Users className="size-4" />,
          },
        ]
      }
      return [
        {
          label: t(
            'customers.ai_assistant.suggestions.searchCompanies',
            'Search for a company',
          ),
          prompt: 'Search for companies by name, industry, or tax ID',
          icon: <Search className="size-4" />,
        },
        {
          label: t(
            'customers.ai_assistant.suggestions.topCompaniesByDeals',
            'Top companies by deal value',
          ),
          prompt: 'Show me the companies with the highest open deal value',
          icon: <Handshake className="size-4" />,
        },
        {
          label: t(
            'customers.ai_assistant.suggestions.companiesWithoutContacts',
            'Companies missing contacts',
          ),
          prompt: 'Find companies that have no associated people yet',
          icon: <Users className="size-4" />,
        },
        {
          label: t(
            'customers.ai_assistant.suggestions.companiesActivityOverview',
            'Activity overview',
          ),
          prompt: 'Give me an overview of recent company-level activities and interactions',
          icon: <Building2 className="size-4" />,
        },
      ]
    }
    if (hasSelection) {
      return [
        {
          label: t('customers.ai_assistant.suggestions.summarizeSelected', 'Summarize selected contacts'),
          prompt: `Give me a summary of my ${selectedCount} selected contacts — key details and recent activity`,
          icon: <Users className="size-4" />,
        },
        {
          label: t('customers.ai_assistant.suggestions.findDeals', 'Show deals for selected people'),
          prompt: `Show me all deals associated with my ${selectedCount} selected contacts`,
          icon: <Handshake className="size-4" />,
        },
        {
          label: t('customers.ai_assistant.suggestions.findCompanies', 'Find related companies'),
          prompt: `Find companies related to my ${selectedCount} selected contacts`,
          icon: <Building2 className="size-4" />,
        },
      ]
    }
    return [
      {
        label: t('customers.ai_assistant.suggestions.searchPeople', 'Search for a contact'),
        prompt: 'Search for contacts by name, email, or company',
        icon: <Search className="size-4" />,
      },
      {
        label: t('customers.ai_assistant.suggestions.recentDeals', 'Show recent deals'),
        prompt: 'Show me the most recent deals and their current stages',
        icon: <Handshake className="size-4" />,
      },
      {
        label: t('customers.ai_assistant.suggestions.topCompanies', 'List top companies'),
        prompt: 'List companies with the most associated contacts and deals',
        icon: <Building2 className="size-4" />,
      },
      {
        label: t('customers.ai_assistant.suggestions.activityOverview', 'Activity overview'),
        prompt: 'Give me an overview of recent customer activities and interactions',
        icon: <Users className="size-4" />,
      },
    ]
  }, [view, hasSelection, selectedCount, t])
}

function useCustomerContextItems(pageContext: CustomersAiInjectPageContext): AiChatContextItem[] {
  const t = useT()
  return React.useMemo(() => {
    const items: AiChatContextItem[] = []
    const { selectedCount, totalMatching } = pageContext.extra
    const isCompanies = pageContext.view === 'customers.companies.list'
    if (selectedCount > 0) {
      const key = isCompanies
        ? 'customers.ai_assistant.context.selectedCompanies'
        : 'customers.ai_assistant.context.selectedPeople'
      const fallback = isCompanies ? '{count} companies selected' : '{count} contacts selected'
      items.push({ label: t(key, fallback).replace('{count}', String(selectedCount)) })
    } else if (totalMatching > 0) {
      const key = isCompanies
        ? 'customers.ai_assistant.context.matchingCompanies'
        : 'customers.ai_assistant.context.matchingPeople'
      const fallback = isCompanies ? '{count} companies in view' : '{count} contacts in view'
      items.push({ label: t(key, fallback).replace('{count}', String(totalMatching)) })
    }
    return items
  }, [pageContext, t])
}

interface CustomerAgentDescriptor {
  id: string
  label: string
  description: string
  icon: React.ReactNode
}

function useCustomerAgents(): CustomerAgentDescriptor[] {
  const t = useT()
  return React.useMemo(
    () => [
      {
        id: CUSTOMERS_AI_INJECT_AGENT_ID,
        label: t('customers.ai_assistant.agents.account.label', 'CRM Assistant'),
        description: t(
          'customers.ai_assistant.agents.account.description',
          'Explore people, companies, deals, and activities.',
        ),
        icon: <Sparkles className="size-4" />,
      },
    ],
    [t],
  )
}

export default function AiAssistantTriggerWidget({ context }: AiAssistantTriggerProps) {
  const t = useT()
  const dock = useAiDock()
  const [open, setOpen] = React.useState(false)
  const [popoverOpen, setPopoverOpen] = React.useState(false)
  const [activeAgent, setActiveAgent] = React.useState<string>(CUSTOMERS_AI_INJECT_AGENT_ID)
  const [lastAgent, setLastAgent] = React.useState<string | null>(null)
  const pageContext = React.useMemo(() => buildPageContext(context), [context])
  const agents = useCustomerAgents()

  const selectedCount = pageContext.extra.selectedCount
  const hasSelection = selectedCount > 0
  const suggestions = useCustomerSuggestions(pageContext.view, hasSelection, selectedCount)
  const contextItems = useCustomerContextItems(pageContext)

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
    if (lastAgent && agents.some((a) => a.id === lastAgent)) {
      openAgent(lastAgent)
      return
    }
    setPopoverOpen(true)
  }, [agents, lastAgent, openAgent])

  const handleDock = React.useCallback(() => {
    const agent = agents.find((a) => a.id === activeAgent) ?? agents[0]
    if (!agent) return
    dock.dock({
      agent: agent.id,
      label: agent.label,
      description: t('customers.ai_assistant.dock.subtitle', 'Customers'),
      pageContext: pageContext as unknown as Record<string, unknown>,
      placeholder: t(
        'customers.ai_assistant.sheet.composerPlaceholder',
        'Ask about people, companies, deals...',
      ),
      suggestions,
      contextItems,
      welcomeTitle: t('customers.ai_assistant.sheet.welcomeTitle', 'CRM Assistant'),
      welcomeDescription: hasSelection
        ? t(
            'customers.ai_assistant.sheet.welcomeDescriptionSelection',
            'Ready to explore your {count} selected contacts:',
          ).replace('{count}', String(selectedCount))
        : t(
            'customers.ai_assistant.sheet.welcomeDescriptionAll',
            'Ask me anything about your customers, companies, and deals:',
          ),
    })
    setOpen(false)
  }, [
    activeAgent,
    agents,
    contextItems,
    dock,
    hasSelection,
    pageContext,
    selectedCount,
    suggestions,
    t,
  ])

  const triggerLabel = t(
    'customers.ai_assistant.trigger.ariaLabel',
    'Open AI assistant for people',
  )

  const labelText = t('customers.ai_assistant.trigger.label', 'AI')
  const moreAgentsLabel = t(
    'customers.ai_assistant.trigger.moreAgentsAriaLabel',
    'Choose an AI assistant',
  )

  return (
    <>
      <div className="inline-flex items-center">
        <Button
          type="button"
          variant="outline"
          onClick={handleMainTriggerClick}
          data-ai-customers-inject-trigger=""
          aria-label={triggerLabel}
          title={triggerLabel}
          className={cn(
            'relative',
            agents.length > 1 && 'rounded-r-none border-r-0',
          )}
        >
          <Sparkles className="size-4" aria-hidden />
          <span>{labelText}</span>
          {hasSelection ? (
            <span
              className="absolute -top-1 -right-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium leading-none text-primary-foreground"
              data-ai-customers-inject-selected-count={selectedCount}
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
                size="lg"
                aria-label={moreAgentsLabel}
                title={moreAgentsLabel}
                className="rounded-l-none"
                data-ai-customers-inject-picker=""
              >
                <ChevronDown className="size-4" aria-hidden />
              </IconButton>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-1">
              <div className="px-3 pt-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('customers.ai_assistant.popover.heading', 'AI assistants')}
              </div>
              <div className="flex flex-col gap-0.5">
                {agents.map((agent) => (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => handleSelectAgent(agent.id)}
                    data-ai-customers-inject-agent-option={agent.id}
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
      </div>
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
            'sm:max-w-xl sm:w-[36rem] sm:rounded-l-2xl sm:h-screen sm:max-h-screen',
            'flex flex-col gap-3 p-4 z-[70]',
          )}
          data-ai-customers-inject-sheet=""
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
                aria-label={t('customers.ai_assistant.sheet.dock', 'Dock to side')}
                title={t('customers.ai_assistant.sheet.dock', 'Dock to side')}
                onClick={handleDock}
                data-ai-customers-inject-dock=""
                className="hidden lg:inline-flex shrink-0"
              >
                <PanelRightOpen className="size-4" aria-hidden />
              </IconButton>
              <DialogTitle className="flex-1 min-w-0 truncate">
                {t('customers.ai_assistant.sheet.title', 'Customers AI assistant')}
              </DialogTitle>
              {hasSelection ? (
                <span
                  className="shrink-0 inline-flex items-center rounded-full border border-border bg-secondary px-2 py-0.5 text-xs text-secondary-foreground"
                  data-ai-customers-inject-selection-pill=""
                  data-ai-customers-inject-selected-count={selectedCount}
                >
                  {t(
                    'customers.ai_assistant.sheet.selectionPill',
                    'Acting on {count} selected',
                  ).replace('{count}', String(selectedCount))}
                </span>
              ) : null}
            </div>
            <DialogDescription>
              {hasSelection
                ? t(
                    'customers.ai_assistant.sheet.descriptionWithSelection',
                    'Working with {count} selected contacts. Ask about their details, deals, companies, and activities.',
                  ).replace('{count}', String(selectedCount))
                : t(
                    'customers.ai_assistant.sheet.description',
                    'Your CRM assistant. Ask about people, companies, deals, and activities.',
                  )}
            </DialogDescription>
          </DialogHeader>
          <CustomersChatBody
            activeAgent={activeAgent}
            pageContext={pageContext}
            suggestions={suggestions}
            contextItems={contextItems}
            hasSelection={hasSelection}
            selectedCount={selectedCount}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}

interface CustomersChatBodyProps {
  activeAgent: string
  pageContext: CustomersAiInjectPageContext
  suggestions: AiChatSuggestion[]
  contextItems: AiChatContextItem[]
  hasSelection: boolean
  selectedCount: number
}

function CustomersChatBody({
  activeAgent,
  pageContext,
  suggestions,
  contextItems,
  hasSelection,
  selectedCount,
}: CustomersChatBodyProps) {
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
      <div className="min-h-0 flex-1" data-ai-customers-inject-chat-container="">
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
              'customers.ai_assistant.sheet.composerPlaceholder',
              'Ask about people, companies, deals...',
            )}
            suggestions={suggestions}
            contextItems={contextItems}
            welcomeTitle={t('customers.ai_assistant.sheet.welcomeTitle', 'CRM Assistant')}
            welcomeDescription={
              hasSelection
                ? t(
                    'customers.ai_assistant.sheet.welcomeDescriptionSelection',
                    'Ready to explore your {count} selected contacts:',
                  ).replace('{count}', String(selectedCount))
                : t(
                    'customers.ai_assistant.sheet.welcomeDescriptionAll',
                    'Ask me anything about your customers, companies, and deals:',
                  )
            }
          />
        ) : null}
      </div>
    </>
  )
}
