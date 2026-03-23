import type { MfaProviderSetup } from './mfa-provider-interface'

export type SecuritySudoTarget = {
  identifier: string
  label?: string
  ttlSeconds?: number
  challengeMethod?: 'auto' | 'password' | 'mfa'
}

export type SecurityMfaProviderEntry = {
  moduleId: string
  providers: unknown[]
}

export type SecuritySudoTargetEntry = {
  moduleId: string
  targets: SecuritySudoTarget[]
}

const MFA_GLOBAL_KEY = '__openMercatoSecurityMfaProviderEntries__'
const SUDO_GLOBAL_KEY = '__openMercatoSecuritySudoTargetEntries__'

function readGlobalEntries<T>(key: string): T[] | null {
  try {
    const value = (globalThis as Record<string, unknown>)[key]
    return Array.isArray(value) ? (value as T[]) : null
  } catch {
    return null
  }
}

function writeGlobalEntries<T>(key: string, entries: T[]): void {
  try {
    ;(globalThis as Record<string, unknown>)[key] = entries
  } catch {
    // ignore global assignment failures
  }
}

export function registerSecurityMfaProviderEntries(entries: SecurityMfaProviderEntry[]): void {
  writeGlobalEntries(MFA_GLOBAL_KEY, entries)
}

export function registerSecuritySudoTargetEntries(entries: SecuritySudoTargetEntry[]): void {
  writeGlobalEntries(SUDO_GLOBAL_KEY, entries)
}

export function getSecurityMfaProviderEntries(): SecurityMfaProviderEntry[] {
  return readGlobalEntries<SecurityMfaProviderEntry>(MFA_GLOBAL_KEY) ?? []
}

export function getSecuritySudoTargetEntries(): SecuritySudoTargetEntry[] {
  return readGlobalEntries<SecuritySudoTargetEntry>(SUDO_GLOBAL_KEY) ?? []
}

export function dedupeMfaProviders(providers: unknown[]): MfaProviderSetup[] {
  const seen = new Set<string>()
  const deduped: MfaProviderSetup[] = []

  for (const provider of providers) {
    if (!provider || typeof provider !== 'object') continue
    const type = (provider as { type?: unknown }).type
    if (typeof type !== 'string' || seen.has(type)) continue
    seen.add(type)
    deduped.push(provider as MfaProviderSetup)
  }

  return deduped
}

export function dedupeSudoTargets(targets: SecuritySudoTarget[]): SecuritySudoTarget[] {
  const seen = new Set<string>()
  const deduped: SecuritySudoTarget[] = []

  for (const target of targets) {
    const key = target.identifier
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(target)
  }

  return deduped
}
