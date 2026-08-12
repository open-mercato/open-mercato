import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'agent_http',
  title: 'HTTP Agent Connector',
  version: '0.1.0',
  description:
    'Generic external-agent connector: starts a run on any HTTP service with a POST and resumes the workflow from that service\'s signed callback.',
  author: 'Open Mercato Team',
  license: 'MIT',
  // Hard dependencies. `integrations` stores the per-tenant configuration this
  // connector is entirely made of; `agent_orchestrator` owns the connector
  // registry, the external runner and the callback route. Without either, this
  // module registers a connector nothing can drive.
  requires: ['integrations', 'agent_orchestrator'],
}

export default metadata
