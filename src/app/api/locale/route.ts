import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  try {
    const { locale } = await req.json()
    if (locale !== 'en' && locale !== 'pl') {
      return NextResponse.json({ error: 'invalid locale' }, { status: 400 })
    }
    const res = NextResponse.json({ ok: true })
    res.cookies.set('locale', locale, { path: '/', maxAge: 60 * 60 * 24 * 365 })
    return res
  } catch (e) {
    return NextResponse.json({ error: 'bad request' }, { status: 400 })
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const locale = url.searchParams.get('locale')
  if (locale !== 'en' && locale !== 'pl') {
    return NextResponse.json({ error: 'invalid locale' }, { status: 400 })
  }
  const res = NextResponse.redirect(url.searchParams.get('redirect') || '/')
  res.cookies.set('locale', locale, { path: '/', maxAge: 60 * 60 * 24 * 365 })
  return res
}

