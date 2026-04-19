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
import { Sparkles } from 'lucide-react'
import { AiChat } from '@open-mercato/ui/ai/AiChat'
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
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className={cn(
            'sm:max-w-xl sm:top-0 sm:bottom-0 sm:right-0 sm:left-auto sm:translate-x-0 sm:translate-y-0',
            'sm:h-screen sm:max-h-screen sm:rounded-none sm:rounded-l-2xl',
            'flex flex-col gap-3 p-4',
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
              {t(
                'catalog.merchandising_assistant.sheet.description',
                'Read-only demo. Proposes descriptions, attributes, titles, and price adjustments for the current selection. No writes are applied in this phase.',
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
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default MerchandisingAssistantSheet
