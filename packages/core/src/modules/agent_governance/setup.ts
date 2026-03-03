import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['agent_governance.*'],
    admin: [
      'agent_governance.view',
      'agent_governance.policies.manage',
      'agent_governance.risk_bands.manage',
      'agent_governance.playbooks.manage',
      'agent_governance.runs.view',
      'agent_governance.runs.manage',
      'agent_governance.approvals.manage',
      'agent_governance.memory.view',
      'agent_governance.memory.manage',
      'agent_governance.skills.manage',
      'agent_governance.tools.use',
    ],
    employee: [
      'agent_governance.view',
      'agent_governance.runs.view',
      'agent_governance.runs.manage',
      'agent_governance.memory.view',
      'agent_governance.tools.use',
    ],
  },
}

export default setup
