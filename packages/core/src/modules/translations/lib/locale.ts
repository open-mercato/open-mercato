import { locales } from '@open-mercato/shared/lib/i18n/config'

function readCookieFromHeader(header: string | null | undefined, name: string): string | undefined {
  if (!header) return undefined
  const parts = header.split(';')
  for (const part of parts) {
    const trimmed = part.trim()
    if (trimmed.startsWith(`${name}=`)) {
      return trimmed.slice(name.length + 1)
    }
  }
  return undefined
}

function parseAcceptLanguage(accept: string): string | null {
  const match = locales.find((l) => new RegExp(`(^|,)\\s*${l}(-|;|,|$)`, 'i').test(accept))
  return match ?? null
}

export function resolveLocaleFromRequest(request: Request): string | null {
  const url = new URL(request.url)
  const queryLocale = url.searchParams.get('locale')
  if (queryLocale && queryLocale.length >= 2 && queryLocale.length <= 10) return queryLocale

  const headerLocale = request.headers.get('x-locale')
  if (headerLocale && headerLocale.length >= 2 && headerLocale.length <= 10) return headerLocale

  const cookieHeader = request.headers.get('cookie')
  if (cookieHeader) {
    const cookieLocale = readCookieFromHeader(cookieHeader, 'locale')
    if (cookieLocale && cookieLocale.length >= 2 && cookieLocale.length <= 10) return cookieLocale
  }

  const acceptLang = request.headers.get('accept-language')
  if (acceptLang) {
    const parsed = parseAcceptLanguage(acceptLang)
    if (parsed) return parsed
  }

  return null
}
