import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { isSupportedLocale } from '@open-mercato/shared/lib/i18n/locale-registry'
import { resolveForcedLocale, resolveSupportedLocale } from '@open-mercato/shared/lib/i18n/locale'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { sanitizeRedirectPath } from '@open-mercato/core/modules/auth/lib/safeRedirect'
import { getAppBaseUrl } from '@open-mercato/shared/lib/url'

// Resolved per request, not at module scope: an app or tenant may register a
// locale after this module is first imported, and a snapshot taken at import
// time would reject it for the lifetime of the process.
const localeSchema = z.object({
  locale: z.string().refine(isSupportedLocale, { message: 'Unsupported locale' }),
})
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
  if (resolveForcedLocale(process.env)) {
    return NextResponse.json({ error: t('api.errors.localeForced', 'Locale is fixed by configuration') }, { status: 409 })
  }
  try {
    const { locale } = await req.json()
    // Resolve rather than merely validate: the cookie must hold the canonical
    // code the registry stores (`pt-BR` → `pt-br`, `cs-CZ` → `cs`), because
    // `detectLocale` compares it against the served set verbatim.
    const resolved = typeof locale === 'string' ? resolveSupportedLocale(locale) : null
    if (!resolved) {
      return NextResponse.json({ error: t('api.errors.invalidLocale', 'Invalid locale') }, { status: 400 })
    }
    const res = NextResponse.json({ ok: true })
    res.cookies.set('locale', resolved, { path: '/', maxAge: 60 * 60 * 24 * 365 })
    return res
  } catch {
    return NextResponse.json({ error: t('api.errors.badRequest', 'Bad request') }, { status: 400 })
  }
}

export async function GET(req: Request) {
  const { t } = await resolveTranslations()
  if (resolveForcedLocale(process.env)) {
    return NextResponse.json({ error: t('api.errors.localeForced', 'Locale is fixed by configuration') }, { status: 409 })
  }
  const url = new URL(req.url)
  const resolved = resolveSupportedLocale(url.searchParams.get('locale'))
  if (!resolved) {
    return NextResponse.json({ error: t('api.errors.invalidLocale', 'Invalid locale') }, { status: 400 })
  }
  const baseUrl = getAppBaseUrl(req)
  const safePath = sanitizeRedirectPath(url.searchParams.get('redirect'), baseUrl, '/')
  const res = NextResponse.redirect(new URL(safePath, url.origin))
  res.cookies.set('locale', resolved, { path: '/', maxAge: 60 * 60 * 24 * 365 })
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
