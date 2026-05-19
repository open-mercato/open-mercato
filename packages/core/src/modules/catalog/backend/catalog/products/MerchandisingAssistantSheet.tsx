"use client"

/**
 * MerchandisingAssistantSheet — Step 4.9 (Spec §10 D18).
 *
 * Embeds `<AiChat agent="catalog.merchandising_assistant" pageContext={...} />`
 * in a right-side sheet (built on the shared Dialog primitive because
 * `packages/ui` does not ship a dedicated Sheet/Drawer primitive in
 * Phase 2). The trigger is a button rendered in the products-list page
 * header.
 *
 * Phase 2 is strictly read-only: the sheet shows proposals (structured
 * output), but the mutation tools (`catalog.update_product`,
 * `catalog.bulk_update_products`, `catalog.apply_attribute_extraction`,
 * `catalog.update_product_media_descriptions`) are intentionally NOT in
 * the agent whitelist. Phase 5.14 introduces those via the pending-action
 * contract.
 *
 * pageContext follows spec §10.1 exactly:
 *
 *   {
 *     view: 'catalog.products.list',
 *     recordType: null,
 *     recordId: string,                      // "" or comma-separated UUIDs
 *     extra: {
 *       filter: { categoryId, priceRange, tags, status },
 *       totalMatching: number,
 *       selectedCount: number,
 *     }
 *   }
 */

import * as React from 'react'
import { Boxes, ChevronDown, FileText, Package, PanelRightOpen, PenLine, Tags, TrendingUp } from 'lucide-react'
import { AiChat, type AiChatSuggestion, type AiChatContextItem } from '@open-mercato/ui/ai/AiChat'
import { AiIcon } from '@open-mercato/ui/ai/AiIcon'
import { useAiDock } from '@open-mercato/ui/ai/AiDock'
import { useAiChatSessions } from '@open-mercato/ui/ai/AiChatSessions'
import { ChatPaneTabs } from '@open-mercato/ui/ai/ChatPaneTabs'
// Side-effect import: registers the `catalog.stats-card` UI part on the
// global registry the first time this client bundle loads. Tools that
// emit `{ uiPart: { componentId: 'catalog.stats-card' } }` envelopes
// (catalog.show_stats today; user-defined tools tomorrow) automatically
// resolve to the card without dispatcher changes.
import '../../../components/CatalogStatsCard'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
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

export interface MerchandisingPageContextFilter {
  categoryId: string | null
  priceRange: { min?: number; max?: number } | null
  tags: string[]
  status: string | null
}

export interface MerchandisingPageContext {
  view: 'catalog.products.list'
  entityType?: 'catalog.products.list'
  recordType: null
  recordId: string
  extra: {
    filter: MerchandisingPageContextFilter
    totalMatching: number
    selectedCount: number
  }
}

export interface MerchandisingAssistantSheetProps {
  /** Selection-aware page context, built by the products list host. */
  pageContext: MerchandisingPageContext
  /** When false (feature-gated by the host), the sheet renders nothing. */
  enabled?: boolean
  className?: string
}

export const MERCHANDISING_AGENT_ID = 'catalog.merchandising_assistant'

