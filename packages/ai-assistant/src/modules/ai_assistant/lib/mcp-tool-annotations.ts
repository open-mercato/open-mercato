import type { AiToolDefinition, McpToolAnnotations, McpToolDefinition } from './types'

/**
 * Subset of the MCP `ToolAnnotations` shape that Open Mercato publishes in
 * `tools/list`. Only hints derivable from a registered tool definition are
 * emitted — the remaining ones are left to the client's spec defaults.
 */
/**
 * Build the MCP annotations advertised for a registered tool.
 *
 * `readOnlyHint` follows the registry's existing mutation contract: a tool is
 * read-only unless it declares `isMutation: true`. Every write tool is required
 * to set that flag (see the module AGENTS.md) and the agent mutation-policy gate
 * already reads it the same way.
 *
 * `destructiveHint` only carries meaning for mutating tools. A predicate
 * `isDestructive` cannot be evaluated without call input, so it resolves to
 * `true` rather than under-warning the client. When the flag is absent the hint
 * is omitted so clients fall back to the conservative MCP default (`true`).
 *
 * `idempotentHint` is deliberately not emitted: no tool-definition field
 * carries that information, so clients keep the MCP default (`false`).
 */
export function buildMcpToolAnnotations(tool: McpToolDefinition): McpToolAnnotations {
  const definition = tool as AiToolDefinition

  if (definition.isMutation !== true) {
    return { readOnlyHint: true }
  }

  const { isDestructive } = definition
  if (isDestructive === undefined) {
    return { readOnlyHint: false }
  }

  return {
    readOnlyHint: false,
    destructiveHint: typeof isDestructive === 'function' ? true : isDestructive,
  }
}
