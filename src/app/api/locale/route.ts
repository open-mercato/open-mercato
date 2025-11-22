import { NextResponse } from 'next/server'
import { locales, type Locale } from '@open-mercato/shared/lib/i18n/config'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

const supportedLocales = new Set<Locale>(locales)

export async function POST(req: Request) {
  const { t } = await resolveTranslations()
  try {
    const { locale } = await req.json()
    if (typeof locale !== 'string' || !supportedLocales.has(locale as Locale)) {
      return NextResponse.json({ error: t('api.errors.invalidLocale', 'Invalid locale') }, { status: 400 })
    }
    const res = NextResponse.json({ ok: true })
    res.cookies.set('locale', locale as Locale, { path: '/', maxAge: 60 * 60 * 24 * 365 })
    return res
  } catch {
    return NextResponse.json({ error: t('api.errors.badRequest', 'Bad request') }, { status: 400 })
  }
}

export async function GET(req: Request) {
  const { t } = await resolveTranslations()
  const url = new URL(req.url)
  const locale = url.searchParams.get('locale')
  if (!locale || !supportedLocales.has(locale as Locale)) {
    return NextResponse.json({ error: t('api.errors.invalidLocale', 'Invalid locale') }, { status: 400 })
  }
  const res = NextResponse.redirect(url.searchParams.get('redirect') || '/')
  res.cookies.set('locale', locale as Locale, { path: '/', maxAge: 60 * 60 * 24 * 365 })
  return res
}
