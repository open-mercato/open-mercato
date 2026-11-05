import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export function railwayTokenConfigPath(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === 'win32') {
    return join(environment.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'open-mercato', 'railway.json')
  }
  return join(environment.XDG_CONFIG_HOME || join(homedir(), '.config'), 'open-mercato', 'railway.json')
}

export function readCachedRailwayToken(path: string, platform: NodeJS.Platform = process.platform): string | null {
  if (!existsSync(path)) return null
  if (platform !== 'win32') {
    const mode = statSync(path).mode & 0o777
    if ((mode & 0o077) !== 0) {
      throw new Error(`Refusing to read ${path}: permissions must be 0600.`)
    }
  }
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (!parsed || typeof parsed !== 'object') return null
  const token = (parsed as Record<string, unknown>).token
  return typeof token === 'string' && token.trim() ? token.trim() : null
}

export function writeCachedRailwayToken(path: string, token: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify({ token }, null, 2)}\n`, { mode: 0o600 })
  if (process.platform !== 'win32') chmodSync(path, 0o600)
}

export function resolveRailwayToken(input: {
  flagToken?: string
  environment?: NodeJS.ProcessEnv
  configPath?: string
}): { token: string | null; source: 'flag' | 'environment' | 'cache' | null } {
  const environment = input.environment ?? process.env
  if (input.flagToken?.trim()) return { token: input.flagToken.trim(), source: 'flag' }
  if (environment.RAILWAY_API_TOKEN?.trim()) {
    return { token: environment.RAILWAY_API_TOKEN.trim(), source: 'environment' }
  }
  const configPath = input.configPath ?? railwayTokenConfigPath(environment)
  const cached = readCachedRailwayToken(configPath)
  if (cached) return { token: cached, source: 'cache' }
  return { token: null, source: null }
}
