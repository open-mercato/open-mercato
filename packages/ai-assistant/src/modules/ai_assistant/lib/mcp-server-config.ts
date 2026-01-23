import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'

// Types

/**
 * MCP server connection type.
 */
export type McpServerType = 'http' | 'stdio'

/**
 * Configuration for an external MCP server.
 */
export interface McpServerConfig {
  /** Unique identifier */
  id: string
  /** User-defined name */
  name: string
  /** Connection type */
  type: McpServerType
  /** Server URL (for HTTP type) */
  url?: string
  /** Command to run (for stdio type) */
  command?: string
  /** Command arguments (for stdio type) */
  args?: string[]
  /** API key for authentication (stored as reference, not the actual secret) */
  apiKeyId?: string
  /** Whether the server is enabled */
  enabled: boolean
  /** When the config was created */
  createdAt: string
  /** When the config was last updated */
  updatedAt: string
}

/**
 * Input for creating a new MCP server config.
 */
export type McpServerConfigInput = Omit<McpServerConfig, 'id' | 'createdAt' | 'updatedAt'>

/**
 * Input for updating an MCP server config.
 */
export type McpServerConfigUpdate = Partial<Omit<McpServerConfig, 'id' | 'createdAt' | 'updatedAt'>>

// Constants

export const MCP_SERVERS_CONFIG_KEY = 'mcp_servers'

// Resolver type

type Resolver = {
  resolve: <T = unknown>(name: string) => T
}

// Config functions

/**
 * Get all MCP server configurations.
 */
export async function getMcpServerConfigs(
  resolver: Resolver
): Promise<McpServerConfig[]> {
  let service: ModuleConfigService
  try {
    service = resolver.resolve<ModuleConfigService>('moduleConfigService')
  } catch {
    return []
  }

  try {
    const value = await service.getValue<McpServerConfig[]>(
      'ai_assistant',
      MCP_SERVERS_CONFIG_KEY,
      { defaultValue: [] }
    )
    return value ?? []
  } catch {
    return []
  }
}

/**
 * Get a single MCP server configuration by ID.
 */
export async function getMcpServerConfig(
  resolver: Resolver,
  serverId: string
): Promise<McpServerConfig | null> {
  const configs = await getMcpServerConfigs(resolver)
  return configs.find((c) => c.id === serverId) ?? null
}

/**
 * Get only enabled MCP server configurations.
 */
export async function getEnabledMcpServerConfigs(
  resolver: Resolver
): Promise<McpServerConfig[]> {
  const configs = await getMcpServerConfigs(resolver)
  return configs.filter((c) => c.enabled)
}

/**
 * Save an MCP server configuration (create or update).
 */
export async function saveMcpServerConfig(
  resolver: Resolver,
  config: McpServerConfigInput & { id?: string }
): Promise<McpServerConfig> {
  let service: ModuleConfigService
  try {
    service = resolver.resolve<ModuleConfigService>('moduleConfigService')
  } catch {
    throw new Error('Configuration service unavailable')
  }

  const configs = await getMcpServerConfigs(resolver)
  const now = new Date().toISOString()

  let updatedConfigs: McpServerConfig[]
  let savedConfig: McpServerConfig

  if (config.id) {
    // Update existing
    const existingIndex = configs.findIndex((c) => c.id === config.id)
    if (existingIndex === -1) {
      throw new Error(`MCP server config not found: ${config.id}`)
    }

    savedConfig = {
      ...configs[existingIndex],
      ...config,
      id: config.id,
      updatedAt: now,
    }

    updatedConfigs = [
      ...configs.slice(0, existingIndex),
      savedConfig,
      ...configs.slice(existingIndex + 1),
    ]
  } else {
    // Create new
    savedConfig = {
      ...config,
      id: generateId(),
      createdAt: now,
      updatedAt: now,
    }

    updatedConfigs = [...configs, savedConfig]
  }

  await service.setValue('ai_assistant', MCP_SERVERS_CONFIG_KEY, updatedConfigs)
  return savedConfig
}

/**
 * Update an existing MCP server configuration.
 */
export async function updateMcpServerConfig(
  resolver: Resolver,
  serverId: string,
  updates: McpServerConfigUpdate
): Promise<McpServerConfig> {
  let service: ModuleConfigService
  try {
    service = resolver.resolve<ModuleConfigService>('moduleConfigService')
  } catch {
    throw new Error('Configuration service unavailable')
  }

  const configs = await getMcpServerConfigs(resolver)
  const existingIndex = configs.findIndex((c) => c.id === serverId)

  if (existingIndex === -1) {
    throw new Error(`MCP server config not found: ${serverId}`)
  }

  const updatedConfig: McpServerConfig = {
    ...configs[existingIndex],
    ...updates,
    id: serverId, // Ensure ID is preserved
    updatedAt: new Date().toISOString(),
  }

  const updatedConfigs = [
    ...configs.slice(0, existingIndex),
    updatedConfig,
    ...configs.slice(existingIndex + 1),
  ]

  await service.setValue('ai_assistant', MCP_SERVERS_CONFIG_KEY, updatedConfigs)
  return updatedConfig
}

/**
 * Delete an MCP server configuration.
 */
export async function deleteMcpServerConfig(
  resolver: Resolver,
  serverId: string
): Promise<boolean> {
  let service: ModuleConfigService
  try {
    service = resolver.resolve<ModuleConfigService>('moduleConfigService')
  } catch {
    throw new Error('Configuration service unavailable')
  }

  const configs = await getMcpServerConfigs(resolver)
  const existingIndex = configs.findIndex((c) => c.id === serverId)

  if (existingIndex === -1) {
    return false
  }

  const updatedConfigs = [
    ...configs.slice(0, existingIndex),
    ...configs.slice(existingIndex + 1),
  ]

  await service.setValue('ai_assistant', MCP_SERVERS_CONFIG_KEY, updatedConfigs)
  return true
}

/**
 * Toggle the enabled state of an MCP server configuration.
 */
export async function toggleMcpServerEnabled(
  resolver: Resolver,
  serverId: string
): Promise<McpServerConfig> {
  const config = await getMcpServerConfig(resolver, serverId)
  if (!config) {
    throw new Error(`MCP server config not found: ${serverId}`)
  }

  return updateMcpServerConfig(resolver, serverId, {
    enabled: !config.enabled,
  })
}

// Helpers

/**
 * Generate a unique ID for a new MCP server config.
 */
function generateId(): string {
  return `mcp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Validate an MCP server configuration.
 */
export function validateMcpServerConfig(
  config: McpServerConfigInput
): { valid: boolean; error?: string } {
  if (!config.name?.trim()) {
    return { valid: false, error: 'Name is required' }
  }

  if (!['http', 'stdio'].includes(config.type)) {
    return { valid: false, error: 'Type must be "http" or "stdio"' }
  }

  if (config.type === 'http') {
    if (!config.url?.trim()) {
      return { valid: false, error: 'URL is required for HTTP servers' }
    }

    try {
      new URL(config.url)
    } catch {
      return { valid: false, error: 'Invalid URL format' }
    }
  }

  if (config.type === 'stdio') {
    if (!config.command?.trim()) {
      return { valid: false, error: 'Command is required for stdio servers' }
    }
  }

  return { valid: true }
}
