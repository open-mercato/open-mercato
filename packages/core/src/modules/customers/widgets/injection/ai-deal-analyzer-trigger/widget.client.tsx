"use client"

// See /framework/ai-assistant/agents → "Deal Analyzer demo" for the
// pageContext contract (selectedRowIds → recordId comma-list) and the
// loop primitives this widget surfaces.

import * as React from 'react'
import { Handshake, PanelRightOpen, Sparkles, TrendingDown } from 'lucide-react'
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
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'

export const DEAL_ANALYZER_AGENT_ID = 'customers.deal_analyzer'

export interface DealAnalyzerPageContext {
  view: 'customers.deals.list'
  recordType: null
  recordId: string | null
  extra: {
    selectedCount: number
    totalMatching: number
  }
}

interface HostInjectionContext {
  tableId?: string | null
  selectedRowIds?: string[]
  selectedCount?: number
  total?: number
  totalMatching?: number
  rowCount?: number
}

function readNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function buildDealAnalyzerPageContext(context: HostInjectionContext | undefined): DealAnalyzerPageContext {
  const selectedIdsRaw = Array.isArray(context?.selectedRowIds) ? context?.selectedRowIds ?? [] : []
  const selectedIds = selectedIdsRaw.map(readString).filter((id) => id.length > 0)
  const selectedCount = selectedIds.length > 0
    ? selectedIds.length
    : readNumber(context?.selectedCount)
  const totalMatching = readNumber(context?.totalMatching ?? context?.total ?? context?.rowCount)
  const recordId = selectedIds.length > 0 ? selectedIds.join(',') : null
  return {
    view: 'customers.deals.list',
    recordType: null,
    recordId,
    extra: {
      selectedCount,
      totalMatching,
    },
  }
}

function useDealAnalyzerSuggestions(
  hasSelection: boolean,
  selectedCount: number,
): AiChatSuggestion[] {
  const t = useT()
  return React.useMemo(() => {
    if (hasSelection) {
      return [
        {
          label: t(
            'customers.deal_analyzer.suggestions.analyzeSelected',
            'Analyze selected deals',
          ),
          prompt: `Analyze my ${selectedCount} selected deals and surface any that are stalled`,
          icon: <TrendingDown className="size-4" />,
        },
        {
          label: t(
            'customers.deal_analyzer.suggestions.proposeStageMove',
            'Propose stage moves for selected deals',
          ),
          prompt: `Analyze my ${selectedCount} selected deals and propose stage moves for stalled high-value ones`,
          icon: <Handshake className="size-4" />,
        },
      ]
    }
    return [
      {
        label: t(
          'customers.deal_analyzer.suggestions.analyzeStalledDeals',
          'Analyze stalled deals',
        ),
        prompt: 'Analyze stalled deals from the last 30 days and propose a stage move for the highest value one',
        icon: <TrendingDown className="size-4" />,
      },
      {
        label: t(
          'customers.deal_analyzer.suggestions.showAtRiskPipeline',
          'Show at-risk pipeline',
        ),
        prompt: 'Show me deals with no activity in the last 14 days worth more than $5,000',
        icon: <Handshake className="size-4" />,
      },
      {
        label: t(
          'customers.deal_analyzer.suggestions.overviewByStage',
          'Deal health overview',
        ),
        prompt: 'Give me a health overview of all open deals ranked by activity recency',
        icon: <Sparkles className="size-4" />,
      },
    ]
  }, [hasSelection, selectedCount, t])
}

function useDealAnalyzerContextItems(pageContext: DealAnalyzerPageContext): AiChatContextItem[] {
  const t = useT()
  return React.useMemo(() => {
    const items: AiChatContextItem[] = []
    const { selectedCount, totalMatching } = pageContext.extra
    if (selectedCount > 0) {
      items.push({
        label: t(
          'customers.deal_analyzer.context.selectedDeals',
          '{count} deals selected',
        ).replace('{count}', String(selectedCount)),
      })
    } else if (totalMatching > 0) {
      items.push({
        label: t(
          'customers.deal_analyzer.context.dealsInView',
          '{count} deals in view',
        ).replace('{count}', String(totalMatching)),
      })
    }
    return items
  }, [pageContext, t])
}

interface DealAnalyzerTriggerProps {
  context?: HostInjectionContext
}

