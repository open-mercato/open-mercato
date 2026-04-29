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
import { Building2, Handshake, Search, Sparkles, Users } from 'lucide-react'
import { AiChat, type AiChatSuggestion, type AiChatContextItem } from '@open-mercato/ui/ai/AiChat'
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

export interface CustomersAiInjectPageContext {
  view: 'customers.people.list'
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

function buildPageContext(context: HostInjectionContext | undefined): CustomersAiInjectPageContext {
  const selectedIdsRaw = Array.isArray(context?.selectedRowIds) ? context?.selectedRowIds ?? [] : []
  const selectedIds = selectedIdsRaw.map(readString).filter((id) => id.length > 0)
  const selectedCount = selectedIds.length > 0
    ? selectedIds.length
    : readNumber(context?.selectedCount)
  const totalMatching = readNumber(context?.totalMatching ?? context?.total ?? context?.rowCount)
  const recordId = selectedIds.length > 0 ? selectedIds.join(',') : null
  return {
    view: 'customers.people.list',
    recordType: null,
    recordId,
    extra: {
      selectedCount,
      totalMatching,
    },
  }
}

function useCustomerSuggestions(hasSelection: boolean, selectedCount: number): AiChatSuggestion[] {
  const t = useT()
  return React.useMemo(() => {
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
  }, [hasSelection, selectedCount, t])
}

function useCustomerContextItems(pageContext: CustomersAiInjectPageContext): AiChatContextItem[] {
  const t = useT()
  return React.useMemo(() => {
    const items: AiChatContextItem[] = []
    const { selectedCount, totalMatching } = pageContext.extra
    if (selectedCount > 0) {
      items.push({
        label: t('customers.ai_assistant.context.selectedPeople', '{count} contacts selected').replace(
          '{count}',
          String(selectedCount),
        ),
      })
    } else if (totalMatching > 0) {
      items.push({
        label: t('customers.ai_assistant.context.matchingPeople', '{count} contacts in view').replace(
          '{count}',
          String(totalMatching),
        ),
      })
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
  const [open, setOpen] = React.useState(false)
  const [popoverOpen, setPopoverOpen] = React.useState(false)
  const [activeAgent, setActiveAgent] = React.useState<string>(CUSTOMERS_AI_INJECT_AGENT_ID)
  const pageContext = React.useMemo(() => buildPageContext(context), [context])
  const agents = useCustomerAgents()

  const selectedCount = pageContext.extra.selectedCount
  const hasSelection = selectedCount > 0
  const suggestions = useCustomerSuggestions(hasSelection, selectedCount)
  const contextItems = useCustomerContextItems(pageContext)

  const handleSelectAgent = React.useCallback((agentId: string) => {
    setActiveAgent(agentId)
    setPopoverOpen(false)
    setOpen(true)
  }, [])

  const triggerLabel = t(
    'customers.ai_assistant.trigger.ariaLabel',
    'Open AI assistant for people',
  )

  return (
    <>
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <IconButton
            type="button"
            variant="outline"
            size="lg"
            fullRadius
            data-ai-customers-inject-trigger=""
            aria-label={triggerLabel}
            title={triggerLabel}
            className="relative"
          >
            <Sparkles className="size-4" aria-hidden />
            {hasSelection ? (
              <span
                className="absolute -top-1 -right-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium leading-none text-primary-foreground"
                data-ai-customers-inject-selected-count={selectedCount}
              >
                {selectedCount}
              </span>
            ) : null}
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
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className={cn(
            'sm:max-w-xl sm:top-0 sm:bottom-0 sm:right-0 sm:left-auto sm:translate-x-0 sm:translate-y-0',
            'sm:h-screen sm:max-h-screen sm:rounded-none sm:rounded-l-2xl',
            'flex flex-col gap-3 p-4 z-[70]',
          )}
          data-ai-customers-inject-sheet=""
        >
          <DialogHeader>
            <div className="flex items-center justify-between gap-3">
              <DialogTitle>
                {t('customers.ai_assistant.sheet.title', 'Customers AI assistant')}
              </DialogTitle>
              {hasSelection ? (
                <span
                  className="inline-flex items-center rounded-full border border-border bg-secondary px-2 py-0.5 text-xs text-secondary-foreground"
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
          <div className="min-h-0 flex-1" data-ai-customers-inject-chat-container="">
            <AiChat
              agent={activeAgent}
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
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
