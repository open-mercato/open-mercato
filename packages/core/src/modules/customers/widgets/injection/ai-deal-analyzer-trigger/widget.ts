import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import DealAnalyzerTriggerWidget from './widget.client'

/**
 * Step d4 — Deal Analyzer AiChat injection widget.
 *
 * Drops the `ai-deal-analyzer-trigger` widget into the Deals list DataTable
 * `:search-trailing` injection slot, rendering adjacent to the search input.
 *
 * The trigger opens a right-side sheet embedding
 * `<AiChat agent="customers.deal_analyzer" pageContext={...} />`.
 *
 * `pageContext` follows spec §10.1 shape:
 *   { view: 'customers.deals.list',
 *     recordType: null,
 *     recordId: string,             // "" or comma-separated selected deal UUIDs
 *     extra: { selectedCount, totalMatching } }
 *
 * Feature-gated behind `customers.deals.view` + `ai_assistant.view`.
 */
const widget: InjectionWidgetModule<Record<string, unknown>, Record<string, unknown>> = {
  metadata: {
    id: 'customers.injection.ai-deal-analyzer-trigger',
    title: 'Deal Analyzer Trigger',
    description:
      'Renders an AI button in the deals list search-trailing slot that opens a sheet embedding the deal analyzer agent.',
    features: ['customers.deals.view', 'ai_assistant.view'],
    priority: 90,
    enabled: true,
  },
  Widget: DealAnalyzerTriggerWidget,
}

export default widget
