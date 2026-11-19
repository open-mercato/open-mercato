import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

/**
 * agent_examples module injection table.
 *
 * Mounts the "Research company" trigger on the Company detail page header spot
 * (`detail:customers.company:header`). The widget runs the file-defined
 * `deals.company_researcher` Agent Orchestrator agent (web search + web fetch)
 * and renders the prospect assessment in a side sheet. Third-party modules can
 * copy this pattern unchanged — the company page only exposes the shared
 * `<InjectionSpot>` mount point.
 */
export const injectionTable: ModuleInjectionTable = {
  'detail:customers.company:header': [
    {
      widgetId: 'agent_examples.injection.company-research-trigger',
      priority: 100,
    },
  ],
}

export default injectionTable
