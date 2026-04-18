import { z } from 'zod'
import type { SearchService } from '@open-mercato/search/service'
import { registerMcpTool, getToolRegistry } from './tool-registry'
import type { McpToolDefinition, McpToolContext } from './types'
import { ToolSearchService } from './tool-search'

/**
 * Module tool definition as exported from ai-tools.ts files.
 */
type ModuleAiTool = {
  name: string
  description: string
  inputSchema: any
  requiredFeatures?: string[]
  handler: (input: any, ctx: any) => Promise<unknown>
}

/**
 * Shape of a single entry inside `ai-tools.generated.ts`.
 * Matches the structural contract emitted by
 * `packages/cli/src/lib/generators/extensions/ai-tools.ts`.
 */
export type AiToolConfigEntry = {
  moduleId: string
  tools: unknown[]
}

function isModuleAiTool(value: unknown): value is ModuleAiTool {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.name === 'string' &&
    typeof candidate.description === 'string' &&
    candidate.inputSchema !== undefined &&
    typeof candidate.handler === 'function'
  )
}

/**
 * Built-in context.whoami tool that returns the current authentication context.
 * This is useful for AI to understand its current tenant/org scope.
 */
const contextWhoamiTool: McpToolDefinition = {
  name: 'context_whoami',
  description:
    'Get the current authentication context including tenant ID, organization ID, user ID, and available features. Use this to understand your current scope before performing operations.',
  inputSchema: z.object({}),
  requiredFeatures: [], // No specific feature required - available to all authenticated users
  handler: async (_input: unknown, ctx: McpToolContext) => {
    return {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      isSuperAdmin: ctx.isSuperAdmin,
      features: ctx.userFeatures,
      featureCount: ctx.userFeatures.length,
    }
  },
}

/**
 * Load and register AI tools from a module's ai-tools.ts export.
 *
 * @param moduleId - The module identifier (e.g., 'search', 'customers')
 * @param tools - Array of tool definitions from the module
 */
export function loadModuleTools(moduleId: string, tools: ModuleAiTool[]): void {
  for (const tool of tools) {
    registerMcpTool(
      {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        requiredFeatures: tool.requiredFeatures,
        handler: tool.handler,
      } as McpToolDefinition,
      { moduleId }
    )
  }
}

/**
 * Register the generated `aiToolConfigEntries` shape emitted by the
 * `ai-tools.generated.ts` generator extension. Entries with an empty
 * `tools` array stay silent (the generator already filters those out).
 * Invalid tool objects are skipped with a warning instead of throwing.
 *
 * Returns the number of tools actually registered so callers can log it.
 */
export function registerGeneratedAiToolEntries(entries: AiToolConfigEntry[]): number {
  let registered = 0
  for (const entry of entries) {
    if (!entry || typeof entry.moduleId !== 'string') continue
    if (!Array.isArray(entry.tools) || entry.tools.length === 0) continue
    for (const candidate of entry.tools) {
      if (!isModuleAiTool(candidate)) {
        console.warn(
          `[MCP Tools] Skipping malformed AI tool in module "${entry.moduleId}"`
        )
        continue
      }
      registerMcpTool(
        {
          name: candidate.name,
          description: candidate.description,
          inputSchema: candidate.inputSchema,
          requiredFeatures: candidate.requiredFeatures,
          handler: candidate.handler,
        } as McpToolDefinition,
        { moduleId: entry.moduleId }
      )
      registered += 1
    }
  }
  return registered
}

/**
 * Load the generated `ai-tools.generated.ts` file emitted by
 * `yarn generate` and register every declared module tool through the
 * existing `registerMcpTool` path. Safe to call when the generated file
 * is missing (e.g., tests or pre-generate builds) — returns 0.
 */
export async function loadGeneratedModuleAiTools(): Promise<number> {
  try {
    const mod = (await import(
      '@/.mercato/generated/ai-tools.generated'
    )) as { aiToolConfigEntries?: AiToolConfigEntry[] }
    const entries = Array.isArray(mod.aiToolConfigEntries)
      ? mod.aiToolConfigEntries
      : []
    return registerGeneratedAiToolEntries(entries)
  } catch (error) {
    console.error(
      '[MCP Tools] Could not load ai-tools.generated.ts (module tools unavailable):',
      error
    )
    return 0
  }
}

/**
 * Dynamically load tools from known module paths.
 * This is called during MCP server startup.
 */
export async function loadAllModuleTools(): Promise<void> {
  // 1. Register built-in tools
  registerMcpTool(contextWhoamiTool, { moduleId: 'context' })
  console.error('[MCP Tools] Registered built-in context_whoami tool')

  // 2. Register Code Mode tools (search + execute)
  // These two tools replace the previous api_discover, call_api, discover_schema,
  // and all module-specific AI tools. The AI writes JavaScript that runs in a
  // node:vm sandbox with access to the OpenAPI spec and api.request().
  try {
    const { loadCodeModeTools } = await import('./codemode-tools')
    const toolCount = await loadCodeModeTools()
    console.error(`[MCP Tools] Registered ${toolCount} Code Mode tools`)
  } catch (error) {
    console.error('[MCP Tools] Could not load Code Mode tools:', error)
  }

  // 3. Register module-contributed tools from ai-tools.generated.ts.
  // Code Mode stays untouched; module tools are additive. Missing
  // generated file is not fatal (pre-generate builds, tests).
  try {
    const moduleToolCount = await loadGeneratedModuleAiTools()
    console.error(
      `[MCP Tools] Registered ${moduleToolCount} module-contributed AI tools from ai-tools.generated.ts`
    )
  } catch (error) {
    console.error('[MCP Tools] Could not load module AI tools:', error)
  }
}

/**
 * Index all registered tools for hybrid search discovery.
 * This should be called after loadAllModuleTools() when the search service is available.
 *
 * @param searchService - The search service from DI container
 * @param force - Force re-indexing even if checksums match
 * @returns Indexing result with statistics
 */
export async function indexToolsForSearch(
  searchService: SearchService,
  force = false
): Promise<{
  indexed: number
  skipped: number
  strategies: string[]
  checksum: string
}> {
  const registry = getToolRegistry()
  const toolSearchService = new ToolSearchService(searchService, registry)

  try {
    const result = await toolSearchService.indexTools(force)

    console.error(`[MCP Tools] Indexed ${result.indexed} tools for search`)
    console.error(`[MCP Tools] Search strategies available: ${result.strategies.join(', ')}`)

    if (result.skipped > 0) {
      console.error(`[MCP Tools] Skipped ${result.skipped} tools (unchanged)`)
    }

    return result
  } catch (error) {
    console.error('[MCP Tools] Failed to index tools for search:', error)
    throw error
  }
}

/**
 * Create a ToolSearchService instance for tool discovery.
 * Use this to get a configured service for discovering relevant tools.
 *
 * @param searchService - The search service from DI container
 * @returns Configured ToolSearchService
 */
export function createToolSearchService(searchService: SearchService): ToolSearchService {
  const registry = getToolRegistry()
  return new ToolSearchService(searchService, registry)
}
