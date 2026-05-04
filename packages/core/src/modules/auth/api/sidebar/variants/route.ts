import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { SIDEBAR_PREFERENCES_VERSION } from '@open-mercato/shared/modules/navigation/sidebarPreferences'
import {
  createSidebarVariant,
  listSidebarVariants,
  type SidebarVariantRecord,
} from '../../../services/sidebarPreferencesService'
import {
  createSidebarVariantInputSchema,
  sidebarVariantRecordSchema,
} from '../../../data/validators'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  GET: { requireAuth: true },
  POST: { requireAuth: true },
}

const variantListResponseSchema = z.object({
  locale: z.string(),
  variants: z.array(sidebarVariantRecordSchema),
})

const variantCreateResponseSchema = z.object({
  locale: z.string(),
  variant: sidebarVariantRecordSchema,
})

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

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const effectiveUserId = auth.isApiKey ? auth.userId : auth.sub
  if (!effectiveUserId) return NextResponse.json({ error: 'No user context' }, { status: 403 })

  const { locale } = await resolveTranslations()
  const { resolve } = await createRequestContainer()
  const em = resolve('em') as EntityManager

  const variants = await listSidebarVariants(em, {
    userId: effectiveUserId,
    tenantId: auth.tenantId ?? null,
    organizationId: auth.orgId ?? null,
    locale,
  })

  return NextResponse.json(
    {
      locale,
      variants: variants.map(serializeVariant),
    },
    { headers: { 'cache-control': 'no-store, no-cache, must-revalidate' } },
  )
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const effectiveUserId = auth.isApiKey ? auth.userId : auth.sub
  if (!effectiveUserId) return NextResponse.json({ error: 'No user context' }, { status: 403 })

  let parsedBody: unknown
  try {
    parsedBody = await req.json()
  } catch {
    parsedBody = {}
  }

  const parsed = createSidebarVariantInputSchema.safeParse(parsedBody)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 400 })
  }

  try {
    const { locale } = await resolveTranslations()
    const { resolve } = await createRequestContainer()
    const em = resolve('em') as EntityManager

    const variant = await createSidebarVariant(em, {
      userId: effectiveUserId,
      tenantId: auth.tenantId ?? null,
      organizationId: auth.orgId ?? null,
      locale,
    }, {
      name: parsed.data.name ?? null,
      settings: parsed.data.settings ?? null,
      isActive: parsed.data.isActive,
    })

    return NextResponse.json({
      locale,
      variant: serializeVariant(variant),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // MikroORM throws UniqueConstraintViolationException for unique conflicts.
    // The constraint name embeds the columns: (user_id, tenant_id, locale, name).
    if (err instanceof Error && err.constructor?.name === 'UniqueConstraintViolationException') {
      return NextResponse.json(
        { error: 'A variant with this name already exists. Choose a different name.', code: 'duplicate_name' },
        { status: 409 },
      )
    }
    // eslint-disable-next-line no-console
    console.error('[sidebar-variants POST] failed', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Authentication & Accounts',
  summary: 'Sidebar variants',
  methods: {
    GET: {
      summary: 'List sidebar variants',
      description: 'Returns the named sidebar variants saved by the current user for the current tenant + locale.',
      responses: [
        { status: 200, description: 'Variant list', schema: variantListResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
      ],
    },
    POST: {
      summary: 'Create a sidebar variant',
      description: 'Creates a new variant. If `name` is omitted or blank, an auto-name like "My preferences", "My preferences 2", … is assigned.',
      requestBody: { contentType: 'application/json', schema: createSidebarVariantInputSchema },
      responses: [
        { status: 200, description: 'Variant created', schema: variantCreateResponseSchema },
        { status: 400, description: 'Invalid payload', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
      ],
    },
  },
}
