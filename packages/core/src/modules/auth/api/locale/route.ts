import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { locales, type Locale } from '@open-mercato/shared/lib/i18n/config'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { sanitizeRedirectPath } from '@open-mercato/core/modules/auth/lib/safeRedirect'
import { getAppBaseUrl } from '@open-mercato/shared/lib/url'

const supportedLocales = new Set<Locale>(locales)
const localeSchema = z.object({ locale: z.enum(locales as [Locale, ...Locale[]]) })
const localeQuerySchema = localeSchema.extend({
  redirect: z.string().optional(),
})
const localeResponseSchema = z.object({ ok: z.boolean() })
const localeErrorSchema = z.object({ error: z.string() })

export const metadata = {
  GET: { requireAuth: false },
  POST: { requireAuth: false },
}

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
  const baseUrl = getAppBaseUrl(req)
  const safePath = sanitizeRedirectPath(url.searchParams.get('redirect'), baseUrl, '/')
  const res = NextResponse.redirect(new URL(safePath, url.origin))
  res.cookies.set('locale', locale as Locale, { path: '/', maxAge: 60 * 60 * 24 * 365 })
  return res
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Authentication & Accounts',
  summary: 'Locale preference',
  methods: {
    GET: {
      summary: 'Set locale and redirect',
      description: 'Stores the selected locale in a cookie and redirects to a safe local path.',
      query: localeQuerySchema,
      responses: [
        { status: 302, description: 'Locale cookie set and request redirected' },
        { status: 400, description: 'Invalid locale', schema: localeErrorSchema },
      ],
    },
    POST: {
      summary: 'Set locale',
      description: 'Stores the selected locale in a cookie and returns a JSON success response.',
      requestBody: {
        contentType: 'application/json',
        schema: localeSchema,
      },
      responses: [
        { status: 200, description: 'Locale cookie set', schema: localeResponseSchema },
        { status: 400, description: 'Invalid locale or malformed request body', schema: localeErrorSchema },
      ],
    },
  },
}
