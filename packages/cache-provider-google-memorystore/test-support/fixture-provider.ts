import { readFileSync } from 'node:fs'
import type { ManagedAccessTokenSource } from '../src/credentials'
import { createGoogleMemorystoreProvider } from '../src/provider'

export const PREFLIGHT_CREDENTIAL_FILE_ENV = 'OM_PREFLIGHT_CREDENTIAL_FILE'
export const PREFLIGHT_REAUTH_INTERVAL_MS = 750

/**
 * Stand-in for the Google Application Default Credentials: every call re-reads a
 * credential file the preflight rotates, like a token source issuing a new
 * short-lived token. Never used outside container preflight.
 */
export function fileCredentialSource(): ManagedAccessTokenSource {
  return async () => {
    const file = process.env[PREFLIGHT_CREDENTIAL_FILE_ENV]
    if (!file) throw new Error('[internal] preflight credential file is not configured')
    const credential = JSON.parse(readFileSync(file, 'utf8')) as { username?: string; password: string }
    return { ...(credential.username !== undefined ? { username: credential.username } : {}), password: credential.password, expiresAt: null }
  }
}

export const provider = createGoogleMemorystoreProvider({
  credentialSource: () => fileCredentialSource(),
  reauthIntervalMs: PREFLIGHT_REAUTH_INTERVAL_MS,
})
