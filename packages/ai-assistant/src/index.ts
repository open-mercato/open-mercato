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

// MCP server (stdio)
export { createMcpServer, runMcpServer } from './modules/ai_assistant/lib/mcp-server'

// MCP HTTP server
export { runMcpHttpServer, type McpHttpServerOptions } from './modules/ai_assistant/lib/http-server'

// MCP auth
export {
  authenticateMcpRequest,
  extractApiKeyFromHeaders,
  type McpAuthResult,
  type McpAuthSuccess,
  type McpAuthFailure,
} from './modules/ai_assistant/lib/auth'

// Tool loader
export { loadAllModuleTools, indexToolsForSearch } from './modules/ai_assistant/lib/tool-loader'

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
  handleOpenCodeMessageStreaming,
  handleOpenCodeAnswer,
  getPendingQuestions,
  extractTextFromResponse,
  extractAllPartsFromResponse,
  extractMetadataFromResponse,
  type OpenCodeTestRequest,
  type OpenCodeTestResponse,
  type OpenCodeHealthResponse,
  type OpenCodeResponsePart,
  type OpenCodeResponseMetadata,
  type OpenCodeStreamEvent,
  type OpenCodeQuestion,
} from './modules/ai_assistant/lib/opencode-handlers'

// Module metadata
export { metadata, features } from './modules/ai_assistant'
