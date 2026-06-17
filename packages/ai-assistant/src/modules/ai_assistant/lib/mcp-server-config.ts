import { randomUUID } from 'node:crypto'
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

  const validation = validateMcpServerConfig(savedConfig)
  if (!validation.valid) {
    throw new Error(`[internal] Invalid MCP server config: ${validation.error}`)
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

  const validation = validateMcpServerConfig(updatedConfig)
  if (!validation.valid) {
    throw new Error(`[internal] Invalid MCP server config: ${validation.error}`)
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
 *
 * Uses a CSPRNG (`randomUUID`) instead of `Math.random()` so the suffix is not
 * predictable if the id ever surfaces in URLs, logs, or cache keys.
 */
function generateId(): string {
  return `mcp_${randomUUID()}`
}

const ALLOWED_MCP_URL_PROTOCOLS = new Set(['http:', 'https:'])
const BLOCKED_MCP_HOSTNAMES = new Set(['localhost', '0.0.0.0', '::', '::1'])

function parseIpv4Octets(hostname: string): number[] | null {
  const parts = hostname.split('.')
  if (parts.length !== 4) return null
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN))
  if (octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    return null
  }
  return octets
}

function isPrivateOrLocalIpv4(octets: number[]): boolean {
  const [first, second] = octets
  if (first === 0) return true // "this" network / 0.0.0.0
  if (first === 127) return true // loopback 127.0.0.0/8
  if (first === 10) return true // RFC1918 10.0.0.0/8
  if (first === 172 && second >= 16 && second <= 31) return true // RFC1918 172.16.0.0/12
  if (first === 192 && second === 168) return true // RFC1918 192.168.0.0/16
  if (first === 169 && second === 254) return true // link-local 169.254.0.0/16
  return false
}

function isPrivateOrLocalIpv6(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host === '::1' || host === '::') return true // loopback / unspecified
  if (host.startsWith('fe80')) return true // link-local fe80::/10
  if (host.startsWith('fc') || host.startsWith('fd')) return true // unique-local fc00::/7
  const ipv4MappedDotted = host.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
  if (ipv4MappedDotted) {
    const octets = parseIpv4Octets(ipv4MappedDotted[1]!)
    if (octets && isPrivateOrLocalIpv4(octets)) return true
  }
  // Node normalizes ::ffff:127.0.0.1 to its hex form (::ffff:7f00:1).
  const ipv4MappedHex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (ipv4MappedHex) {
    const high = parseInt(ipv4MappedHex[1]!, 16)
    const low = parseInt(ipv4MappedHex[2]!, 16)
    const octets = [(high >> 8) & 0xff, high & 0xff, (low >> 8) & 0xff, low & 0xff]
    if (isPrivateOrLocalIpv4(octets)) return true
  }
  return false
}

/**
 * Validate that an external MCP server URL is safe to connect to.
 *
 * Rejects non-http(s) protocols (blocking `file:`/`gopher:`/`data:` local-file
 * disclosure) and literal loopback, link-local, and RFC1918 private hosts to
 * reduce SSRF exposure. Hostnames that are not IP literals are allowed here
 * (DNS-rebinding to a private address would still need a resolution-time guard,
 * which is out of scope for this dead-code hardening).
 */
export function validateMcpServerUrl(
  rawUrl: string
): { valid: boolean; error?: string } {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return { valid: false, error: 'Invalid URL format' }
  }

  if (!ALLOWED_MCP_URL_PROTOCOLS.has(parsed.protocol)) {
    return { valid: false, error: 'URL must use the http or https protocol' }
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
  if (!hostname) {
    return { valid: false, error: 'URL host is required' }
  }

  if (BLOCKED_MCP_HOSTNAMES.has(hostname) || hostname === 'localhost' || hostname.endsWith('.localhost')) {
    return { valid: false, error: 'URL host is not allowed' }
  }

  const ipv4 = parseIpv4Octets(hostname)
  if (ipv4) {
    if (isPrivateOrLocalIpv4(ipv4)) {
      return { valid: false, error: 'URL host resolves to a private or loopback address' }
    }
  } else if (hostname.includes(':') && isPrivateOrLocalIpv6(hostname)) {
    return { valid: false, error: 'URL host resolves to a private or loopback address' }
  }

  return { valid: true }
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

    const urlCheck = validateMcpServerUrl(config.url)
    if (!urlCheck.valid) {
      return urlCheck
    }
  }

  if (config.type === 'stdio') {
    if (!config.command?.trim()) {
      return { valid: false, error: 'Command is required for stdio servers' }
    }
  }

  return { valid: true }
}
