export const SECURITY_PROFILE_PATH = '/backend/profile/security'
export const LEGACY_CHANGE_PASSWORD_PATH = '/backend/profile/change-password'

const LEGACY_PROFILE_REDIRECTS = new Map<string, string>([
  ['/backend/profile', SECURITY_PROFILE_PATH],
  [LEGACY_CHANGE_PASSWORD_PATH, SECURITY_PROFILE_PATH],
  ['/backend/auth/profile', SECURITY_PROFILE_PATH],
])

function normalizePathname(pathname: string): string {
  if (!pathname) return pathname
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return pathname.slice(0, -1)
  }
  return pathname
}

export function resolveLegacyProfilePasswordRedirect(pathname: string): string | null {
  return LEGACY_PROFILE_REDIRECTS.get(normalizePathname(pathname)) ?? null
}

export function isLegacySelfPasswordChangeAttempt(
  input: unknown,
  userId: string | null | undefined,
): boolean {
  if (!userId || !input || typeof input !== 'object') return false

  const candidate = input as { id?: unknown; password?: unknown }
  if (candidate.id !== userId) return false
  if (typeof candidate.password !== 'string') return false

  return candidate.password.trim().length > 0
}