function useMerchandisingSuggestions(
  hasSelection: boolean,
  selectedCount: number,
): AiChatSuggestion[] {
  const t = useT()
  return React.useMemo(() => {
    if (hasSelection) {
      return [
        {
          label: t(
            'catalog.merchandising_assistant.suggestions.draftDescriptions',
            'Draft product descriptions for selected items',
          ),
          prompt: `Draft compelling product descriptions for my ${selectedCount} selected products`,
          icon: <PenLine className="size-4" />,
        },
        {
          label: t(
            'catalog.merchandising_assistant.suggestions.extractAttributes',
            'Extract attributes from descriptions',
          ),
          prompt: `Extract structured attributes from the descriptions of my ${selectedCount} selected products`,
          icon: <Tags className="size-4" />,
        },
        {
          label: t(
            'catalog.merchandising_assistant.suggestions.titleVariants',
            'Generate title variants for SEO',
          ),
          prompt: `Generate SEO-optimized title variants for my ${selectedCount} selected products`,
          icon: <FileText className="size-4" />,
        },
        {
          label: t(
            'catalog.merchandising_assistant.suggestions.priceAdjustments',
            'Suggest price adjustments',
          ),
          prompt: `Analyze and suggest price adjustments for my ${selectedCount} selected products`,
          icon: <TrendingUp className="size-4" />,
        },
      ]
    }
    return [
      {
        label: t(
          'catalog.merchandising_assistant.suggestions.showStats',
          'Show catalog overview',
        ),
        // Triggers the `catalog.show_stats` tool, which returns the inline
        // catalog-stats UI part (live counts of products, active products,
        // categories, tags). Demo entry-point for the dynamic UI-part path.
        prompt: 'Show me a quick catalog overview using the stats card.',
        icon: <Boxes className="size-4" />,
      },
      {
        label: t(
          'catalog.merchandising_assistant.suggestions.browseProducts',
          'Show me an overview of my product catalog',
        ),
        prompt: 'Give me an overview of my product catalog — categories, total products, and pricing ranges',
        icon: <Package className="size-4" />,
      },
      {
        label: t(
          'catalog.merchandising_assistant.suggestions.findMissingDescriptions',
          'Find products with missing descriptions',
        ),
        prompt: 'Find products that are missing descriptions or have very short descriptions',
        icon: <PenLine className="size-4" />,
      },
      {
        label: t(
          'catalog.merchandising_assistant.suggestions.analyzeAttributes',
          'Analyze attribute coverage',
        ),
        prompt: 'Analyze which products have incomplete attribute data',
        icon: <Tags className="size-4" />,
      },
      {
        label: t(
          'catalog.merchandising_assistant.suggestions.pricingOverview',
          'Show pricing distribution',
        ),
        prompt: 'Show me the pricing distribution across categories',
        icon: <TrendingUp className="size-4" />,
      },
    ]
  }, [hasSelection, selectedCount, t])
}

function useContextItems(pageContext: MerchandisingPageContext): AiChatContextItem[] {
  const t = useT()
  return React.useMemo(() => {
    const items: AiChatContextItem[] = []
    const { selectedCount, totalMatching, filter } = pageContext.extra
    if (selectedCount > 0) {
      items.push({
        label: t(
          'catalog.merchandising_assistant.context.selectedProducts',
          '{count} products selected',
        ).replace('{count}', String(selectedCount)),
      })
    } else if (totalMatching > 0) {
      items.push({
        label: t(
          'catalog.merchandising_assistant.context.matchingProducts',
          '{count} products in view',
        ).replace('{count}', String(totalMatching)),
      })
    }
    if (filter.categoryId) {
      items.push({
        label: t('catalog.merchandising_assistant.context.filteredByCategory', 'Filtered by category'),
        detail: filter.categoryId,
      })
    }
    if (filter.status) {
      items.push({ label: filter.status })
    }
    if (filter.tags.length > 0) {
      items.push({
        label: t('catalog.merchandising_assistant.context.tags', '{count} tags').replace(
          '{count}',
          String(filter.tags.length),
        ),
      })
    }
    return items
  }, [pageContext, t])
}

interface MerchandisingAgentDescriptor {
  id: string
  label: string
  description: string
  icon: React.ReactNode
}

interface AgentsResponse {
  agents?: Array<{
    id?: string | null
  }>
}

interface MerchandisingAgentsState {
  agents: MerchandisingAgentDescriptor[]
  loaded: boolean
}

function useMerchandisingAgents(): MerchandisingAgentsState {
  const t = useT()
  const [accessibleAgentIds, setAccessibleAgentIds] = React.useState<Set<string> | null>(null)
  const declaredAgents = React.useMemo(
    () => [
      {
        id: MERCHANDISING_AGENT_ID,
        label: t(
          'catalog.merchandising_assistant.agents.merchandising.label',
          'Merchandising Assistant',
        ),
        description: t(
          'catalog.merchandising_assistant.agents.merchandising.description',
          'Draft copy, normalize attributes, and propose price changes for the current selection.',
        ),
        icon: <AiIcon className="size-4" />,
      },
    ],
    [t],
  )

  React.useEffect(() => {
    let cancelled = false
    apiCall<AgentsResponse>('/api/ai_assistant/ai/agents', {
      credentials: 'same-origin',
      headers: { 'x-om-forbidden-redirect': '0', 'x-om-unauthorized-redirect': '0' },
    })
      .then((call) => {
        if (cancelled) return
        if (!call.ok || !call.result || !Array.isArray(call.result.agents)) {
          setAccessibleAgentIds(new Set())
          return
        }
        setAccessibleAgentIds(
          new Set(
            call.result.agents
              .map((agent) => agent?.id)
              .filter((id): id is string => typeof id === 'string' && id.length > 0),
          ),
        )
      })
      .catch(() => {
        if (!cancelled) setAccessibleAgentIds(new Set())
      })
    return () => {
      cancelled = true
    }
  }, [])

  return React.useMemo(
    () => ({
      agents:
        accessibleAgentIds === null
          ? []
          : declaredAgents.filter((agent) => accessibleAgentIds.has(agent.id)),
      loaded: accessibleAgentIds !== null,
    }),
    [accessibleAgentIds, declaredAgents],
  )
}

