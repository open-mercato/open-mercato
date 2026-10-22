import { parseBooleanFromUnknown, parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { parseCommaSeparatedList } from '@open-mercato/shared/lib/string'
import { hasRequiredFeatures } from './auth'

export type McpMutationMode = 'direct' | 'deny' | 'approval'

export type McpExposureConfig = {
  allow: string[] | null
  deny: string[]
  mutationMode: McpMutationMode
  includeAgentTools: boolean
}

export type McpExposableTool = {
  name: string
  requiredFeatures?: string[]
  isMutation?: boolean
}

export type McpExposureCaller = {
  features: string[]
  isSuperAdmin: boolean
}

type McpExposureEnv = Record<string, string | undefined>

const MUTATION_MODES: readonly McpMutationMode[] = ['direct', 'deny', 'approval']

export const DEFAULT_MCP_EXPOSURE_CONFIG: Readonly<McpExposureConfig> = Object.freeze({
  allow: null,
  deny: [],
  mutationMode: 'direct',
  includeAgentTools: true,
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readCliValue(cliArgs: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (cliArgs[key] !== undefined) return cliArgs[key]
  }
  return undefined
}

function readCliList(cliArgs: Record<string, unknown>, keys: string[]): string[] | undefined {
  const raw = readCliValue(cliArgs, keys)
  if (typeof raw !== 'string') return undefined
  return parseCommaSeparatedList(raw)
}

function readEnvList(env: McpExposureEnv, key: string): string[] | undefined {
  const raw = env[key]
  if (typeof raw !== 'string' || !raw.trim()) return undefined
  return parseCommaSeparatedList(raw)
}

function parseMutationMode(raw: unknown): McpMutationMode | undefined {
  if (typeof raw !== 'string') return undefined
  const normalized = raw.trim().toLowerCase()
  if (!normalized) return undefined
  const match = MUTATION_MODES.find((mode) => mode === normalized)
  return match ?? 'direct'
}

function resolveIncludeAgentTools(env: McpExposureEnv, cliArgs: Record<string, unknown>): boolean {
  const noAgentTools = parseBooleanFromUnknown(readCliValue(cliArgs, ['no-agent-tools', 'noAgentTools']))
  if (noAgentTools !== null) return !noAgentTools
  return parseBooleanWithDefault(env.OM_MCP_AGENT_TOOLS, DEFAULT_MCP_EXPOSURE_CONFIG.includeAgentTools)
}

export function resolveMcpExposureConfig(
  env: McpExposureEnv,
  cliArgs: Record<string, unknown> = {},
): McpExposureConfig {
  const allow =
    readCliList(cliArgs, ['tools']) ??
    readEnvList(env, 'OM_MCP_TOOL_ALLOWLIST') ??
    DEFAULT_MCP_EXPOSURE_CONFIG.allow
  const deny =
    readCliList(cliArgs, ['exclude-tools', 'excludeTools']) ??
    readEnvList(env, 'OM_MCP_TOOL_DENYLIST') ??
    [...DEFAULT_MCP_EXPOSURE_CONFIG.deny]
  const mutationMode =
    parseMutationMode(readCliValue(cliArgs, ['mutation-mode', 'mutationMode'])) ??
    parseMutationMode(env.OM_MCP_MUTATION_MODE) ??
    DEFAULT_MCP_EXPOSURE_CONFIG.mutationMode
  return {
    allow,
    deny,
    mutationMode,
    includeAgentTools: resolveIncludeAgentTools(env, cliArgs),
  }
}

export function matchesToolPattern(toolName: string, pattern: string): boolean {
  if (pattern.endsWith('*')) return toolName.startsWith(pattern.slice(0, -1))
  return toolName === pattern
}

function matchesAnyPattern(toolName: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchesToolPattern(toolName, pattern))
}

function isMcpExposeDisabled(tool: McpExposableTool): boolean {
  const mcp: unknown = Reflect.get(tool, 'mcp')
  return isRecord(mcp) && mcp.expose === false
}

function hasAgentRef(tool: McpExposableTool): boolean {
  const agentRef: unknown = Reflect.get(tool, 'agentRef')
  return agentRef !== undefined && agentRef !== null && agentRef !== ''
}

export function isToolExposed(tool: McpExposableTool, config: McpExposureConfig): boolean {
  if (isMcpExposeDisabled(tool)) return false
  if (config.allow !== null && !matchesAnyPattern(tool.name, config.allow)) return false
  if (matchesAnyPattern(tool.name, config.deny)) return false
  if (config.mutationMode === 'deny' && tool.isMutation === true) return false
  if (!config.includeAgentTools && hasAgentRef(tool)) return false
  return true
}

export function filterToolsForCaller<TTool extends McpExposableTool>(
  tools: TTool[],
  config: McpExposureConfig,
  caller: McpExposureCaller,
): TTool[] {
  return tools.filter(
    (tool) =>
      isToolExposed(tool, config) &&
      hasRequiredFeatures(tool.requiredFeatures, caller.features, caller.isSuperAdmin),
  )
}
