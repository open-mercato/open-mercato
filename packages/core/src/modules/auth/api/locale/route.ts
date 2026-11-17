import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  isSupportedLocale,
  resolveSupportedLocalesForRequest,
} from '@open-mercato/shared/lib/i18n/locale-registry'
import { resolveForcedLocale, resolveSupportedLocale } from '@open-mercato/shared/lib/i18n/locale'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { sanitizeRedirectPath } from '@open-mercato/core/modules/auth/lib/safeRedirect'
import { getAppBaseUrl } from '@open-mercato/shared/lib/url'

// Resolved per request, not at module scope: an app or tenant may register a
// locale after this module is first imported, and a snapshot taken at import
// time would reject it for the lifetime of the process.
//
// This costs the generated OpenAPI its `enum` of valid values, which a closed
// `z.enum(locales)` used to give for free. That is the honest documentation now
// rather than a regression: the accepted set is per-tenant (see
// `resolveLocaleForRequest` below), so any static list published in a spec
// shared by every tenant would be wrong for most of them. The description points
// at the endpoint that answers the question for the caller's own tenant.
const localeSchema = z.object({
  locale: z
    .string()
    .refine(isSupportedLocale, { message: 'Unsupported locale' })
    .describe('A locale code this tenant serves — one of the `servable` entries returned by `GET /api/translations/locales`. Codes are canonicalized (`de-AT` → `de`).'),
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

// Both handlers write the `locale` cookie, and `detectLocale` later reads it back
// against the *request's* served set — the tenant's selection, not the
// process-wide registry. Validating against the wider set would make a locale the
// tenant has not selected return 200 (or 302) and set a year-long cookie that
// every subsequent render silently discards, so the caller is told the change
// took effect and nothing ever changes.
async function resolveLocaleForRequest(value: unknown) {
  if (typeof value !== 'string') return null
  // Resolve rather than merely validate: the cookie must hold the canonical
  // code the registry stores (`pt-BR` → `pt-br`, `cs-CZ` → `cs`), because
  // `detectLocale` compares it against the served set verbatim.
  return resolveSupportedLocale(value, await resolveSupportedLocalesForRequest())
}

export async function POST(req: Request) {
  const { t } = await resolveTranslations()
  if (resolveForcedLocale(process.env)) {
    return NextResponse.json({ error: t('api.errors.localeForced', 'Locale is fixed by configuration') }, { status: 409 })
  }
  try {
    const { locale } = await req.json()
    const resolved = await resolveLocaleForRequest(locale)
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
  const resolved = await resolveLocaleForRequest(url.searchParams.get('locale'))
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
