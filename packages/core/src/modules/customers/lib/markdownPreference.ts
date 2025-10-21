const MARKDOWN_COOKIE = 'customers_notes_markdown'

export function writeMarkdownPreferenceCookie(enabled: boolean) {
  if (typeof document === 'undefined') return
  const expires = new Date()
  expires.setFullYear(expires.getFullYear() + 1)
  document.cookie = `${MARKDOWN_COOKIE}=${enabled ? '1' : '0'}; path=/; expires=${expires.toUTCString()}; SameSite=Lax`
}

export function readMarkdownPreferenceCookie(): boolean | null {
  if (typeof document === 'undefined') return null
  const entries = document.cookie ? document.cookie.split('; ') : []
  const match = entries.find((entry) => entry.startsWith(`${MARKDOWN_COOKIE}=`))
  if (!match) return null
  const value = match.split('=').slice(1).join('=')
  return value === '1'
}
