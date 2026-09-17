import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import CompanyResearchTriggerWidget from './widget.client'

/**
 * Header trigger on the Company detail page (`detail:customers.company:header`).
 *
 * Renders a "Research company" button that runs the file-defined
 * `deals.company_researcher` Agent Orchestrator agent (web search + web fetch)
 * and shows the qualified prospect assessment in a side sheet. The run goes
 * through `POST /api/agent_orchestrator/agents/deals.company_researcher/run`.
 *
 * Feature-gated behind `agent_orchestrator.agents.run` and `requiredModules:
 * ['agent_orchestrator']`, so it only appears when the orchestrator is enabled
 * and the operator may run agents. Web egress additionally requires the
 * default-off `agent_orchestrator.web_search` grant (surfaced as a 403 when
 * missing).
 */
const widget: InjectionWidgetModule<Record<string, unknown>, Record<string, unknown>> = {
  metadata: {
    id: 'agent_examples.injection.company-research-trigger',
    title: 'Company Research Trigger',
    description:
      'Renders a "Research company" button in the company detail header that runs the web-search company researcher agent and shows the prospect assessment.',
    features: ['agent_orchestrator.agents.run'],
    requiredModules: ['agent_orchestrator'],
    priority: 100,
    enabled: true,
  },
  Widget: CompanyResearchTriggerWidget,
}

export default widget
