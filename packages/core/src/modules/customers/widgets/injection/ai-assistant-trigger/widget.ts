import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import AiAssistantTriggerWidget from './widget.client'

/**
 * Step 4.10 — Backend AiChat injection example.
 *
 * Demonstrates how a third-party module can drop `<AiChat>` onto a page
 * it does NOT own (the customers People / Companies / Deals lists) via
 * the existing widget injection system. Targets DataTable header /
 * search-trailing spots owned by the `DataTable` primitive in
 * `packages/ui`.
 *
 * The trigger button opens a right-side sheet embedding
 * `<AiChat agent="customers.account_assistant" pageContext={...} />`.
 * `pageContext` follows the spec §10.1 shape:
 *
 *   { view: 'customers.people.list' | 'customers.companies.list' | 'customers.deals.list',
 *     recordType: null,
 *     recordId: string,                    // "" or comma-separated UUIDs
 *     extra: { selectedCount, totalMatching } }
 *
 * Feature-gated behind `ai_assistant.view` only — the host CRM page
 * already enforces its own `customers.people.view`/`companies.view`/
 * `deals.view` guard, so the widget gate just needs to ensure the user
 * has AI assistant access. (Earlier versions also listed
 * `customers.people.view`, which is AND-evaluated by the registry and
 * hid the trigger from companies-only or deals-only viewers.)
 */
const widget: InjectionWidgetModule<Record<string, unknown>, Record<string, unknown>> = {
  metadata: {
    id: 'customers.injection.ai-assistant-trigger',
    title: 'Customers AI Assistant Trigger',
    description:
      'Renders an "Ask AI" button in the people / companies / deals list headers that opens a sheet embedding the customers account assistant.',
    features: ['ai_assistant.view'],
    requiredModules: ['ai_assistant'],
    priority: 100,
    enabled: true,
  },
  Widget: AiAssistantTriggerWidget,
}

export default widget
