/**
 * Module-root AI tool contribution.
 *
 * The generator walks every module for a top-level `ai-tools.ts` and takes the default/`aiTools` export;
 * `ai-tools.generated.ts` is then loaded by the ai-assistant tool loader, which registers each tool
 * through `registerMcpTool`. That one registry serves both the MCP server (external agents) and the
 * in-app chat runtime, so these tools need no UI of their own.
 *
 * Requires `yarn generate` to be discovered.
 */
import marketingAuthoringAiTools from './ai-tools/authoring-pack.js'
import type { MarketingAiToolDefinition } from './ai-tools/types.js'

export const aiTools: MarketingAiToolDefinition<never, never>[] = [
  ...marketingAuthoringAiTools,
]

export default aiTools
