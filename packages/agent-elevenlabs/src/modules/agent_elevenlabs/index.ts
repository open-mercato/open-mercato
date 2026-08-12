import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'agent_elevenlabs',
  title: 'ElevenLabs Voice Agent',
  version: '0.1.0',
  description:
    'External agent connector that places outbound ElevenLabs voice calls from a workflow and resumes the workflow with what the call collected.',
  author: 'Open Mercato Team',
  license: 'MIT',
  // Hard dependencies. `integrations` stores the per-tenant credentials this
  // connector reads on every call; `agent_orchestrator` owns the connector
  // registry, the external runner and the callback route. Without either, this
  // module registers a connector nothing can drive.
  requires: ['integrations', 'agent_orchestrator'],
}

export default metadata
