import { NextResponse } from 'next/server'
import type { CacheStrategy } from '@open-mercato/cache'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { CustomFieldDef } from '@open-mercato/core/modules/entities/data/entities'
import { upsertCustomFieldDefSchema } from '@open-mercato/core/modules/entities/data/validators'
import {
  createDefinitionsCacheKey,
  createDefinitionsCacheTags,
  invalidateDefinitionsCache,
  ENTITY_DEFINITIONS_CACHE_TTL_MS,
} from './definitions.cache'

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

export async function GET(req: Request) {
  const url = new URL(req.url)
  const entityIds = parseEntityIds(url)
  if (!entityIds.length) {
    return NextResponse.json({ error: 'entityId is required' }, { status: 400 })
  }

  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const container = await createRequestContainer()
  const { resolve } = container
  const em = resolve('em') as any
  let cache: CacheStrategy | undefined
  try {
    cache = resolve('cache') as CacheStrategy
  } catch {}

  let cacheKey: string | null = null
  if (cache) {
    cacheKey = createDefinitionsCacheKey({
      tenantId: auth.tenantId ?? null,
      organizationId: auth.orgId,
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

  // Tenant-only scoping: allow global (null) or exact tenant match; do not scope by organization here
  const whereActive = {
    entityId: { $in: entityIds as any },
    deletedAt: null,
    $and: [
      { $or: [ { tenantId: auth.tenantId ?? undefined as any }, { tenantId: null } ] },
    ],
  } as any
  const defs = await em.find(CustomFieldDef, whereActive as any)
  const tombstones = await em.find(CustomFieldDef, {
    entityId: { $in: entityIds as any },
    deletedAt: { $ne: null } as any,
    $and: [
      { $or: [ { tenantId: auth.tenantId ?? undefined as any }, { tenantId: null } ] },
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
    const editor = await resolveEntityDefaultEditor(em, entityId, auth.tenantId ?? null)
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
      const keyLower = String(d.key).toLowerCase()
      const candidateBase = {
        key: d.key,
        kind: d.kind,
        label: d.configJson?.label || d.key,
        description: d.configJson?.description || undefined,
        multi: Boolean(d.configJson?.multi),
        options: Array.isArray(d.configJson?.options) ? d.configJson.options : undefined,
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
        priority: typeof d.configJson?.priority === 'number' ? d.configJson.priority : 0,
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

  const responseBody = { items: sanitized }

  if (cache && cacheKey) {
    const tags = createDefinitionsCacheTags({
      tenantId: auth.tenantId ?? null,
      organizationId: auth.orgId,
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
