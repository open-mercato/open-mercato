import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createRequestContainer } from '@/lib/di/container'
import { sidebarPreferencesInputSchema } from '../../data/validators'
import { loadSidebarPreference, saveSidebarPreference } from '../../services/sidebarPreferencesService'
import { SIDEBAR_PREFERENCES_VERSION } from '@open-mercato/shared/modules/navigation/sidebarPreferences'

export const metadata = {
  GET: { requireAuth: true },
  PUT: { requireAuth: true },
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { locale } = await resolveTranslations()
  const { resolve } = await createRequestContainer()
  const em = resolve('em') as any

  const settings = await loadSidebarPreference(em, {
    userId: auth.sub,
    tenantId: auth.tenantId ?? null,
    organizationId: auth.orgId ?? null,
    locale,
  })

  return NextResponse.json({
    locale,
    settings: {
      version: settings.version ?? SIDEBAR_PREFERENCES_VERSION,
      groupOrder: settings.groupOrder ?? [],
      groupLabels: settings.groupLabels ?? {},
      itemLabels: settings.itemLabels ?? {},
    },
  })
}

export async function PUT(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let parsedBody: unknown
  try {
    parsedBody = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = sidebarPreferencesInputSchema.safeParse(parsedBody)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 400 })
  }

  const sanitizeRecord = (record?: Record<string, string>) => {
    if (!record) return {}
    const result: Record<string, string> = {}
    for (const [key, value] of Object.entries(record)) {
      const trimmedKey = key.trim()
      const trimmedValue = value.trim()
      if (!trimmedKey || !trimmedValue) continue
      result[trimmedKey] = trimmedValue
    }
    return result
  }

  const groupOrderSource = parsed.data.groupOrder ?? []
  const seen = new Set<string>()
  const groupOrder: string[] = []
  for (const id of groupOrderSource) {
    const trimmed = id.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    groupOrder.push(trimmed)
  }

  const payload = {
    version: parsed.data.version ?? SIDEBAR_PREFERENCES_VERSION,
    groupOrder,
    groupLabels: sanitizeRecord(parsed.data.groupLabels),
    itemLabels: sanitizeRecord(parsed.data.itemLabels),
  }

  const { locale } = await resolveTranslations()
  const container = await createRequestContainer()
  const em = container.resolve('em') as any
  const cache = container.resolve('cache') as { deleteByTags?: (tags: string[]) => Promise<unknown> } | undefined

  const settings = await saveSidebarPreference(em, {
    userId: auth.sub,
    tenantId: auth.tenantId ?? null,
    organizationId: auth.orgId ?? null,
    locale,
  }, payload)

  if (cache?.deleteByTags) {
    const tags = [
      `nav:sidebar:user:${auth.sub}`,
      `nav:sidebar:scope:${auth.sub}:${auth.tenantId ?? 'null'}:${auth.orgId ?? 'null'}:${locale}`,
    ]
    try {
      await cache.deleteByTags(tags)
    } catch {}
  }

  return NextResponse.json({
    locale,
    settings,
  })
}