export function MerchandisingAssistantSheet({
  pageContext,
  enabled = true,
  className,
}: MerchandisingAssistantSheetProps): React.ReactElement | null {
  const t = useT()
  const dock = useAiDock()
  const [open, setOpen] = React.useState(false)
  const [popoverOpen, setPopoverOpen] = React.useState(false)
  const [activeAgent, setActiveAgent] = React.useState<string>(MERCHANDISING_AGENT_ID)
  const [lastAgent, setLastAgent] = React.useState<string | null>(null)

  const selectedCount = pageContext.extra.selectedCount
  const hasSelection = selectedCount > 0
  const suggestions = useMerchandisingSuggestions(hasSelection, selectedCount)
  const contextItems = useContextItems(pageContext)
  const { agents, loaded: agentsLoaded } = useMerchandisingAgents()

  if (!enabled || !agentsLoaded || agents.length === 0) return null

  const openAgent = (agentId: string) => {
    setActiveAgent(agentId)
    setLastAgent(agentId)
    setPopoverOpen(false)
    if (dock.state.assistant?.agent === agentId) {
      dock.dock(dock.state.assistant)
      setOpen(false)
      return
    }
    setOpen(true)
  }

  const handleSelectAgent = (agentId: string) => {
    openAgent(agentId)
  }

  const handleMainTriggerClick = () => {
    if (agents.length === 1) {
      openAgent(agents[0].id)
      return
    }
    if (lastAgent && agents.some((a) => a.id === lastAgent)) {
      openAgent(lastAgent)
      return
    }
    setPopoverOpen(true)
  }

  const handleDock = () => {
    const agent = agents.find((a) => a.id === activeAgent) ?? agents[0]
    if (!agent) return
    dock.dock({
      agent: agent.id,
      label: agent.label,
      description: t('catalog.merchandising_assistant.dock.subtitle', 'Catalog'),
      pageContext: pageContext as unknown as Record<string, unknown>,
      placeholder: t(
        'catalog.merchandising_assistant.sheet.composerPlaceholder',
        'Ask for descriptions, attributes, titles, or price ideas...',
      ),
      suggestions,
      contextItems,
      welcomeTitle: t(
        'catalog.merchandising_assistant.sheet.welcomeTitle',
        'Merchandising Assistant',
      ),
      welcomeDescription: hasSelection
        ? t(
            'catalog.merchandising_assistant.sheet.welcomeDescriptionSelection',
            'Ready to work with your {count} selected products. Try one of these:',
          ).replace('{count}', String(selectedCount))
        : t(
            'catalog.merchandising_assistant.sheet.welcomeDescriptionAll',
            'Select products for targeted actions, or explore your catalog:',
          ),
    })
    setOpen(false)
  }

  const triggerLabel = t(
    'catalog.merchandising_assistant.trigger.ariaLabel',
    'Open AI merchandising assistant',
  )
  const labelText = t('catalog.merchandising_assistant.trigger.label', 'AI')
  const moreAgentsLabel = t(
    'catalog.merchandising_assistant.trigger.moreAgentsAriaLabel',
    'Choose an AI assistant',
  )

  return (
    <>
      <div className={cn('inline-flex items-center', className)}>
        <Button
          type="button"
          variant="outline"
          onClick={handleMainTriggerClick}
          data-ai-merchandising-trigger=""
          aria-label={triggerLabel}
          title={triggerLabel}
          className={cn(
            'relative',
            agents.length > 1 && 'rounded-r-none border-r-0',
          )}
        >
          <AiIcon className="size-4" />
          <span>{labelText}</span>
          {hasSelection ? (
            <span
              className="absolute -top-1 -right-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium leading-none text-primary-foreground"
              data-ai-merchandising-selected-count={selectedCount}
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
                data-ai-merchandising-picker=""
              >
                <ChevronDown className="size-4" aria-hidden />
              </IconButton>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-1">
              <div className="px-3 pt-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('catalog.merchandising_assistant.popover.heading', 'AI assistants')}
              </div>
              <div className="flex flex-col gap-0.5">
                {agents.map((agent) => (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => handleSelectAgent(agent.id)}
                    data-ai-merchandising-agent-option={agent.id}
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
            // Mobile: full-screen sheet. Desktop (≥sm): right-anchored side sheet.
            // The Dialog primitive applies a centering transform at the
            // sm breakpoint; each piece (`top`, `left`, transform, inset)
            // must be overridden at the same breakpoint or the panel
            // renders half off the viewport.
            'top-0 left-0 right-0 bottom-0 translate-x-0 translate-y-0 max-w-none w-screen h-svh max-h-svh rounded-none',
            'sm:top-0 sm:bottom-0 sm:right-0 sm:left-auto sm:translate-x-0 sm:translate-y-0',
            'sm:max-w-xl sm:w-[36rem] sm:rounded-l-2xl sm:h-screen sm:max-h-screen',
            'flex flex-col gap-3 p-4 z-[70]',
          )}
          data-ai-merchandising-sheet=""
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
                aria-label={t('catalog.merchandising_assistant.sheet.dock', 'Dock to side')}
                title={t('catalog.merchandising_assistant.sheet.dock', 'Dock to side')}
                onClick={handleDock}
                data-ai-merchandising-dock=""
                className="hidden lg:inline-flex shrink-0"
              >
                <PanelRightOpen className="size-4" aria-hidden />
              </IconButton>
              <DialogTitle className="flex-1 min-w-0 truncate">
                {t('catalog.merchandising_assistant.sheet.title', 'Catalog merchandising assistant')}
              </DialogTitle>
              {hasSelection ? (
                <span
                  className="shrink-0 inline-flex items-center rounded-full border border-border bg-secondary px-2 py-0.5 text-xs text-secondary-foreground"
                  data-ai-merchandising-selection-pill=""
                  data-ai-merchandising-selected-count={selectedCount}
                >
                  {t(
                    'catalog.merchandising_assistant.sheet.selectionPill',
                    'Acting on {count} products',
                  ).replace('{count}', String(selectedCount))}
                </span>
              ) : null}
            </div>
            <DialogDescription>
              {hasSelection
                ? t(
                    'catalog.merchandising_assistant.sheet.descriptionWithSelection',
                    'Working with {count} selected products. Ask for descriptions, attribute extraction, title suggestions, or pricing analysis.',
                  ).replace('{count}', String(selectedCount))
                : t(
                    'catalog.merchandising_assistant.sheet.description',
                    'Your AI merchandising copilot. Select products from the list for targeted actions, or explore your full catalog.',
                  )}
            </DialogDescription>
          </DialogHeader>
          <MerchandisingChatBody
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

interface MerchandisingChatBodyProps {
  activeAgent: string
  pageContext: MerchandisingPageContext
  suggestions: AiChatSuggestion[]
  contextItems: AiChatContextItem[]
  hasSelection: boolean
  selectedCount: number
}

function MerchandisingChatBody({
  activeAgent,
  pageContext,
  suggestions,
  contextItems,
  hasSelection,
  selectedCount,
}: MerchandisingChatBodyProps) {
  const t = useT()
  const sessions = useAiChatSessions()
  const session = sessions.getActiveSession(activeAgent)

  React.useEffect(() => {
    if (!session) sessions.ensureSession(activeAgent)
  }, [activeAgent, session, sessions])

  return (
    <>
      <ChatPaneTabs agentId={activeAgent} className="border-b" />
      <div className="min-h-0 flex-1" data-ai-merchandising-chat-container="">
        {session ? (
          <AiChat
            key={session.id}
            agent={activeAgent}
            conversationId={session.conversationId}
            pageContext={pageContext as unknown as Record<string, unknown>}
            className="h-full"
            placeholder={t(
              'catalog.merchandising_assistant.sheet.composerPlaceholder',
              'Ask for descriptions, attributes, titles, or price ideas...',
            )}
            suggestions={suggestions}
            contextItems={contextItems}
            welcomeTitle={t(
              'catalog.merchandising_assistant.sheet.welcomeTitle',
              'Merchandising Assistant',
            )}
            welcomeDescription={
              hasSelection
                ? t(
                    'catalog.merchandising_assistant.sheet.welcomeDescriptionSelection',
                    'Ready to work with your {count} selected products. Try one of these:',
                  ).replace('{count}', String(selectedCount))
                : t(
                    'catalog.merchandising_assistant.sheet.welcomeDescriptionAll',
                    'Select products for targeted actions, or explore your catalog:',
                  )
            }
          />
        ) : null}
      </div>
    </>
  )
}

export default MerchandisingAssistantSheet
