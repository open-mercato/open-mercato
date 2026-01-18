import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { CacheStrategy } from '@open-mercato/cache'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { CustomFieldDef } from '@open-mercato/core/modules/entities/data/entities'
import { upsertCustomFieldDefSchema, fieldsetCodeRegex } from '@open-mercato/core/modules/entities/data/validators'
import {
  createDefinitionsCacheKey,
  createDefinitionsCacheTags,
  invalidateDefinitionsCache,
  ENTITY_DEFINITIONS_CACHE_TTL_MS,
} from './definitions.cache'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { filterSelectableSystemEntityIds, isSystemEntitySelectable } from '@open-mercato/shared/lib/entities/system-entities'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { loadEntityFieldsetConfigs, CustomFieldsetDefinition } from '../lib/fieldsets'
import { normalizeCustomFieldOptions } from '@open-mercato/shared/modules/entities/options'

export const metadata = {
  // Reading definitions is needed by record forms; keep it auth-protected but accessible to all authenticated users
  GET: { requireAuth: true },
  // Mutations remain admin-only
  POST: { requireAuth: true, requireFeatures: ['entities.definitions.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['entities.definitions.manage'] },
}

function parseEntityIds(url: URL): string[] {
  const direct = url.searchParams.getAll('entityId').filter((id) => typeof id === 'string' && id.trim().length > 0)
  const combined = url.searchParams.get('entityIds')
  if (combined) {
    combined
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0)
      .forEach((id) => direct.push(id))
  }
  const unique: string[] = []
  const seen = new Set<string>()
  for (const id of direct) {
    if (seen.has(id)) continue
    seen.add(id)
    unique.push(id)
  }
  return unique
}

async function resolveEntityDefaultEditor(em: any, entityId: string, tenantId: string | null | undefined): Promise<string | undefined> {
  try {
    const ent = await em.findOne('@open-mercato/core/modules/entities/data/entities:CustomEntity' as any, {
      entityId,
      $and: [
        { $or: [ { tenantId: tenantId ?? undefined as any }, { tenantId: null } ] },
      ],
    } as any)
    if (ent && typeof (ent as any).defaultEditor === 'string') return (ent as any).defaultEditor
  } catch {}
  return undefined
}

function normalizeFieldGroup(raw: unknown): { code: string; title?: string; hint?: string } | undefined {
  if (!raw) return undefined
  if (typeof raw === 'string') {
    const code = raw.trim()
    return code ? { code } : undefined
  }
  if (typeof raw !== 'object') return undefined
  const entry = raw as Record<string, unknown>
  const code = typeof entry.code === 'string' ? entry.code.trim() : ''
  if (!code) return undefined
  const group: { code: string; title?: string; hint?: string } = { code }
  if (typeof entry.title === 'string' && entry.title.trim()) group.title = entry.title.trim()
  if (typeof entry.hint === 'string' && entry.hint.trim()) group.hint = entry.hint.trim()
  return group
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const requestedEntityIds = parseEntityIds(url)
  if (!requestedEntityIds.length) {
    return NextResponse.json({ error: 'entityId is required' }, { status: 400 })
  }
  const requestedFieldset = url.searchParams.get('fieldset')
  const fieldsetFilter = requestedFieldset && requestedFieldset.trim().length ? requestedFieldset.trim() : null

  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const entityIds = filterSelectableSystemEntityIds(requestedEntityIds)
  if (!entityIds.length) {
    return NextResponse.json({ items: [] })
  }

  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const tenantId = scope.tenantId ?? auth.tenantId ?? null
  if (!tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const organizationId = scope.selectedId ?? auth.orgId ?? null
  const { resolve } = container
  const em = resolve('em') as any
  let cache: CacheStrategy | undefined
  try {
    cache = resolve('cache') as CacheStrategy
  } catch {}

  let cacheKey: string | null = null
  if (cache && !fieldsetFilter) {
    cacheKey = createDefinitionsCacheKey({
      tenantId,
      organizationId,
      entityIds,
    })
    try {
      const cached = await cache.get(cacheKey)
      if (cached) {
        return NextResponse.json(cached)
      }
    } catch (err) {
      console.warn('[entities.definitions.cache] Failed to read cache', err)
    }
  }

  const fieldsetConfigs = await loadEntityFieldsetConfigs(em, {
    entityIds,
    tenantId,
    organizationId,
    mode: 'public',
  })

  // Tenant-only scoping: allow global (null) or exact tenant match; do not scope by organization here
  const whereActive = {
    entityId: { $in: entityIds as any },
    deletedAt: null,
    $and: [
      { $or: [ { tenantId: tenantId ?? undefined as any }, { tenantId: null } ] },
    ],
  } as any
  const defs = await em.find(CustomFieldDef, whereActive as any)
  const tombstones = await em.find(CustomFieldDef, {
    entityId: { $in: entityIds as any },
    deletedAt: { $ne: null } as any,
    $and: [
      { $or: [ { tenantId: tenantId ?? undefined as any }, { tenantId: null } ] },
    ],
  } as any)

  const tombstonedByEntity = new Map<string, Set<string>>()
  for (const entry of tombstones as any[]) {
    const eid = String(entry.entityId)
    if (!tombstonedByEntity.has(eid)) tombstonedByEntity.set(eid, new Set())
    tombstonedByEntity.get(eid)!.add(entry.key)
  }

  const scopeScore = (x: any) => (x.tenantId ? 2 : 0) + (x.organizationId ? 1 : 0)

  const definitionsByEntity = new Map<string, any[]>()
  for (const d of defs) {
    const eid = String(d.entityId)
    if (!definitionsByEntity.has(eid)) definitionsByEntity.set(eid, [])
    definitionsByEntity.get(eid)!.push(d)
  }

  const entityDefaultEditors = new Map<string, string | undefined>()
  for (const entityId of entityIds) {
    const editor = await resolveEntityDefaultEditor(em, entityId, tenantId ?? null)
    entityDefaultEditors.set(entityId, editor)
  }

  const items: any[] = []

  const entityOrder = new Map<string, number>()
  entityIds.forEach((id, idx) => entityOrder.set(id, idx))

  for (const entityId of entityIds) {
    const defsForEntity = definitionsByEntity.get(entityId) ?? []
    if (!defsForEntity.length) continue
    const tombstonedKeys = tombstonedByEntity.get(entityId) ?? new Set<string>()
    const byKey = new Map<string, any>()
    for (const d of defsForEntity) {
      const existing = byKey.get(d.key)
      if (!existing) { byKey.set(d.key, d); continue }
      const sNew = scopeScore(d)
      const sOld = scopeScore(existing)
      if (sNew > sOld) { byKey.set(d.key, d); continue }
      if (sNew < sOld) continue
      const tNew = (d.updatedAt instanceof Date) ? d.updatedAt.getTime() : new Date(d.updatedAt).getTime()
      const tOld = (existing.updatedAt instanceof Date) ? existing.updatedAt.getTime() : new Date(existing.updatedAt).getTime()
      if (tNew >= tOld) byKey.set(d.key, d)
    }

    const defaultEditor = entityDefaultEditors.get(entityId)
    const winning = Array.from(byKey.values()).filter((d: any) => (d.isActive !== false) && !tombstonedKeys.has(d.key))
    winning.sort((a: any, b: any) => ((a.configJson?.priority ?? 0) - (b.configJson?.priority ?? 0)))

    for (const d of winning) {
      const rawFieldset = typeof d.configJson?.fieldset === 'string' ? d.configJson.fieldset.trim() : ''
      const normalizedFieldset = rawFieldset.length > 0 ? rawFieldset : undefined
      if (fieldsetFilter && normalizedFieldset !== fieldsetFilter) continue
      const groupInfo = normalizeFieldGroup(d.configJson?.group)
      const keyLower = String(d.key).toLowerCase()
      const candidateBase = {
        key: d.key,
        kind: d.kind,
        label: d.configJson?.label || d.key,
        description: d.configJson?.description || undefined,
        multi: Boolean(d.configJson?.multi),
        options: (() => {
          const normalizedOptions = normalizeCustomFieldOptions(d.configJson?.options)
          return normalizedOptions.length ? normalizedOptions : undefined
        })(),
        optionsUrl: (() => {
          const dictionaryId = typeof d.configJson?.dictionaryId === 'string' ? d.configJson.dictionaryId : undefined
          if (dictionaryId) return `/api/dictionaries/${dictionaryId}/entries`
          return typeof d.configJson?.optionsUrl === 'string' ? d.configJson.optionsUrl : undefined
        })(),
        filterable: Boolean(d.configJson?.filterable),
        formEditable: d.configJson?.formEditable !== undefined ? Boolean(d.configJson.formEditable) : true,
        listVisible: d.configJson?.listVisible !== undefined ? Boolean(d.configJson.listVisible) : true,
        editor: typeof d.configJson?.editor === 'string'
          ? d.configJson.editor
          : (d.kind === 'multiline' ? defaultEditor : undefined),
        input: typeof d.configJson?.input === 'string' ? d.configJson.input : undefined,
        dictionaryId: typeof d.configJson?.dictionaryId === 'string' ? d.configJson.dictionaryId : undefined,
        dictionaryInlineCreate: d.configJson?.dictionaryInlineCreate !== undefined
          ? Boolean(d.configJson.dictionaryInlineCreate)
          : undefined,
        priority: typeof d.configJson?.priority === 'number' ? d.configJson.priority : 0,
        validation: Array.isArray(d.configJson?.validation) ? d.configJson.validation : undefined,
        // attachments config passthrough
        maxAttachmentSizeMb: typeof d.configJson?.maxAttachmentSizeMb === 'number' ? d.configJson.maxAttachmentSizeMb : undefined,
        acceptExtensions: Array.isArray(d.configJson?.acceptExtensions) ? d.configJson.acceptExtensions : undefined,
        entityId,
        fieldset: normalizedFieldset,
        group: groupInfo,
      } as any
      const metrics = computeDefinitionScore(d, candidateBase, entityOrder.get(entityId) ?? Number.MAX_SAFE_INTEGER)
      const candidate = { ...candidateBase, __score: metrics }
      const existing = (items as any[]).find((entry) => entry.key.toLowerCase() === keyLower)
      if (!existing) {
        items.push(candidate)
        continue
      }
      const existingScore = existing.__score as { base: number; penalty: number; entityIndex: number }
      const candidateScoreInfo = candidate.__score as { base: number; penalty: number; entityIndex: number }
      const better =
        candidateScoreInfo.base > existingScore.base ||
        (candidateScoreInfo.base === existingScore.base && candidateScoreInfo.penalty < existingScore.penalty) ||
        (candidateScoreInfo.base === existingScore.base && candidateScoreInfo.penalty === existingScore.penalty && candidateScoreInfo.entityIndex < existingScore.entityIndex)
      if (better) {
        const index = items.findIndex((entry) => entry.key.toLowerCase() === keyLower)
        if (index >= 0) items[index] = candidate
      }
    }
  }

  const sanitized = items.map((item: any) => {
    const { __score, ...rest } = item
    return rest
  })
  sanitized.sort((a: any, b: any) => ((a.priority ?? 0) - (b.priority ?? 0)))

  const fieldsetsByEntity: Record<string, CustomFieldsetDefinition[]> = {}
  const entitySettings: Record<string, { singleFieldsetPerRecord: boolean }> = {}
  for (const entityId of entityIds) {
    const cfg = fieldsetConfigs.get(entityId) ?? { fieldsets: [], singleFieldsetPerRecord: true }
    fieldsetsByEntity[entityId] = cfg.fieldsets
    entitySettings[entityId] = { singleFieldsetPerRecord: cfg.singleFieldsetPerRecord }
  }

  const responseBody = { items: sanitized, fieldsetsByEntity, entitySettings }

  if (cache && cacheKey && !fieldsetFilter) {
    const tags = createDefinitionsCacheTags({
      tenantId,
      organizationId,
      entityIds,
    })
    try {
      await cache.set(cacheKey, responseBody, {
        ttl: ENTITY_DEFINITIONS_CACHE_TTL_MS,
        tags,
      })
    } catch (err) {
      console.warn('[entities.definitions.cache] Failed to store cache entry', err)
    }
  }

  return NextResponse.json(responseBody)
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const parsed = upsertCustomFieldDefSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  const input = parsed.data

  if (!isSystemEntitySelectable(input.entityId)) {
    return NextResponse.json({ error: 'Custom fields are not supported for this entity' }, { status: 400 })
  }

  if (input.kind === 'dictionary') {
    const dictionaryId = input.configJson?.dictionaryId
    if (typeof dictionaryId !== 'string' || dictionaryId.trim().length === 0) {
      return NextResponse.json({ error: 'dictionaryId is required for dictionary custom fields' }, { status: 400 })
    }
  }

  const container = await createRequestContainer()
  const { resolve } = container
  const em = resolve('em') as any
  let cache: CacheStrategy | undefined
  try {
    cache = resolve('cache') as CacheStrategy
  } catch {}

  const where: any = { entityId: input.entityId, key: input.key, organizationId: auth.orgId ?? null, tenantId: auth.tenantId ?? null }
  let def = await em.findOne(CustomFieldDef, where)
  if (!def) def = em.create(CustomFieldDef, { ...where, createdAt: new Date() })
  def.kind = input.kind
  const inCfg = (input as any).configJson ?? {}
  const cfg: Record<string, any> = { ...inCfg }
  if (cfg.label == null || String(cfg.label).trim() === '') cfg.label = input.key
  if (cfg.formEditable === undefined) cfg.formEditable = true
  if (cfg.listVisible === undefined) cfg.listVisible = true
  if (input.kind === 'dictionary') {
    const dictionaryId = typeof cfg.dictionaryId === 'string' ? cfg.dictionaryId.trim() : ''
    cfg.dictionaryId = dictionaryId
    cfg.dictionaryInlineCreate = cfg.dictionaryInlineCreate !== false
  }
  if (input.kind === 'multiline' && (cfg.editor == null || String(cfg.editor).trim() === '')) {
    cfg.editor = 'markdown'
  }
  def.configJson = cfg
  def.isActive = input.isActive ?? true
  def.updatedAt = new Date()
  em.persist(def)
  await em.flush()
  await invalidateDefinitionsCache(cache, {
    tenantId: auth.tenantId ?? null,
    organizationId: auth.orgId ?? null,
    entityIds: [input.entityId],
  })
  // Changing field definitions may impact forms but not sidebar items; no nav cache touch
  return NextResponse.json({ ok: true, item: { id: def.id, key: def.key, kind: def.kind, configJson: def.configJson, isActive: def.isActive } })
}

export async function DELETE(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const { entityId, key } = body || {}
  if (!entityId || !key) return NextResponse.json({ error: 'entityId and key are required' }, { status: 400 })

  const container = await createRequestContainer()
  const { resolve } = container
  const em = resolve('em') as any
  let cache: CacheStrategy | undefined
  try {
    cache = resolve('cache') as CacheStrategy
  } catch {}
  const where: any = { entityId, key, organizationId: auth.orgId ?? null, tenantId: auth.tenantId ?? null }
  const def = await em.findOne(CustomFieldDef, where)
  if (!def) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  def.isActive = false
  def.updatedAt = new Date()
  def.deletedAt = def.deletedAt ?? new Date()
  em.persist(def)
  await em.flush()
  await invalidateDefinitionsCache(cache, {
    tenantId: auth.tenantId ?? null,
    organizationId: auth.orgId ?? null,
    entityIds: [entityId],
  })
  // Changing field definitions may impact forms but not sidebar items; no nav cache touch
  return NextResponse.json({ ok: true })
}

const definitionsQuerySchema = z
  .object({
    entityId: z.union([z.string(), z.array(z.string())]).optional(),
    entityIds: z.string().optional(),
    fieldset: z.string().regex(fieldsetCodeRegex).optional(),
  })
  .refine(
    (value) => {
      if (value.entityId && typeof value.entityId === 'string' && value.entityId.trim().length > 0) return true
      if (Array.isArray(value.entityId) && value.entityId.length > 0) return true
      return typeof value.entityIds === 'string' && value.entityIds.trim().length > 0
    },
    { message: 'Provide at least one entityId or an entityIds list.' }
  )

const customFieldOptionValueSchema = z.union([z.string(), z.number()])

const customFieldDefinitionSchema = z.object({
  key: z.string(),
  kind: z.string(),
  label: z.string(),
  description: z.string().optional(),
  multi: z.boolean().optional(),
  options: z.array(customFieldOptionValueSchema).optional(),
  optionsUrl: z.string().optional(),
  filterable: z.boolean().optional(),
  formEditable: z.boolean().optional(),
  listVisible: z.boolean().optional(),
  editor: z.string().optional(),
  input: z.string().optional(),
  dictionaryId: z.string().optional(),
  dictionaryInlineCreate: z.boolean().optional(),
  priority: z.number().optional(),
  validation: z.array(z.any()).optional(),
  maxAttachmentSizeMb: z.number().optional(),
  acceptExtensions: z.array(z.any()).optional(),
  entityId: z.string(),
  fieldset: z.string().optional(),
  group: z
    .object({
      code: z.string(),
      title: z.string().optional(),
      hint: z.string().optional(),
    })
    .optional(),
})

const customFieldsetGroupResponseSchema = z.object({
  code: z.string(),
  title: z.string().optional(),
  hint: z.string().optional(),
})

const entityFieldsetResponseSchema = z.object({
  code: z.string(),
  label: z.string(),
  icon: z.string().optional(),
  description: z.string().optional(),
  groups: z.array(customFieldsetGroupResponseSchema).optional(),
})

const definitionsResponseSchema = z.object({
  items: z.array(customFieldDefinitionSchema),
  fieldsetsByEntity: z.record(z.string(), z.array(entityFieldsetResponseSchema)).optional(),
  entitySettings: z
    .record(
      z.string(),
      z.object({
        singleFieldsetPerRecord: z.boolean().optional(),
      })
    )
    .optional(),
})

const upsertDefinitionResponseSchema = z.object({
  ok: z.literal(true),
  item: z.object({
    id: z.string().uuid(),
    key: z.string(),
    kind: z.string(),
    configJson: z.record(z.string(), z.any()),
    isActive: z.boolean().optional(),
  }),
})

const deleteDefinitionRequestSchema = z.object({
  entityId: z.string(),
  key: z.string(),
})

const deleteDefinitionResponseSchema = z.object({
  ok: z.literal(true),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Entities',
  summary: 'Manage custom field definitions',
  methods: {
    GET: {
      summary: 'List active custom field definitions',
      description: 'Returns active custom field definitions for the supplied entity ids, respecting tenant scope and tombstones.',
      query: definitionsQuerySchema,
      responses: [
        {
          status: 200,
          description: 'Definition list',
          schema: definitionsResponseSchema,
        },
        {
          status: 400,
          description: 'Missing entity id',
          schema: z.object({ error: z.string() }),
        },
        {
          status: 401,
          description: 'Missing authentication',
          schema: z.object({ error: z.string() }),
        },
      ],
    },
    POST: {
      summary: 'Upsert custom field definition',
      description: 'Creates or updates a custom field definition for the current tenant/org scope.',
      requestBody: {
        contentType: 'application/json',
        schema: upsertCustomFieldDefSchema,
      },
      responses: [
        {
          status: 200,
          description: 'Definition saved',
          schema: upsertDefinitionResponseSchema,
        },
        {
          status: 400,
          description: 'Validation failed',
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
      ],
    },
    DELETE: {
      summary: 'Soft delete custom field definition',
      description: 'Marks the specified definition inactive and tombstones it for the current scope.',
      requestBody: {
        contentType: 'application/json',
        schema: deleteDefinitionRequestSchema,
      },
      responses: [
        {
          status: 200,
          description: 'Definition deleted',
          schema: deleteDefinitionResponseSchema,
        },
        {
          status: 400,
          description: 'Missing entity id or key',
          schema: z.object({ error: z.string() }),
        },
        {
          status: 401,
          description: 'Missing authentication',
          schema: z.object({ error: z.string() }),
        },
        {
          status: 404,
          description: 'Definition not found',
          schema: z.object({ error: z.string() }),
        },
      ],
    },
  },
}
const computeDefinitionScore = (def: any, cfg: Record<string, any>, entityIndex: number) => {
  const listVisibleScore = cfg.listVisible === false ? 0 : 1
  const formEditableScore = cfg.formEditable === false ? 0 : 1
  const filterableScore = cfg.filterable ? 1 : 0
  const kindScore = (() => {
    switch (def.kind) {
      case 'dictionary':
        return 8
      case 'relation':
        return 6
      case 'select':
        return 4
      case 'multiline':
        return 3
      case 'boolean':
      case 'integer':
      case 'float':
        return 2
      default:
        return 1
    }
  })()
  const optionsBonus = Array.isArray(cfg.options) && cfg.options.length ? 2 : 0
  const dictionaryBonus = typeof cfg.dictionaryId === 'string' && cfg.dictionaryId.trim().length ? 5 : 0
  const base = (listVisibleScore * 16) + (formEditableScore * 8) + (filterableScore * 4) + kindScore + optionsBonus + dictionaryBonus
  const penalty = typeof cfg.priority === 'number' ? cfg.priority : 0
  return { base, penalty, entityIndex }
}
