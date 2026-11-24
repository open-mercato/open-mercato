import type { RespClient } from './client'
import { isClusterClient } from './cluster'

export type RespServerEngine = 'valkey' | 'redis' | 'keydb' | 'unknown'

export type RespServerInfo = {
  engine: RespServerEngine
  version: string | null
}

export function parseRespServerInfo(info: string): RespServerInfo {
  const fields = new Map<string, string>()
  for (const line of info.split(/\r?\n/)) {
    const separator = line.indexOf(':')
    if (separator <= 0 || line.startsWith('#')) continue
    fields.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim())
  }
  const serverName = (fields.get('server_name') ?? '').toLowerCase()
  if (fields.has('valkey_version') || serverName === 'valkey') {
    return { engine: 'valkey', version: fields.get('valkey_version') ?? fields.get('redis_version') ?? null }
  }
  if (serverName === 'keydb' || fields.has('keydb_version') || /keydb/i.test(fields.get('executable') ?? '')) {
    return { engine: 'keydb', version: fields.get('keydb_version') ?? fields.get('redis_version') ?? null }
  }
  if (fields.has('redis_version')) return { engine: 'redis', version: fields.get('redis_version') ?? null }
  return { engine: 'unknown', version: null }
}

/**
 * Best-effort server identification through `INFO server`. Returns `null` when
 * the ACL user may not run INFO (it belongs to the `@dangerous` category).
 */
export async function detectRespServer(client: RespClient): Promise<RespServerInfo | null> {
  try {
    const target = isClusterClient(client) ? client.nodes('master')[0] : client
    if (!target) return null
    return parseRespServerInfo(await target.info('server'))
  } catch {
    return null
  }
}
