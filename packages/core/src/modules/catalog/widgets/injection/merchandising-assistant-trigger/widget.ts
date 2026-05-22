import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import MerchandisingAssistantTriggerWidget from './widget.client'

/**
 * Step 5.15 (Phase 3 WS-D) — Catalog merchandising AiChat injection.
 *
 * Moves the Step 4.9 demo embed behind the widget-injection system so the
 * products-list page no longer hosts the trigger directly. The widget
 * targets `data-table:catalog.products:header` (owned by the shared
 * `DataTable` primitive). The existing `MerchandisingAssistantSheet`
 * component is reused verbatim so the Phase 2 read-only contract is
 * preserved.
 *
 * Feature-gated behind `catalog.products.view` + `ai_assistant.view`.
 */
const widget: InjectionWidgetModule<Record<string, unknown>, Record<string, unknown>> = {
  metadata: {
    id: 'catalog.injection.merchandising-assistant-trigger',
    title: 'Catalog Merchandising Assistant Trigger',
    description:
      'Renders an "AI Merchandising" button in the products list header that opens a sheet embedding the catalog merchandising assistant.',
    features: ['catalog.products.view', 'ai_assistant.view'],
    priority: 100,
    enabled: true,
  },
  Widget: MerchandisingAssistantTriggerWidget,
}

export default widget
