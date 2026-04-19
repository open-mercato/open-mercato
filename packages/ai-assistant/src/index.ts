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

// Focused-agent definition types + helper
export {
  defineAiAgent,
  type AiAgentDefinition,
  type AiAgentExecutionMode,
  type AiAgentMutationPolicy,
  type AiAgentAcceptedMediaType,
  type AiAgentDataOperation,
  type AiAgentPageContextInput,
  type AiAgentStructuredOutput,
  type AiAgentDataCapabilities,
} from './modules/ai_assistant/lib/ai-agent-definition'

// Additive AI tool builder
export { defineAiTool } from './modules/ai_assistant/lib/ai-tool-definition'

// Attachment-bridge contract types (spec Phase 0 §8/§10, implementation-ready for Phase 3 runtime)
export {
  type AttachmentSource,
  type AiResolvedAttachmentPart,
  type AiUiPart,
  type AiChatRequestContext,
} from './modules/ai_assistant/lib/attachment-bridge-types'

// Prompt-composition primitives (spec Phase 0 §8, implementation-ready for Phase 3 prompt composer)
export {
  definePromptTemplate,
  type PromptSectionName,
  type PromptSection,
  type PromptTemplate,
} from './modules/ai_assistant/lib/prompt-composition-types'

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

// Agent registry (Phase 1 WS-A — read-side lookup API, no policy / dispatch)
export {
  loadAgentRegistry,
  getAgent,
  listAgents,
  listAgentsByModule,
  resetAgentRegistryForTests,
} from './modules/ai_assistant/lib/agent-registry'

// Agent runtime policy gate (Phase 1 WS-A — pure policy decisions, no HTTP or AI SDK wiring)
export {
  checkAgentPolicy,
  type AgentPolicyDenyCode,
  type AgentPolicyDecision,
  type AgentPolicyAuthContext,
  type AgentPolicyCheckInput,
} from './modules/ai_assistant/lib/agent-policy'

// AI SDK helpers (Phase 1 WS-B — chat-mode runtime + transport glue)
export {
  resolveAiAgentTools,
  AgentPolicyError,
  type ResolveAiAgentToolsInput,
  type ResolvedAgentTools,
  type AiUiPartQueue,
} from './modules/ai_assistant/lib/agent-tools'

// Mutation-preparation helper (Phase 3 WS-C — Step 5.6)
export {
  prepareMutation,
  computeMutationIdempotencyKey,
  AiMutationPreparationError,
  MUTATION_PREVIEW_CARD_COMPONENT,
  type PrepareMutationInput,
  type PrepareMutationContext,
  type PrepareMutationResult,
} from './modules/ai_assistant/lib/prepare-mutation'

export {
  runAiAgentText,
  runAiAgentObject,
  composeSystemPrompt,
  type RunAiAgentTextInput,
  type RunAiAgentObjectInput,
  type RunAiAgentObjectOutputOverride,
  type RunAiAgentObjectResult,
  type RunAiAgentObjectGenerateResult,
  type RunAiAgentObjectStreamResult,
  type AgentRequestPageContext,
} from './modules/ai_assistant/lib/agent-runtime'

export {
  createAiAgentTransport,
  type CreateAiAgentTransportInput,
} from './modules/ai_assistant/lib/agent-transport'

// Pending-action types / enums / state-machine guard (Phase 3 WS-C — Step 5.5)
export {
  AI_PENDING_ACTION_STATUSES,
  AI_PENDING_ACTION_QUEUE_MODES,
  AI_PENDING_ACTION_ALLOWED_TRANSITIONS,
  AI_PENDING_ACTION_TERMINAL_STATUSES,
  AI_PENDING_ACTION_DEFAULT_TTL_SECONDS,
  AI_PENDING_ACTION_TTL_ENV_VAR,
  AiPendingActionStateError,
  isAiPendingActionStatus,
  isAiPendingActionQueueMode,
  isTerminalAiPendingActionStatus,
  isAllowedAiPendingActionTransition,
  resolveAiPendingActionTtlSeconds,
  type AiPendingActionStatus,
  type AiPendingActionQueueMode,
  type AiPendingActionRecordDiff,
  type AiPendingActionFailedRecord,
  type AiPendingActionFieldDiff,
  type AiPendingActionExecutionResult,
} from './modules/ai_assistant/lib/pending-action-types'

// Client-facing pending-action serializer (Phase 3 WS-C — Step 5.7, reused by 5.8 / 5.9 / 5.10)
export {
  serializePendingActionForClient,
  type SerializedPendingAction,
  type SerializablePendingActionRow,
} from './modules/ai_assistant/lib/pending-action-client'

// Shared AI model factory (Phase 3 WS-A — Step 5.1)
export {
  createModelFactory,
  AiModelFactoryError,
  type AiModelFactory,
  type AiModelFactoryInput,
  type AiModelResolution,
  type AiModelFactoryErrorCode,
  type AiModelInstance,
  type CreateModelFactoryDependencies,
} from './modules/ai_assistant/lib/model-factory'

// Attachment-to-model bridge (Phase 1 WS-C — Step 3.7)
export {
  resolveAttachmentParts,
  resolveAttachmentPartsForAgent,
  attachmentPartsToUiFileParts,
  summarizeAttachmentPartsForPrompt,
  type ResolveAttachmentPartsInput,
  type AttachmentSigner,
} from './modules/ai_assistant/lib/attachment-parts'

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
