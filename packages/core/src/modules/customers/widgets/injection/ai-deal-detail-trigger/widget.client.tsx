"use client"

/**
 * Step 5.15 — Backend AiChat injection widget for the deal detail page.
 *
 * Mirrors the Step 4.10 People-list trigger, but targets a record-level
 * surface: the deal detail page's header injection spot
 * (`detail:customers.deal:header`). The page is NOT modified beyond
 * adding the shared `<InjectionSpot>` mount point.
 *
 * `pageContext` shape (spec §10.1):
 *
 *   { view: 'customers.deal.detail',
 *     recordType: 'deal',
 *     recordId: <dealId>,
 *     extra: { stage: string | null, pipelineStageId: string | null } }
 *
 * The agent is `customers.account_assistant`, feature-gated at the widget
 * metadata layer behind `customers.deals.view` + `ai_assistant.view`.
 * The read-only agent serves information requests today; when the tenant
 * opts into Step 5.4's mutation-policy override, the agent unlocks the
 * Step 5.13 `customers.update_deal_stage` tool behind the pending-action
 * contract.
 */

import * as React from 'react'
import { AiIcon } from '@open-mercato/ui/ai/AiIcon'
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

export const CUSTOMERS_AI_DEAL_DETAIL_AGENT_ID = 'customers.account_assistant'

export interface CustomersAiDealDetailPageContext {
  view: 'customers.deal.detail'
  recordType: 'deal'
  recordId: string
  extra: {
    stage: string | null
    pipelineStageId: string | null
  }
}

interface HostInjectionContext {
  dealId?: string
  recordId?: string
  stage?: string | null
  pipelineStageId?: string | null
  data?: {
    deal?: {
      id?: string
      status?: string | null
      pipelineStage?: string | null
      pipelineStageId?: string | null
    }
  }
}

interface AiDealDetailTriggerProps {
  context?: HostInjectionContext
  data?: HostInjectionContext['data']
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function buildPageContext(
  context: HostInjectionContext | undefined,
  data: HostInjectionContext['data'] | undefined,
): CustomersAiDealDetailPageContext | null {
  const dealRecord = data?.deal ?? context?.data?.deal
  const dealId =
    readString(context?.dealId) ??
    readString(context?.recordId) ??
    readString(dealRecord?.id) ??
    null
  if (!dealId) return null
  const stage =
    readString(context?.stage) ??
    readString(dealRecord?.status) ??
    readString(dealRecord?.pipelineStage) ??
    null
  const pipelineStageId =
    readString(context?.pipelineStageId) ??
    readString(dealRecord?.pipelineStageId) ??
    null
  return {
    view: 'customers.deal.detail',
    recordType: 'deal',
    recordId: dealId,
    extra: { stage, pipelineStageId },
  }
}

/**
 * Exposed for unit tests so the page-context derivation is exercisable
 * without mounting the widget.
 */
export function computeCustomersAiDealDetailPageContext(
  context: HostInjectionContext | undefined,
  data?: HostInjectionContext['data'],
): CustomersAiDealDetailPageContext | null {
  return buildPageContext(context, data)
}

export default function AiDealDetailTriggerWidget({ context, data }: AiDealDetailTriggerProps) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const pageContext = React.useMemo(() => buildPageContext(context, data), [context, data])
  const handleClick = React.useCallback(() => {
    setOpen(true)
  }, [])

  if (!pageContext) return null

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleClick}
        data-ai-customers-deal-trigger=""
        data-ai-customers-deal-id={pageContext.recordId}
        aria-label={t(
          'customers.ai_assistant.dealDetail.trigger.ariaLabel',
          'Open AI assistant for this deal',
        )}
      >
        <AiIcon className="size-4" />
        <span>{t('customers.ai_assistant.dealDetail.trigger.label', 'Ask AI')}</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className={cn(
            'sm:max-w-xl sm:top-0 sm:bottom-0 sm:right-0 sm:left-auto sm:translate-x-0 sm:translate-y-0',
            'sm:h-screen sm:max-h-screen sm:rounded-none sm:rounded-l-2xl',
            'flex flex-col gap-3 p-4 z-[70]',
          )}
          data-ai-customers-deal-sheet=""
        >
          <DialogHeader>
            <div className="flex items-center justify-between gap-3">
              <DialogTitle>
                {t(
                  'customers.ai_assistant.dealDetail.sheet.title',
                  'Customers AI assistant — deal',
                )}
              </DialogTitle>
              {pageContext.extra.stage ? (
                <span
                  className="inline-flex items-center rounded-full border border-border bg-secondary px-2 py-0.5 text-xs text-secondary-foreground"
                  data-ai-customers-deal-stage-pill=""
                  data-ai-customers-deal-stage={pageContext.extra.stage}
                >
                  {pageContext.extra.stage}
                </span>
              ) : null}
            </div>
            <DialogDescription>
              {t(
                'customers.ai_assistant.dealDetail.sheet.description',
                'Ask about this deal. With the per-tenant mutation-policy override enabled, the assistant can also propose a stage change that you confirm before anything is saved.',
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1" data-ai-customers-deal-chat-container="">
            <AiChat
              agent={CUSTOMERS_AI_DEAL_DETAIL_AGENT_ID}
              pageContext={pageContext as unknown as Record<string, unknown>}
              className="h-full"
              placeholder={t(
                'customers.ai_assistant.dealDetail.sheet.composerPlaceholder',
                'Ask about this deal, the stage, pipeline...',
              )}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