export default function DealAnalyzerTriggerWidget({ context }: DealAnalyzerTriggerProps) {
  const t = useT()
  const dock = useAiDock()
  const [open, setOpen] = React.useState(false)
  const pageContext = React.useMemo(() => buildDealAnalyzerPageContext(context), [context])

  const selectedCount = pageContext.extra.selectedCount
  const hasSelection = selectedCount > 0
  const suggestions = useDealAnalyzerSuggestions(hasSelection, selectedCount)
  const contextItems = useDealAnalyzerContextItems(pageContext)

  const handleTriggerClick = React.useCallback(() => {
    if (dock.state.assistant?.agent === DEAL_ANALYZER_AGENT_ID) {
      dock.dock(dock.state.assistant)
      setOpen(false)
      return
    }
    setOpen(true)
  }, [dock])

  const handleDock = React.useCallback(() => {
    dock.dock({
      agent: DEAL_ANALYZER_AGENT_ID,
      label: t('customers.deal_analyzer.sheet.title', 'Deal Analyzer'),
      description: t('customers.deal_analyzer.dock.subtitle', 'Deals'),
      pageContext: pageContext as unknown as Record<string, unknown>,
      placeholder: t(
        'customers.deal_analyzer.sheet.composerPlaceholder',
        'Analyze stalled deals, propose stage moves...',
      ),
      suggestions,
      contextItems,
      welcomeTitle: t('customers.deal_analyzer.sheet.welcomeTitle', 'Deal Analyzer'),
      welcomeDescription: hasSelection
        ? t(
            'customers.deal_analyzer.sheet.welcomeDescriptionSelection',
            'Ready to analyze your {count} selected deals:',
          ).replace('{count}', String(selectedCount))
        : t(
            'customers.deal_analyzer.sheet.welcomeDescriptionAll',
            'Analyze deal pipeline health and propose stage moves:',
          ),
    })
    setOpen(false)
  }, [contextItems, dock, hasSelection, pageContext, selectedCount, suggestions, t])

  const triggerLabel = t(
    'customers.deal_analyzer.trigger.ariaLabel',
    'Open Deal Analyzer AI agent',
  )
  const labelText = t('customers.deal_analyzer.trigger.label', 'Analyze')

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={handleTriggerClick}
        data-ai-deal-analyzer-trigger=""
        aria-label={triggerLabel}
        title={triggerLabel}
        className="relative"
      >
        <Sparkles className="size-4" aria-hidden />
        <span>{labelText}</span>
        {hasSelection ? (
          <span
            className="absolute -top-1 -right-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-medium leading-none text-primary-foreground"
            data-ai-deal-analyzer-selected-count={selectedCount}
          >
            {selectedCount}
          </span>
        ) : null}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className={cn(
            'top-0 left-0 right-0 bottom-0 translate-x-0 translate-y-0 max-w-none w-screen h-svh max-h-svh rounded-none',
            'sm:top-0 sm:bottom-0 sm:right-0 sm:left-auto sm:translate-x-0 sm:translate-y-0',
            'sm:max-w-xl sm:w-[36rem] sm:rounded-l-2xl sm:h-screen sm:max-h-screen',
            'flex flex-col gap-3 p-4',
          )}
          data-ai-deal-analyzer-sheet=""
        >
          <DialogHeader>
            <div className="flex items-center gap-3 pr-8">
              <IconButton
                type="button"
                variant="ghost"
                size="sm"
                aria-label={t('customers.deal_analyzer.sheet.dock', 'Dock to side')}
                title={t('customers.deal_analyzer.sheet.dock', 'Dock to side')}
                onClick={handleDock}
                data-ai-deal-analyzer-dock=""
                className="hidden lg:inline-flex shrink-0"
              >
                <PanelRightOpen className="size-4" aria-hidden />
              </IconButton>
              <DialogTitle className="flex-1 min-w-0 truncate">
                {t('customers.deal_analyzer.sheet.title', 'Deal Analyzer')}
              </DialogTitle>
              {hasSelection ? (
                <span
                  className="shrink-0 inline-flex items-center rounded-full border border-border bg-secondary px-2 py-0.5 text-xs text-secondary-foreground"
                  data-ai-deal-analyzer-selection-pill=""
                  data-ai-deal-analyzer-selected-count={selectedCount}
                >
                  {t(
                    'customers.deal_analyzer.sheet.selectionPill',
                    'Acting on {count} deals',
                  ).replace('{count}', String(selectedCount))}
                </span>
              ) : null}
            </div>
            <DialogDescription>
              {hasSelection
                ? t(
                    'customers.deal_analyzer.sheet.descriptionWithSelection',
                    'Analyzing {count} selected deals for pipeline health and stage move proposals.',
                  ).replace('{count}', String(selectedCount))
                : t(
                    'customers.deal_analyzer.sheet.description',
                    'Multi-step deal health analyzer. Surfaces stalled deals and proposes stage transitions for approval.',
                  )}
            </DialogDescription>
          </DialogHeader>
          <DealAnalyzerChatBody
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

interface DealAnalyzerChatBodyProps {
  pageContext: DealAnalyzerPageContext
  suggestions: AiChatSuggestion[]
  contextItems: AiChatContextItem[]
  hasSelection: boolean
  selectedCount: number
}

function DealAnalyzerChatBody({
  pageContext,
  suggestions,
  contextItems,
  hasSelection,
  selectedCount,
}: DealAnalyzerChatBodyProps) {
  const t = useT()
  const sessions = useAiChatSessions()
  const session = sessions.getActiveSession(DEAL_ANALYZER_AGENT_ID)

  React.useEffect(() => {
    if (!session) sessions.ensureSession(DEAL_ANALYZER_AGENT_ID)
  }, [session, sessions])

  return (
    <>
      <ChatPaneTabs agentId={DEAL_ANALYZER_AGENT_ID} className="border-b" />
      <div className="min-h-0 flex-1" data-ai-deal-analyzer-chat-container="">
        {session ? (
          <AiChat
            key={session.id}
            agent={DEAL_ANALYZER_AGENT_ID}
            conversationId={session.conversationId}
            pageContext={pageContext as unknown as Record<string, unknown>}
            className="h-full"
            placeholder={t(
              'customers.deal_analyzer.sheet.composerPlaceholder',
              'Analyze stalled deals, propose stage moves...',
            )}
            suggestions={suggestions}
            contextItems={contextItems}
            welcomeTitle={t('customers.deal_analyzer.sheet.welcomeTitle', 'Deal Analyzer')}
            welcomeDescription={
              hasSelection
                ? t(
                    'customers.deal_analyzer.sheet.welcomeDescriptionSelection',
                    'Ready to analyze your {count} selected deals:',
                  ).replace('{count}', String(selectedCount))
                : t(
                    'customers.deal_analyzer.sheet.welcomeDescriptionAll',
                    'Analyze deal pipeline health and propose stage moves:',
                  )
            }
          />
        ) : null}
      </div>
    </>
  )
}
