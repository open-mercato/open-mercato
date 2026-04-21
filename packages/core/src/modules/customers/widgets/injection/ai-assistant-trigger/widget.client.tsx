"use client"

/**
 * Step 4.10 — Backend AiChat injection widget (client).
 *
 * Renders a toolbar-style trigger button in the DataTable header
 * injection spot (`data-table:customers.people.list:header`). Clicking
 * the trigger opens a right-side sheet embedding `<AiChat>` wired to
 * the `customers.account_assistant` read-only agent.
 *
 * `pageContext` shape matches spec §10.1 (view / recordType / recordId
 * / extra). The host DataTable provides selection + total information
 * through the `context` prop injected by `<InjectionSpot>`; the widget
 * gracefully degrades to zeros when the host doesn't forward those
 * fields (e.g., legacy DataTable callers).
 *
 * The widget is intentionally self-contained: the page is NOT modified.
 * Third-party modules wanting the same pattern copy this widget + the
 * `injection-table.ts` mapping.
 */

import * as React from 'react'
import { Building2, Handshake, Search, Sparkles, Users } from 'lucide-react'
import { AiChat, type AiChatSuggestion, type AiChatContextItem } from '@open-mercato/ui/ai/AiChat'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
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

/**
 * Exposed for unit tests so the `buildPageContext` derivation is
 * exercisable without mounting the widget.
 */
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

export default function AiAssistantTriggerWidget({ context }: AiAssistantTriggerProps) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const pageContext = React.useMemo(() => buildPageContext(context), [context])

  const selectedCount = pageContext.extra.selectedCount
  const hasSelection = selectedCount > 0
  const suggestions = useCustomerSuggestions(hasSelection, selectedCount)
  const contextItems = useCustomerContextItems(pageContext)

  const handleClick = React.useCallback(() => {
    setOpen(true)
  }, [])

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleClick}
        data-ai-customers-inject-trigger=""
        aria-label={t(
          'customers.ai_assistant.trigger.ariaLabel',
          'Open AI assistant for people',
        )}
      >
        <Sparkles className="size-4" aria-hidden />
        <span>{t('customers.ai_assistant.trigger.label', 'Ask AI')}</span>
        {hasSelection ? (
          <span className="ml-1 inline-flex items-center justify-center rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground">
            {selectedCount}
          </span>
        ) : null}
      </Button>
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
              agent={CUSTOMERS_AI_INJECT_AGENT_ID}
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
