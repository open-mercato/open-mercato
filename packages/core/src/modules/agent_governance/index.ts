import type { ModuleInfo } from '@open-mercato/shared/modules/registry'
import './commands'

export const metadata: ModuleInfo = {
  name: 'agent_governance',
  title: 'Agent Governance',
  version: '0.1.0',
  description: 'Governed agent runs, immutable decision telemetry, and precedent retrieval.',
  author: 'Open Mercato Team',
  license: 'MIT',
  ejectable: true,
}

export { features } from './acl'
