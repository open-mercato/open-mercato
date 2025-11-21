import { NextResponse } from 'next/server'
import type { CacheStrategy } from '@open-mercato/cache'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { CustomFieldDef, CustomFieldEntityConfig } from '@open-mercato/core/modules/entities/data/entities'
import { customFieldEntityConfigSchema, upsertCustomFieldDefSchema } from '@open-mercato/core/modules/entities/data/validators'
import { z } from 'zod'
import { invalidateDefinitionsCache } from './definitions.cache'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { mergeEntityFieldsetConfig, normalizeEntityFieldsetConfig } from '../lib/fieldsets'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['entities.definitions.manage'] },
}

const batchSchema = z
  .object({
    entityId: z.string().regex(/^[a-z0-9_]+:[a-z0-9_]+$/),
    definitions: z.array(
      upsertCustomFieldDefSchema
        .omit({ entityId: true })
        .extend({
          configJson: z.any().optional(),
        })
    ),
  })
  .extend(customFieldEntityConfigSchema.shape)

type IncomingFieldset = z.infer<typeof customFieldEntityConfigSchema>['fieldsets']

function cloneFieldsets(fieldsets?: IncomingFieldset): IncomingFieldset {
  if (!Array.isArray(fieldsets)) return undefined
  return fieldsets.map((fieldset) => ({
    code: fieldset.code,
    label: fieldset.label,
    icon: fieldset.icon,
    description: fieldset.description,
    groups: Array.isArray(fieldset.groups)
      ? fieldset.groups.map((group) => ({
          code: group.code,
          title: group.title,
          hint: group.hint,
        }))
      : undefined,
  }))
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const parsed = batchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  const { entityId, definitions, fieldsets, singleFieldsetPerRecord } = parsed.data

  const container = await createRequestContainer()
  const { resolve } = container
  const em = resolve('em') as any
  let cache: CacheStrategy | undefined
  try {
    cache = resolve('cache') as CacheStrategy
  } catch {}

  await em.begin()
  try {
    for (const [idx, d] of definitions.entries()) {
      const where: any = {
        entityId,
        key: d.key,
        organizationId: auth.orgId ?? null,
        tenantId: auth.tenantId ?? null,
      }
      let def = await em.findOne(CustomFieldDef, where)
      if (!def) def = em.create(CustomFieldDef, { ...where, createdAt: new Date() })
      def.kind = d.kind

      const inCfg = (d as any).configJson ?? {}
      const cfg: Record<string, any> = { ...inCfg }
      if (cfg.label == null || String(cfg.label).trim() === '') cfg.label = d.key
      if (cfg.formEditable === undefined) cfg.formEditable = true
      if (cfg.listVisible === undefined) cfg.listVisible = true
      if (d.kind === 'multiline' && (cfg.editor == null || String(cfg.editor).trim() === '')) cfg.editor = 'markdown'
      cfg.priority = idx

      def.configJson = cfg
      def.isActive = d.isActive ?? true
      def.updatedAt = new Date()
      em.persist(def)
    }
    if (fieldsets !== undefined || singleFieldsetPerRecord !== undefined) {
      const scope: any = { entityId, organizationId: auth.orgId ?? null, tenantId: auth.tenantId ?? null }
      let cfg = await em.findOne(CustomFieldEntityConfig, scope)
      if (!cfg) cfg = em.create(CustomFieldEntityConfig, { ...scope, createdAt: new Date() })
      const existing = normalizeEntityFieldsetConfig(cfg.configJson ?? {})
      const patch = mergeEntityFieldsetConfig(existing, {
        fieldsets: fieldsets !== undefined ? cloneFieldsets(fieldsets) ?? [] : undefined,
        singleFieldsetPerRecord,
      })
      cfg.configJson = {
        fieldsets: patch.fieldsets,
        singleFieldsetPerRecord: patch.singleFieldsetPerRecord,
      }
      cfg.updatedAt = new Date()
      cfg.isActive = true
      em.persist(cfg)
    }
    await em.flush()
    await em.commit()
  } catch (e) {
    try { await em.rollback() } catch {}
    return NextResponse.json({ error: 'Failed to save definitions batch' }, { status: 500 })
  }

  await invalidateDefinitionsCache(cache, {
    tenantId: auth.tenantId ?? null,
    organizationId: auth.orgId ?? null,
    entityIds: [entityId],
  })

  return NextResponse.json({ ok: true })
}

const batchResponseSchema = z.object({
  ok: z.literal(true),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Entities',
  summary: 'Batch upsert custom field definitions',
  methods: {
    POST: {
      summary: 'Save multiple custom field definitions',
      description: 'Creates or updates multiple definitions for a single entity in one transaction.',
      requestBody: {
        contentType: 'application/json',
        schema: batchSchema,
      },
      responses: [
        {
          status: 200,
          description: 'Definitions saved',
          schema: batchResponseSchema,
        },
        {
          status: 400,
          description: 'Validation error',
          schema: z.object({
            error: z.string(),
            details: z.any().optional(),
          }),
        },
        {
          status: 401,
          description: 'Missing authentication',
          schema: z.object({ error: z.string() }),
        },
        {
          status: 500,
          description: 'Unexpected failure',
          schema: z.object({ error: z.string() }),
        },
      ],
    },
  },
}
