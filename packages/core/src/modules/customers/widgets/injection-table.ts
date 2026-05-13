import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

/**
 * Step 4.10 / Step 5.15 / Step d4 — customers module injection table.
 *
 * - Step 4.10 drops the `ai-assistant-trigger` widget on the People-list
 *   `DataTable` `:search-trailing` slot, which renders adjacent to the
 *   list search input. The previous mount point was the `:header` slot
 *   (separate row); the round icon-only trigger now lives next to the
 *   search box for a tighter, single-row toolbar.
 * - Step 5.15 (Phase 3 WS-D) adds the `ai-deal-detail-trigger` widget on
 *   the Deal detail page header spot (`detail:customers.deal:header`).
 * - Step d4 adds the `ai-deal-analyzer-trigger` widget on the Deals list
 *   `DataTable` `:search-trailing` slot. Embeds `<AiChat>` for the
 *   `customers.deal_analyzer` agent with selected deal IDs as page context.
 *
 * Widgets embed `<AiChat agent="…" …>` with a selection- or record-aware
 * `pageContext`. The page files themselves only register the shared
 * `<InjectionSpot>` mount point — the trigger, sheet, and chat surface
 * live entirely in the injection widgets so third-party modules can copy
 * the pattern unchanged.
 */
export const injectionTable: ModuleInjectionTable = {
  'data-table:customers.people.list:search-trailing': [
    {
      widgetId: 'customers.injection.ai-assistant-trigger',
      priority: 100,
    },
  ],
  'data-table:customers.companies.list:search-trailing': [
    {
      widgetId: 'customers.injection.ai-assistant-trigger',
      priority: 100,
    },
  ],
  'data-table:customers.deals.list:search-trailing': [
    {
      widgetId: 'customers.injection.ai-assistant-trigger',
      priority: 100,
    },
    {
      widgetId: 'customers.injection.ai-deal-analyzer-trigger',
      priority: 90,
    },
  ],
  'detail:customers.deal:header': [
    {
      widgetId: 'customers.injection.ai-deal-detail-trigger',
      priority: 100,
    },
  ],
}

export default injectionTable
