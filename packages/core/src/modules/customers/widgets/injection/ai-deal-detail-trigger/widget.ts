import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import AiDealDetailTriggerWidget from './widget.client'

/**
 * Step 5.15 (Phase 3 WS-D) — Customers Deal detail AiChat injection.
 *
 * Extends the Step 4.10 pattern to a record-level surface. Drops an
 * "Ask AI" trigger on the deal detail page (`detail:customers.deal:header`)
 * and opens a sheet embedding
 * `<AiChat agent="customers.account_assistant" pageContext={…} />` with a
 * deal-scoped `pageContext` shape:
 *
 *   { view: 'customers.deal.detail',
 *     recordType: 'deal',
 *     recordId: <dealId>,
 *     extra: { stage, pipelineStageId } }
 *
 * Wires the stable conversation id so the Step 5.13
 * `customers.update_deal_stage` mutation tool's idempotency hash stays
 * constant across repeated confirms / retries within the same chat.
 *
 * Feature-gated behind `customers.deals.view` + `ai_assistant.view`.
 */
const widget: InjectionWidgetModule<Record<string, unknown>, Record<string, unknown>> = {
  metadata: {
    id: 'customers.injection.ai-deal-detail-trigger',
    title: 'Customers AI Deal Detail Trigger',
    description:
      'Renders an "Ask AI" button in the deal detail header that opens a sheet embedding the customers account assistant with deal-scoped page context.',
    features: ['customers.deals.view', 'ai_assistant.view'],
    priority: 100,
    enabled: true,
  },
  Widget: AiDealDetailTriggerWidget,
}

export default widget
