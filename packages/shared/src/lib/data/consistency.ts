import { parseBooleanWithDefault } from '../boolean'

let alwaysConsistentFlag: boolean | null = null

export function parseAlwaysConsistentEnv(raw: string | undefined | null): boolean {
  return parseBooleanWithDefault(raw, false)
}

export function isReadProjectionAlwaysConsistent(): boolean {
  if (alwaysConsistentFlag !== null) return alwaysConsistentFlag
  alwaysConsistentFlag = parseAlwaysConsistentEnv(process.env.OM_CACHE_SAFETY_ALWAYS_CONSISTENT)
  return alwaysConsistentFlag
}

export function __resetAlwaysConsistentCacheForTests(): void {
  alwaysConsistentFlag = null
}
