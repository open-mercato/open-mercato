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
import { FileText, Package, PenLine, Sparkles, Tags, TrendingUp } from 'lucide-react'
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

export function MerchandisingAssistantSheet({
  pageContext,
  enabled = true,
  className,
}: MerchandisingAssistantSheetProps): React.ReactElement | null {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  if (!enabled) return null

  const selectedCount = pageContext.extra.selectedCount
  const hasSelection = selectedCount > 0
  const suggestions = useMerchandisingSuggestions(hasSelection, selectedCount)
  const contextItems = useContextItems(pageContext)

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        data-ai-merchandising-trigger=""
        aria-label={t(
          'catalog.merchandising_assistant.trigger.ariaLabel',
          'Open AI merchandising assistant',
        )}
        className={className}
      >
        <Sparkles className="size-4" aria-hidden />
        <span>{t('catalog.merchandising_assistant.trigger.label', 'AI Merchandising')}</span>
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
          data-ai-merchandising-sheet=""
        >
          <DialogHeader>
            <div className="flex items-center justify-between gap-3">
              <DialogTitle>
                {t('catalog.merchandising_assistant.sheet.title', 'Catalog merchandising assistant')}
              </DialogTitle>
              {hasSelection ? (
                <span
                  className="inline-flex items-center rounded-full border border-border bg-secondary px-2 py-0.5 text-xs text-secondary-foreground"
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
          <div className="min-h-0 flex-1" data-ai-merchandising-chat-container="">
            <AiChat
              agent={MERCHANDISING_AGENT_ID}
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
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default MerchandisingAssistantSheet
