import { z } from 'zod'
import type { SearchService } from '@open-mercato/search/service'
import { registerMcpTool, getToolRegistry } from './tool-registry'
import type { McpToolDefinition, McpToolContext } from './types'
import { ToolSearchService } from './tool-search'
import { loadApiDiscoveryTools } from './api-discovery-tools'

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
 * Dynamically load tools from known module paths.
 * This is called during MCP server startup.
 */
export async function loadAllModuleTools(): Promise<void> {
  // 1. Register built-in tools
  registerMcpTool(contextWhoamiTool, { moduleId: 'context' })
  console.error('[MCP Tools] Registered built-in context_whoami tool')

  // 2. Register entity graph tools
  try {
    const { entityGraphTools } = await import('./entity-graph-tools')
    for (const tool of entityGraphTools) {
      registerMcpTool(tool, { moduleId: 'schema' })
    }
    console.error(`[MCP Tools] Registered ${entityGraphTools.length} entity graph tools`)
  } catch (error) {
    console.error('[MCP Tools] Could not load entity graph tools:', error)
  }

  // 3. Load auto-discovered ai-tools.ts files from modules
  // Tools are discovered by the generator and registered in ai-tools.generated.ts
  try {
    // prettier-ignore
    const pathModule = await import(/* webpackIgnore: true */ 'node:path')
    const path = pathModule.default
    // prettier-ignore
    const { pathToFileURL } = await import(/* webpackIgnore: true */ 'node:url')
    // prettier-ignore
    const fsModule = await import(/* webpackIgnore: true */ 'node:fs')
    const fs = fsModule.default
    // prettier-ignore
    const { findAppRoot, findAllApps } = await import(/* webpackIgnore: true */ '@open-mercato/shared/lib/bootstrap/appResolver')

    // Find the app root (contains .mercato/generated/)
    let appRoot = findAppRoot()

    // Fallback: Try monorepo structure if not found
    if (!appRoot) {
      let current = process.cwd()
      while (current !== path.dirname(current)) {
        const appsDir = path.join(current, 'apps')
        if (fs.existsSync(appsDir)) {
          const apps = findAllApps(current)
          if (apps.length > 0) {
            appRoot = apps[0]
            break
          }
        }
        current = path.dirname(current)
      }
    }

    if (!appRoot) {
      console.error(`[MCP Tools] Could not find app root with .mercato/generated directory`)
      return
    }

    const tsPath = path.join(appRoot.generatedDir, 'ai-tools.generated.ts')

    // Check if file exists
    if (!fs.existsSync(tsPath)) {
      console.error(`[MCP Tools] No auto-discovered tools (run npm run modules:prepare to generate)`)
    } else {
      // Compile TypeScript to JavaScript using esbuild (same approach as dynamicLoader)
      const jsPath = tsPath.replace(/\.ts$/, '.mjs')
      const jsExists = fs.existsSync(jsPath)

      const needsCompile = !jsExists ||
        fs.statSync(tsPath).mtimeMs > fs.statSync(jsPath).mtimeMs

      if (needsCompile) {
        console.error(`[MCP Tools] Compiling ai-tools.generated.ts...`)
        // prettier-ignore
        const esbuild = await import(/* webpackIgnore: true */ 'esbuild')
        const appRoot = path.dirname(path.dirname(path.dirname(tsPath)))

        // Plugin to resolve @/ alias to app root
        const aliasPlugin: import('esbuild').Plugin = {
          name: 'alias-resolver',
          setup(build) {
            build.onResolve({ filter: /^@\// }, (args) => {
              const resolved = path.join(appRoot, args.path.slice(2))
              if (!fs.existsSync(resolved) && fs.existsSync(resolved + '.ts')) {
                return { path: resolved + '.ts' }
              }
              if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory() && fs.existsSync(path.join(resolved, 'index.ts'))) {
                return { path: path.join(resolved, 'index.ts') }
              }
              return { path: resolved }
            })
          },
        }

        // Plugin to mark non-JSON package imports as external
        const externalNonJsonPlugin: import('esbuild').Plugin = {
          name: 'external-non-json',
          setup(build) {
            // Filter matches paths that don't start with . or / (package imports)
            build.onResolve({ filter: /^[^./]/ }, (args) => {
              // Skip Windows absolute paths (e.g., C:\...) - they're local files, not packages
              if (/^[a-zA-Z]:/.test(args.path)) {
                return null
              }
              if (args.path.endsWith('.json')) {
                return null
              }
              return { path: args.path, external: true }
            })
          },
        }

        await esbuild.build({
          entryPoints: [tsPath],
          outfile: jsPath,
          bundle: true,
          format: 'esm',
          platform: 'node',
          target: 'node18',
          plugins: [aliasPlugin, externalNonJsonPlugin],
          loader: { '.json': 'json' },
        })
        console.error(`[MCP Tools] Compiled to ${jsPath}`)
      }

      // Import the compiled JavaScript
      const fileUrl = pathToFileURL(jsPath).href
      const { aiToolConfigEntries } = (await import(fileUrl)) as {
        aiToolConfigEntries: Array<{ moduleId: string; tools: unknown[] }>
      }

      let totalTools = 0
      for (const { moduleId, tools } of aiToolConfigEntries) {
        if (Array.isArray(tools) && tools.length > 0) {
          loadModuleTools(moduleId, tools as ModuleAiTool[])
          totalTools += tools.length
          console.error(`[MCP Tools] Loaded ${tools.length} tools from ${moduleId}`)
        }
      }
      if (totalTools === 0) {
        console.error(`[MCP Tools] No module tools found in generated registry`)
      }
    }
  } catch (error) {
    // Generated file might not exist yet (first run) or be empty
    // This is expected when no modules have ai-tools.ts files
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error(`[MCP Tools] Error loading auto-discovered tools:`, errorMessage)
    if (errorMessage.includes('Cannot find module') || errorMessage.includes('ENOENT')) {
      console.error(`[MCP Tools] No auto-discovered tools (run npm run modules:prepare to generate)`)
    } else {
      console.error(`[MCP Tools] Could not load auto-discovered tools:`, error)
    }
  }

  // 4. Load API discovery tools (api_discover, api_execute)
  try {
    const apiToolCount = await loadApiDiscoveryTools()
    console.error(`[MCP Tools] Loaded ${apiToolCount} API discovery tools`)
  } catch (error) {
    console.error('[MCP Tools] Could not load API discovery tools:', error)
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
