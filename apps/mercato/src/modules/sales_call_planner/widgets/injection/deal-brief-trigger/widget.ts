import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import DealBriefTriggerWidget from './widget.client'

/**
 * Header trigger on the Company detail page (`detail:customers.company:header`).
 *
 * Renders a "Brief chief of sales" button that starts the seeded deal-briefing
 * workflow (`POST /api/workflows/instances`) for this company, then follows the
 * run live off the `workflows.instance.*` DOM Event Bridge events.
 *
 * `features: ['sales_call_planner.brief.run']` is the module's own intent gate.
 * It is NOT the whole authorization story and is not meant to be: the POST is
 * separately guarded by `workflows.instances.create` (which the feature declares
 * as a `dependsOn`, so the role editor surfaces a grant that would otherwise be
 * inert), and placing the outbound call additionally needs the deliberately
 * default-off `agent_orchestrator.external_agents.invoke` — without it the run
 * fails down the workflow's `error` route before anything dials.
 *
 * `requiredModules` covers what a feature grant cannot: a superadmin wildcard
 * passes the feature gate even on a deployment where the orchestrator or the
 * ElevenLabs connector is disabled, and the button would then start a run whose
 * agent steps have no runtime. Both modules are listed because the workflow
 * needs both — the native researchers and the external voice agent.
 */
const widget: InjectionWidgetModule<Record<string, unknown>, Record<string, unknown>> = {
  metadata: {
    id: 'sales_call_planner.injection.deal-brief-trigger',
    title: 'Deal Briefing Call Trigger',
    description:
      'Renders a "Brief chief of sales" button in the company detail header that starts the deal-briefing workflow — a phone call about this company\'s open deals whose reply becomes CRM tasks.',
    features: ['sales_call_planner.brief.run'],
    requiredModules: ['agent_orchestrator', 'agent_elevenlabs'],
    priority: 90,
    enabled: true,
  },
  Widget: DealBriefTriggerWidget,
}

export default widget
