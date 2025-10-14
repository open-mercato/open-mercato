import { NextResponse } from 'next/server'
import { locales, type Locale } from '@open-mercato/shared/lib/i18n/config'

const supportedLocales = new Set<Locale>(locales)

export async function POST(req: Request) {
  try {
    const { locale } = await req.json()
    if (typeof locale !== 'string' || !supportedLocales.has(locale as Locale)) {
      return NextResponse.json({ error: 'invalid locale' }, { status: 400 })
    }
    const res = NextResponse.json({ ok: true })
    res.cookies.set('locale', locale as Locale, { path: '/', maxAge: 60 * 60 * 24 * 365 })
    return res
  } catch (e) {
    return NextResponse.json({ error: 'bad request' }, { status: 400 })
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const locale = url.searchParams.get('locale')
  if (!locale || !supportedLocales.has(locale as Locale)) {
    return NextResponse.json({ error: 'invalid locale' }, { status: 400 })
  }
  const res = NextResponse.redirect(url.searchParams.get('redirect') || '/')
  res.cookies.set('locale', locale as Locale, { path: '/', maxAge: 60 * 60 * 24 * 365 })
  return res
}
