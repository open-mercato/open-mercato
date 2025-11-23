import { CustomFieldEntityConfig } from '../data/entities'

export type CustomFieldsetGroup = {
  code: string
  title?: string | null
  hint?: string | null
}

export type CustomFieldsetDefinition = {
  code: string
  label: string
  icon?: string | null
  description?: string | null
  groups?: CustomFieldsetGroup[]
}

export type EntityFieldsetConfig = {
  fieldsets: CustomFieldsetDefinition[]
  singleFieldsetPerRecord: boolean
}

const DEFAULT_CONFIG: EntityFieldsetConfig = {
  fieldsets: [],
  singleFieldsetPerRecord: true,
}

type LoadOptions = {
  entityIds: string[]
  tenantId: string | null
  organizationId: string | null
  mode: 'public' | 'manage'
}

function normalizeCode(input: unknown): string {
  if (typeof input !== 'string') return ''
  const trimmed = input.trim()
  if (!trimmed) return ''
  return trimmed
}

function normalizeFieldset(raw: any): CustomFieldsetDefinition | null {
  if (!raw || typeof raw !== 'object') return null
  const code = normalizeCode(raw.code)
  const label = typeof raw.label === 'string' && raw.label.trim().length ? raw.label.trim() : ''
  if (!code || !label) return null
  const normalized: CustomFieldsetDefinition = {
    code,
    label,
  }
  if (typeof raw.icon === 'string' && raw.icon.trim()) normalized.icon = raw.icon.trim()
  if (typeof raw.description === 'string' && raw.description.trim()) normalized.description = raw.description.trim()
  if (Array.isArray(raw.groups) && raw.groups.length) {
    const groups: CustomFieldsetGroup[] = []
    const seen = new Set<string>()
    for (const entry of raw.groups) {
      if (!entry || typeof entry !== 'object') continue
      const groupCode = normalizeCode(entry.code)
      if (!groupCode || seen.has(groupCode)) continue
      seen.add(groupCode)
      groups.push({
        code: groupCode,
        title: typeof entry.title === 'string' && entry.title.trim().length ? entry.title.trim() : undefined,
        hint: typeof entry.hint === 'string' && entry.hint.trim().length ? entry.hint.trim() : undefined,
      })
    }
    if (groups.length) normalized.groups = groups
  }
  return normalized
}

function normalizeConfig(raw: any): EntityFieldsetConfig {
  if (!raw || typeof raw !== 'object') return DEFAULT_CONFIG
  const cfg = (raw as any).configJson ?? raw
  const fieldsetsRaw = Array.isArray(cfg?.fieldsets) ? cfg.fieldsets : []
  const normalizedFieldsets = fieldsetsRaw
    .map((entry: any) => normalizeFieldset(entry))
    .filter((entry: CustomFieldsetDefinition | null): entry is CustomFieldsetDefinition => Boolean(entry))
  const seenCodes = new Set<string>()
  const fieldsets: CustomFieldsetDefinition[] = []
  for (const entry of normalizedFieldsets) {
    if (seenCodes.has(entry.code)) continue
    seenCodes.add(entry.code)
    fieldsets.push(entry)
  }
  const singleFieldsetPerRecord =
    typeof cfg?.singleFieldsetPerRecord === 'boolean' ? cfg.singleFieldsetPerRecord : true
  return {
    fieldsets,
    singleFieldsetPerRecord,
  }
}

export async function loadEntityFieldsetConfigs(
  em: any,
  options: LoadOptions
): Promise<Map<string, EntityFieldsetConfig>> {
  const map = new Map<string, EntityFieldsetConfig>()
  if (!options.entityIds.length) return map

  const where: any = {
    entityId: { $in: options.entityIds as any },
    deletedAt: null,
    isActive: true,
  }
  const tenantMatch = options.tenantId ?? undefined
  where.$and = [
    { $or: [{ tenantId: tenantMatch as any }, { tenantId: null }] },
  ]
  if (options.mode === 'manage') {
    const orgMatch = options.organizationId ?? undefined
    where.$and.push({ $or: [{ organizationId: orgMatch as any }, { organizationId: null }] })
  }

  const rows: CustomFieldEntityConfig[] = await em.find(CustomFieldEntityConfig, where as any)
  const bucket = new Map<string, CustomFieldEntityConfig[]>()
  for (const row of rows) {
    const entityId = String(row.entityId)
    const list = bucket.get(entityId) ?? []
    list.push(row)
    bucket.set(entityId, list)
  }

  const scopeScore = (row: CustomFieldEntityConfig) => {
    let score = 0
    if (row.tenantId) {
      score += row.tenantId === options.tenantId ? 2 : 0
    } else {
      score += 1
    }
    if (row.organizationId) {
      score += row.organizationId === options.organizationId ? 1 : -1
    }
    return score
  }

  for (const entityId of options.entityIds) {
    const list = bucket.get(entityId) ?? []
    if (!list.length) continue
    list.sort((a, b) => {
      const diff = scopeScore(b) - scopeScore(a)
      if (diff !== 0) return diff
      const timeA =
        a.updatedAt instanceof Date ? a.updatedAt.getTime() : new Date(a.updatedAt as any).getTime()
      const timeB =
        b.updatedAt instanceof Date ? b.updatedAt.getTime() : new Date(b.updatedAt as any).getTime()
      return timeB - timeA
    })
    const winner = list[0]
    map.set(entityId, normalizeConfig(winner.configJson ?? {}))
  }

  return map
}

export function mergeEntityFieldsetConfig(
  current: EntityFieldsetConfig | null | undefined,
  patch: Partial<EntityFieldsetConfig>
): EntityFieldsetConfig {
  const base = current ?? DEFAULT_CONFIG
  return {
    fieldsets: Array.isArray(patch.fieldsets) ? patch.fieldsets : base.fieldsets,
    singleFieldsetPerRecord:
      patch.singleFieldsetPerRecord !== undefined
        ? patch.singleFieldsetPerRecord
        : base.singleFieldsetPerRecord,
  }
}

export function normalizeEntityFieldsetConfig(raw: any): EntityFieldsetConfig {
  if (!raw) return DEFAULT_CONFIG
  return normalizeConfig(raw)
}
