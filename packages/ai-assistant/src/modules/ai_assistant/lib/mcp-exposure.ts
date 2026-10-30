import { parseBooleanFromUnknown, parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { parseCommaSeparatedList } from '@open-mercato/shared/lib/string'
import { hasRequiredFeatures } from './auth'
import type { AiToolAgentRef, AiToolMcpOptions } from './types'

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
  mcp?: AiToolMcpOptions
  agentRef?: AiToolAgentRef
}

export type McpExposureCaller = {
  features: string[]
  isSuperAdmin: boolean
}

type McpExposureEnv = Record<string, string | undefined>

export const MCP_MUTATION_MODES: readonly McpMutationMode[] = ['direct', 'deny', 'approval']

export function isMcpMutationMode(value: unknown): value is McpMutationMode {
  return typeof value === 'string' && MCP_MUTATION_MODES.some((mode) => mode === value)
}

export const DEFAULT_MCP_EXPOSURE_CONFIG: Readonly<McpExposureConfig> = Object.freeze({
  allow: null,
  deny: [],
  mutationMode: 'direct',
  includeAgentTools: true,
})

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
  return isMcpMutationMode(normalized) ? normalized : 'direct'
}

export function collectMcpExposureWarnings(env: McpExposureEnv): string[] {
  const raw = env.OM_MCP_MUTATION_MODE
  if (typeof raw !== 'string') return []
  const normalized = raw.trim().toLowerCase()
  if (!normalized || isMcpMutationMode(normalized)) return []
  return [
    `Invalid OM_MCP_MUTATION_MODE "${raw}"; falling back to "direct". Allowed values: ${MCP_MUTATION_MODES.join(', ')}.`,
  ]
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

export function isRefusedInApprovalMode(tool: McpExposableTool, mutationMode: McpMutationMode): boolean {
  return mutationMode === 'approval' && tool.isMutation === true && tool.mcp?.approvalMode === 'refuse'
}

export type McpToolHiddenReason =
  | 'expose_false'
  | 'not_allowlisted'
  | 'denylist'
  | 'mutation_mode'
  | 'agent_tools_off'

export function resolveToolHiddenReason(
  tool: McpExposableTool,
  config: McpExposureConfig,
): McpToolHiddenReason | null {
  if (tool.mcp?.expose === false) return 'expose_false'
  if (config.allow !== null && !matchesAnyPattern(tool.name, config.allow)) return 'not_allowlisted'
  if (matchesAnyPattern(tool.name, config.deny)) return 'denylist'
  if (config.mutationMode === 'deny' && tool.isMutation === true) return 'mutation_mode'
  if (isRefusedInApprovalMode(tool, config.mutationMode)) return 'mutation_mode'
  if (!config.includeAgentTools && tool.agentRef) return 'agent_tools_off'
  return null
}

export function isToolExposed(tool: McpExposableTool, config: McpExposureConfig): boolean {
  return resolveToolHiddenReason(tool, config) === null
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

export type McpExposureDescription = {
  allowlist: string | null
  denylist: string
  mutationMode: McpMutationMode
  includeAgentTools: boolean
  exposedToolCount: number
}

export function describeMcpExposureConfig(
  config: McpExposureConfig,
  tools: McpExposableTool[],
): McpExposureDescription {
  return {
    allowlist: config.allow ? config.allow.join(',') : null,
    denylist: config.deny.join(','),
    mutationMode: config.mutationMode,
    includeAgentTools: config.includeAgentTools,
    exposedToolCount: tools.filter((tool) => isToolExposed(tool, config)).length,
  }
}

export function listExposedMutationToolNames(
  config: McpExposureConfig,
  tools: McpExposableTool[],
): string[] {
  return tools
    .filter((tool) => tool.isMutation === true && isToolExposed(tool, config))
    .map((tool) => tool.name)
    .sort((left, right) => left.localeCompare(right))
}

export function buildDirectMutationModeWarning(
  config: McpExposureConfig,
  tools: McpExposableTool[],
): string | null {
  if (config.mutationMode !== 'direct') return null
  const mutationToolNames = listExposedMutationToolNames(config, tools)
  if (mutationToolNames.length === 0) return null
  return `OM_MCP_MUTATION_MODE is "direct": ${mutationToolNames.length} mutation tool(s) run without approval over MCP and /tools/execute: ${mutationToolNames.join(', ')}. Set OM_MCP_MUTATION_MODE=approval to require human approval.`
}
