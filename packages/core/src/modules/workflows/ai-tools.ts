/**
 * Module-root AI tool contribution for the workflows module (spec §9.5,
 * roadmap Phase 6 — "Agent-as-author (MCP tool pack)").
 *
 * The generator walks every module for a top-level `ai-tools.ts` and takes the
 * default/`aiTools` export as the contribution; `ai-tools.generated.ts` is then
 * loaded by the ai-assistant tool-loader, which registers each tool through
 * `registerMcpTool`. That single registry serves BOTH consumers: the MCP server
 * (external agents) and the in-app `<AiChat>` agent runtime.
 *
 * Requires `yarn generate` to be discovered.
 */
import workflowsAuthoringAiTools from './ai-tools/authoring-pack'
import type { WorkflowsAiToolDefinition } from './ai-tools/types'

export const aiTools: WorkflowsAiToolDefinition<never, never>[] = [
  ...workflowsAuthoringAiTools,
]

export default aiTools
