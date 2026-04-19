import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

/**
 * Step 4.10 — customers module injection table.
 *
 * Maps the `ai-assistant-trigger` injection widget to the People-list
 * `DataTable` header spot. The widget ships the Phase 2 WS-C backend
 * example of `<AiChat>` embedded via existing injection patterns (no
 * page edits).
 */
export const injectionTable: ModuleInjectionTable = {
  'data-table:customers.people.list:header': [
    {
      widgetId: 'customers.injection.ai-assistant-trigger',
      priority: 100,
    },
  ],
}

export default injectionTable
