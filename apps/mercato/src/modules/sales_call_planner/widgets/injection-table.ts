import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

/**
 * sales_call_planner module injection table.
 *
 * Mounts the "Brief chief of sales" trigger on the Company detail page header
 * spot (`detail:customers.company:header`) — the same spot the `agent_examples`
 * research trigger uses, which is the precedent this copies. The button starts
 * the seeded deal-briefing workflow through `POST /api/workflows/instances`.
 *
 * Priority 90 keeps it AFTER `agent_examples.injection.company-research-trigger`
 * (100) when both modules are enabled: researching a company is the cheap,
 * reversible action and belongs first; this one places a real phone call.
 */
export const injectionTable: ModuleInjectionTable = {
  'detail:customers.company:header': [
    {
      widgetId: 'sales_call_planner.injection.deal-brief-trigger',
      priority: 90,
    },
  ],
}

export default injectionTable
