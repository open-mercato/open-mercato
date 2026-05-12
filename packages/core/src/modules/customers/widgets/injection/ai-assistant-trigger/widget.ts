import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import AiAssistantTriggerWidget from './widget.client'

/**
 * Step 4.10 — Backend AiChat injection example.
 *
 * Demonstrates how a third-party module can drop `<AiChat>` onto a page
 * it does NOT own (the customers People list) via the existing widget
 * injection system. Targets spot `data-table:customers.people.list:header`,
 * which is owned by the `DataTable` primitive in `packages/ui`.
 *
 * The trigger button opens a right-side sheet embedding
 * `<AiChat agent="customers.account_assistant" pageContext={...} />`.
 * `pageContext` follows the spec §10.1 shape:
 *
 *   { view: 'customers.people.list',
 *     recordType: null,
 *     recordId: string,                    // "" or comma-separated UUIDs
 *     extra: { selectedCount, totalMatching } }
 *
 * Feature-gated behind `customers.people.view` + `ai_assistant.view`.
 */
const widget: InjectionWidgetModule<Record<string, unknown>, Record<string, unknown>> = {
  metadata: {
    id: 'customers.injection.ai-assistant-trigger',
    title: 'Customers AI Assistant Trigger',
    description:
      'Renders an "Ask AI" button in the people list header that opens a sheet embedding the customers account assistant.',
    features: ['customers.people.view', 'ai_assistant.view'],
    requiredModules: ['ai_assistant'],
    priority: 100,
    enabled: true,
  },
  Widget: AiAssistantTriggerWidget,
}

export default widget
