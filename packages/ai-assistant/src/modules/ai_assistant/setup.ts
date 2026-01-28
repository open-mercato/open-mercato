import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: [
      'ai_assistant.view',
      'ai_assistant.settings.manage',
      'ai_assistant.mcp.serve',
      'ai_assistant.tools.list',
      'ai_assistant.mcp_servers.view',
      'ai_assistant.mcp_servers.manage',
    ],
  },
}

export default setup
