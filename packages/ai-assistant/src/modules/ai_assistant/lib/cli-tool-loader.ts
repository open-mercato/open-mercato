import { buildSchemaFromParams, type ParsedParameter } from './cli-ast-parser'
import { registerMcpTool } from './tool-registry'
import type { McpToolContext, McpToolDefinition } from './types'
// Static imports ensure we use the SAME module instances that tool handlers will use
import { getDiRegistrars, registerDiRegistrars } from '@open-mercato/shared/lib/di/container'
import { registerOrmEntities, getOrmEntities } from '@open-mercato/shared/lib/db/mikro'
import { registerModules } from '@open-mercato/shared/lib/i18n/server'
import { registerEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Ensure bootstrap has run in this module instance.
 *
 * Due to tsx/esbuild module duplication (https://github.com/privatenumber/tsx/issues/499),
 * the same file can be loaded as multiple separate module instances when mixing
 * dynamic imports with static imports. This means bootstrap() may have registered
 * entities/DI in a different module instance than this one.
 *
 * The workaround is to directly import registration functions (static imports above)
 * and call them with the generated data. This ensures registrations happen in the
 * SAME module instances that cli-tool-loader and tool handlers use.
 */
async function ensureBootstrapInThisContext(): Promise<void> {
  // Check if already registered in this context
  try {
    getOrmEntities()
    getDiRegistrars()
    return // Already available
  } catch {
    // Not available, need to register
  }

  // Dynamically import the generated data (these are just arrays, not @open-mercato/shared)
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = dirname(__filename)
  const generatedPath = resolve(__dirname, '../../../../../../generated')

  try {
    // Import generated registries
    const [entitiesMod, diMod, modulesMod, entityIdsMod] = await Promise.all([
      import(pathToFileURL(resolve(generatedPath, 'entities.generated.ts')).href),
      import(pathToFileURL(resolve(generatedPath, 'di.generated.ts')).href),
      import(pathToFileURL(resolve(generatedPath, 'modules.generated.ts')).href),
      import(pathToFileURL(resolve(generatedPath, 'entities.ids.generated.ts')).href),
    ])

    // Register directly using the static imports (same module instances as tool handlers)
    registerOrmEntities(entitiesMod.entities)
    registerDiRegistrars(diMod.diRegistrars.filter((r: unknown) => r != null))
    registerModules(modulesMod.modules)
    registerEntityIds(entityIdsMod.E)
  } catch (error) {
    console.error('[CLI Tools] Failed to bootstrap:', error instanceof Error ? error.message : error)
    throw new Error('CLI tools require application bootstrap. Could not initialize.')
  }
}

/**
 * Configuration for CLI tool loading.
 */
export interface CliToolLoaderConfig {
  /** Command names to exclude (can be 'command-name' or 'module.command-name') */
  blocklist?: string[]
}

/**
 * Generated CLI tool structure (from cli-tools.generated.ts)
 */
interface GeneratedCliTool {
  name: string
  moduleId: string
  commandName: string
  description: string
  parameters: ParsedParameter[]
  sourcePath: string
}

/**
 * Convert a source path to a package import path.
 * E.g., "packages/core/src/modules/auth/cli.ts" -> "@open-mercato/core/modules/auth/cli"
 */
function sourcePathToImportPath(sourcePath: string): string {
  const match = sourcePath.match(/^packages\/([^/]+)\/src\/modules\/(.+)\/cli\.ts$/)
  if (match) {
    const [, packageName, modulePath] = match
    return `@open-mercato/${packageName}/modules/${modulePath}/cli`
  }
  return sourcePath
}

/**
 * Load CLI tools from the generated file.
 * Run `yarn generate:cli-tools` to regenerate the file after CLI changes.
 *
 * @param config - Configuration options
 * @returns Number of tools loaded
 */
export async function loadCliTools(config: CliToolLoaderConfig = {}): Promise<number> {
  const { blocklist = [] } = config

  try {
    const generated = await import('../../../../generated/cli-tools.generated')
    const tools = generated.cliTools as GeneratedCliTool[]

    if (!tools || tools.length === 0) {
      console.log('[CLI Tools] No tools found in generated file')
      return 0
    }

    console.log(`[CLI Tools] Loading ${tools.length} tools from generated file...`)
    return await loadFromGeneratedTools(tools, blocklist)
  } catch (error) {
    console.error('[CLI Tools] Failed to load generated file. Run `yarn generate:cli-tools` first.', error)
    return 0
  }
}

/**
 * Load tools from pre-generated data.
 */
async function loadFromGeneratedTools(
  tools: GeneratedCliTool[],
  blocklist: string[]
): Promise<number> {
  let toolCount = 0

  // Group tools by source path for efficient CLI module loading
  const toolsBySourcePath = new Map<string, GeneratedCliTool[]>()
  for (const tool of tools) {
    const existing = toolsBySourcePath.get(tool.sourcePath) || []
    existing.push(tool)
    toolsBySourcePath.set(tool.sourcePath, existing)
  }

  for (const [sourcePath, sourceTools] of toolsBySourcePath) {
    const moduleId = sourceTools[0]?.moduleId
    if (!moduleId) continue

    try {
      // Convert source path to package import path
      const importPath = sourcePathToImportPath(sourcePath)
      const cliModule = await import(importPath)
      const cliCommands = cliModule.default || []

      for (const tool of sourceTools) {
        // Skip blocklisted commands
        if (
          blocklist.includes(tool.commandName) ||
          blocklist.includes(`${moduleId}.${tool.commandName}`)
        ) {
          continue
        }

        // Find the matching command handler
        const command = cliCommands.find((c: { command: string }) => c.command === tool.commandName)
        if (!command) {
          continue
        }

        // Build and register the tool
        const mcpTool = buildCliToolFromGenerated(tool, command)
        registerMcpTool(mcpTool, { moduleId: `cli_${moduleId}` })
        toolCount++
      }
    } catch {
      // Silently skip modules that fail to import (e.g., ES module compatibility issues)
    }
  }

  console.log(`[CLI Tools] Loaded ${toolCount} CLI tools`)
  return toolCount
}

/**
 * Capture console output during CLI command execution.
 * Returns the captured stdout and stderr as strings.
 */
async function captureConsoleOutput<T>(fn: () => Promise<T>): Promise<{ result: T; stdout: string; stderr: string }> {
  const stdout: string[] = []
  const stderr: string[] = []

  const originalLog = console.log
  const originalError = console.error
  const originalWarn = console.warn
  const originalInfo = console.info

  console.log = (...args: unknown[]) => stdout.push(args.map(String).join(' '))
  console.info = (...args: unknown[]) => stdout.push(args.map(String).join(' '))
  console.warn = (...args: unknown[]) => stderr.push(args.map(String).join(' '))
  console.error = (...args: unknown[]) => stderr.push(args.map(String).join(' '))

  try {
    const result = await fn()
    return { result, stdout: stdout.join('\n'), stderr: stderr.join('\n') }
  } finally {
    console.log = originalLog
    console.error = originalError
    console.warn = originalWarn
    console.info = originalInfo
  }
}

/**
 * Build an MCP tool from generated CLI tool data.
 */
function buildCliToolFromGenerated(
  tool: GeneratedCliTool,
  command: { command: string; run: (argv: string[]) => Promise<void> }
): McpToolDefinition {
  const inputSchema = buildSchemaFromParams(tool.parameters)

  return {
    name: tool.name,
    description: tool.description,
    inputSchema,
    requiredFeatures: ['superadmin'],
    handler: async (input: unknown, ctx: McpToolContext) => {
      // Ensure bootstrap in this module context (handles tsx module duplication)
      try {
        await ensureBootstrapInThisContext()
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'CLI tools require application bootstrap.',
        }
      }

      const argv = objectToArgv(input as Record<string, unknown>)

      if (ctx.tenantId) argv.push('--tenantId', ctx.tenantId)
      if (ctx.organizationId) argv.push('--organizationId', ctx.organizationId)

      try {
        const { stdout, stderr } = await captureConsoleOutput(() => command.run(argv))
        const output = [stdout, stderr].filter(Boolean).join('\n').trim()

        return {
          success: true,
          output: output || `Executed: mercato ${tool.moduleId} ${tool.commandName}`,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { success: false, error: message }
      }
    },
  }
}

/**
 * Convert an input object to CLI argv format.
 */
function objectToArgv(obj: Record<string, unknown>): string[] {
  const argv: string[] = []
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null || value === false) continue
    if (value === true) {
      argv.push(`--${key}`)
    } else {
      argv.push(`--${key}`, String(value))
    }
  }
  return argv
}
