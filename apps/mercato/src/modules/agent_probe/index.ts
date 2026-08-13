import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'agent_probe',
  title: 'Agent Probe (test only)',
  version: '0.1.0',
  description:
    'Test-only external-agent connector and agents. Enabled solely under OM_INTEGRATION_TEST so the integration suite can exercise the suspend/callback/resume seam without dialling a real provider.',
  author: 'Open Mercato Team',
  license: 'MIT',
}

export default metadata
