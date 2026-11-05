import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'ai_assistant',
  title: 'AI Assistant',
  version: '0.1.0',
  description: 'MCP server for AI assistant integration with multi-tenant support.',
  author: 'FreightTech Team',
}

export { features } from './acl'
