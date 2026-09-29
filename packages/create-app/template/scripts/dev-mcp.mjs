import path from 'node:path'

export const MCP_DEFAULT_PORT = 3001
export const MCP_MAX_FAST_CRASHES = 5
export const MCP_FAST_CRASH_UPTIME_MS = 60_000
export const MCP_HEALTH_TIMEOUT_MS = 180_000
export const MCP_HEALTH_POLL_INTERVAL_MS = 2_000

const ENABLED_TOKENS = ['1', 'true', 'yes', 'on']
const DISABLED_TOKENS = ['0', 'false', 'no', 'off']

// The MCP server runs by default with every dev runtime except the explicit
// app-only mode. CLI flags win over OM_DEV_WITH_MCP; an unrecognized env token
// falls back to the default (on) rather than silently disabling the server.
export function shouldStartMcp({ args = [], env = {}, appOnly = false } = {}) {
  if (appOnly) return false
  if (args.includes('--no-mcp')) return false
  if (args.includes('--with-mcp')) return true
  const raw = env.OM_DEV_WITH_MCP
  if (typeof raw === 'string' && raw.trim() !== '') {
    const token = raw.trim().toLowerCase()
    if (DISABLED_TOKENS.includes(token)) return false
    if (ENABLED_TOKENS.includes(token)) return true
  }
  return true
}

export function resolveMcpPort(env = {}) {
  const raw = typeof env.MCP_PORT === 'string' ? env.MCP_PORT.trim() : ''
  if (!raw) return MCP_DEFAULT_PORT
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) return MCP_DEFAULT_PORT
  return parsed
}

// The key file is shared with the OpenCode container via a bind mount
// (compose.infra.yml mounts .mercato/mcp-shared read-only at /run/mcp-shared),
// so the default must stay in sync with that compose file.
export function resolveMcpKeyFilePath(env = {}, cwd = process.cwd()) {
  const override = typeof env.MCP_SERVER_API_KEY_FILE === 'string' ? env.MCP_SERVER_API_KEY_FILE.trim() : ''
  if (override) return path.resolve(cwd, override)
  return path.join(cwd, '.mercato', 'mcp-shared', 'mcp-api-key')
}

export function nextMcpRestartDelayMs(attempt) {
  const normalized = Number.isInteger(attempt) && attempt > 0 ? attempt : 0
  return Math.min(5_000 * 2 ** normalized, 60_000)
}

export function nextMcpKeyRetryDelayMs(attempt) {
  const normalized = Number.isInteger(attempt) && attempt > 0 ? attempt : 0
  return Math.min(30_000 * 2 ** normalized, 120_000)
}

export function isFastMcpCrash(uptimeMs) {
  return typeof uptimeMs === 'number' && uptimeMs >= 0 && uptimeMs < MCP_FAST_CRASH_UPTIME_MS
}

export function buildMcpCliArgs(subcommandArgs, { isMonorepo = true } = {}) {
  const prefix = isMonorepo
    ? ['workspace', '@open-mercato/app', 'mercato', 'ai_assistant']
    : ['mercato', 'ai_assistant']
  return [...prefix, ...subcommandArgs]
}

export function deriveMcpHealthUrl(port) {
  return `http://localhost:${port}/health`
}

export function looksLikePermissionError(outputLines = []) {
  return outputLines.some((line) => /EACCES|EPERM|permission denied/i.test(String(line)))
}

export function looksLikeUninitializedDatabase(outputLines = []) {
  return outputLines.some((line) =>
    /relation .* does not exist|database .* does not exist|ECONNREFUSED/i.test(String(line)),
  )
}

// `mcp:ensure-api-key` resolves the key's owner by the superadmin email in the
// null-tenant scope and throws when no user matches — the app is up but the DB
// was seeded under a different admin email or a different LOOKUP_HASH_PEPPER.
export function looksLikeMissingKeyOwner(outputLines = []) {
  return outputLines.some((line) =>
    /MCP API key owner not found|no active user with email|Run "?mercato init"?/i.test(String(line)),
  )
}

export function isKeyRotationOutput(outputLines = []) {
  return outputLines.some((line) => String(line).includes('New key created'))
}
