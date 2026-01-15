/**
 * @open-mercato/ai-assistant
 *
 * MCP (Model Context Protocol) server module for AI assistant integration.
 *
 * This module provides:
 * - MCP server with stdio transport for Claude Desktop integration
 * - Tool registry for modules to register AI-callable tools
 * - ACL-based permission filtering for tools
 * - Multi-tenant execution context
 *
 * @example
 * ```typescript
 * import { registerMcpTool } from '@open-mercato/ai-assistant/tools'
 * import { z } from 'zod'
 *
 * registerMcpTool({
 *   name: 'customers.search',
 *   description: 'Search for customers',
 *   inputSchema: z.object({ query: z.string() }),
 *   requiredFeatures: ['customers.people.view'],
 *   handler: async (input, ctx) => {
 *     // Implementation
 *   }
 * }, { moduleId: 'customers' })
 * ```
 */

// Re-export types
export * from './modules/ai_assistant/lib/types'

// Tool registry
export {
  registerMcpTool,
  getToolRegistry,
  unregisterMcpTool,
  toolRegistry,
} from './modules/ai_assistant/lib/tool-registry'

// Tool executor
export { executeTool } from './modules/ai_assistant/lib/tool-executor'

// MCP server
export { createMcpServer, runMcpServer } from './modules/ai_assistant/lib/mcp-server'

// OpenCode client
export {
  OpenCodeClient,
  createOpenCodeClient,
  type OpenCodeClientConfig,
  type OpenCodeSession,
  type OpenCodeMessage,
  type OpenCodeHealth,
  type OpenCodeMcpStatus,
} from './modules/ai_assistant/lib/opencode-client'

// OpenCode route handlers
export {
  handleOpenCodeMessage,
  handleOpenCodeHealth,
  extractTextFromResponse,
  type OpenCodeTestRequest,
  type OpenCodeTestResponse,
  type OpenCodeHealthResponse,
} from './modules/ai_assistant/lib/opencode-handlers'

// Module metadata
export { metadata, features } from './modules/ai_assistant'
