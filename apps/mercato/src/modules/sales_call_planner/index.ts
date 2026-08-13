import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'sales_call_planner',
  title: 'Sales Call Planner',
  version: '0.1.0',
  description:
    'Briefs the chief of sales by phone about a company’s open deals and turns their reply into CRM tasks.',
  author: 'Open Mercato Team',
  license: 'MIT',
  // Hard dependencies, not optional peers: the workflow definition this module
  // seeds names agents registered through the orchestrator SDK, the voice step
  // rides the ElevenLabs external-agent connector, the brief is assembled from
  // customers data, and the whole feature is a workflow definition. The
  // generator fails the build with an actionable message when one is missing,
  // which beats a module-not-found at import time.
  requires: ['agent_orchestrator', 'agent_elevenlabs', 'customers', 'workflows'],
}

export default metadata
