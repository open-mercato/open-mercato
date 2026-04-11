export const INVITE_TOKEN_TTL_MS = 48 * 60 * 60 * 1000

export function resolveInviteBaseUrl(requestUrl?: string): string {
  const appUrl = process.env.APP_URL
  if (appUrl) return appUrl.replace(/\/$/, '')

  if (requestUrl) {
    const url = new URL(requestUrl)
    return `${url.protocol}//${url.host}`
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('APP_URL environment variable must be set in production')
  }

  return 'http://localhost:3000'
}
