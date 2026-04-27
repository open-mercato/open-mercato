import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { SIDEBAR_PREFERENCES_VERSION } from '@open-mercato/shared/modules/navigation/sidebarPreferences'
import {
  deleteSidebarVariant,
  loadSidebarVariant,
  updateSidebarVariant,
  type SidebarVariantRecord,
} from '../../../../services/sidebarPreferencesService'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  GET: { requireAuth: true },
  PUT: { requireAuth: true },
  DELETE: { requireAuth: true },
}

const sidebarSettingsSchema = z.object({
  version: z.number().int().positive().optional(),
  groupOrder: z.array(z.string().min(1)).max(200).optional(),
  groupLabels: z.record(z.string().min(1), z.string().min(1).max(120)).optional(),
  itemLabels: z.record(z.string().min(1), z.string().min(1).max(120)).optional(),
  hiddenItems: z.array(z.string().min(1)).max(500).optional(),
  itemOrder: z.record(z.string().min(1), z.array(z.string().min(1)).max(500)).optional(),
})

const updateVariantInputSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  settings: sidebarSettingsSchema.optional(),
  isActive: z.boolean().optional(),
})

const variantRecordSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  isActive: z.boolean(),
  settings: z.object({
    version: z.number().int().positive(),
    groupOrder: z.array(z.string()),
    groupLabels: z.record(z.string(), z.string()),
    itemLabels: z.record(z.string(), z.string()),
    hiddenItems: z.array(z.string()),
    itemOrder: z.record(z.string(), z.array(z.string())),
  }),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
})

const variantResponseSchema = z.object({
  locale: z.string(),
  variant: variantRecordSchema,
})

const deleteResponseSchema = z.object({ ok: z.literal(true) })
const errorSchema = z.object({ error: z.string() })

function serializeVariant(record: SidebarVariantRecord) {
  return {
    id: record.id,
    name: record.name,
    isActive: record.isActive,
    settings: {
      version: record.settings.version ?? SIDEBAR_PREFERENCES_VERSION,
      groupOrder: record.settings.groupOrder ?? [],
      groupLabels: record.settings.groupLabels ?? {},
      itemLabels: record.settings.itemLabels ?? {},
      hiddenItems: record.settings.hiddenItems ?? [],
      itemOrder: record.settings.itemOrder ?? {},
    },
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt ? record.updatedAt.toISOString() : null,
  }
}

function extractIdFromUrl(req: Request): string | null {
  const url = new URL(req.url)
  const segments = url.pathname.split('/').filter(Boolean)
  // .../api/auth/sidebar/variants/<id>
  return segments[segments.length - 1] || null
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const effectiveUserId = auth.isApiKey ? auth.userId : auth.sub
  if (!effectiveUserId) return NextResponse.json({ error: 'No user context' }, { status: 403 })

  const id = extractIdFromUrl(req)
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const { locale } = await resolveTranslations()
  const { resolve } = await createRequestContainer()
  const em = resolve('em') as any

  const variant = await loadSidebarVariant(em, {
    userId: effectiveUserId,
    tenantId: auth.tenantId ?? null,
    organizationId: auth.orgId ?? null,
    locale,
  }, id)

  if (!variant) return NextResponse.json({ error: 'Variant not found' }, { status: 404 })

  return NextResponse.json({ locale, variant: serializeVariant(variant) })
}

export async function PUT(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const effectiveUserId = auth.isApiKey ? auth.userId : auth.sub
  if (!effectiveUserId) return NextResponse.json({ error: 'No user context' }, { status: 403 })

  const id = extractIdFromUrl(req)
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  let parsedBody: unknown
  try {
    parsedBody = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = updateVariantInputSchema.safeParse(parsedBody)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 400 })
  }

  const { locale } = await resolveTranslations()
  const { resolve } = await createRequestContainer()
  const em = resolve('em') as any

  const variant = await updateSidebarVariant(em, {
    userId: effectiveUserId,
    tenantId: auth.tenantId ?? null,
    organizationId: auth.orgId ?? null,
    locale,
  }, id, {
    name: parsed.data.name,
    settings: (parsed.data.settings as any) ?? null,
    isActive: parsed.data.isActive,
  })

  if (!variant) return NextResponse.json({ error: 'Variant not found' }, { status: 404 })

  return NextResponse.json({ locale, variant: serializeVariant(variant) })
}

export async function DELETE(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const effectiveUserId = auth.isApiKey ? auth.userId : auth.sub
  if (!effectiveUserId) return NextResponse.json({ error: 'No user context' }, { status: 403 })

  const id = extractIdFromUrl(req)
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const { locale } = await resolveTranslations()
  const { resolve } = await createRequestContainer()
  const em = resolve('em') as any

  const ok = await deleteSidebarVariant(em, {
    userId: effectiveUserId,
    tenantId: auth.tenantId ?? null,
    organizationId: auth.orgId ?? null,
    locale,
  }, id)

  if (!ok) return NextResponse.json({ error: 'Variant not found' }, { status: 404 })

  return NextResponse.json({ ok: true })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Authentication & Accounts',
  summary: 'Sidebar variant',
  methods: {
    GET: {
      summary: 'Get a sidebar variant',
      responses: [
        { status: 200, description: 'Variant', schema: variantResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 404, description: 'Variant not found', schema: errorSchema },
      ],
    },
    PUT: {
      summary: 'Update a sidebar variant',
      description: 'Updates the variant\'s name, settings, and/or isActive flag. Setting `isActive: true` deactivates other variants in the same scope (only one active per user/tenant/locale).',
      requestBody: { contentType: 'application/json', schema: updateVariantInputSchema },
      responses: [
        { status: 200, description: 'Variant updated', schema: variantResponseSchema },
        { status: 400, description: 'Invalid payload', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 404, description: 'Variant not found', schema: errorSchema },
      ],
    },
    DELETE: {
      summary: 'Delete a sidebar variant',
      description: 'Soft-deletes the variant (sets deleted_at).',
      responses: [
        { status: 200, description: 'Variant deleted', schema: deleteResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 404, description: 'Variant not found', schema: errorSchema },
      ],
    },
  },
}
