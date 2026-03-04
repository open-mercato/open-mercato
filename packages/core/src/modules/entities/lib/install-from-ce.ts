import crypto from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CacheStrategy } from '@open-mercato/cache/types'
import type { CustomFieldDefinition, CustomFieldSet, CustomEntitySpec } from '@open-mercato/shared/modules/entities'
import { Tenant } from '@open-mercato/core/modules/directory/data/entities'
import { getModules } from '@open-mercato/shared/lib/i18n/server'
import { getEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import { ensureCustomFieldDefinitions } from './field-definitions'
import { upsertCustomEntity, type UpsertCustomEntityResult } from './register'

type InstallScope = {
  tenantId: string | null
}

export type InstallEntitiesOptions = {
  tenantIds?: string[]
  includeGlobal?: boolean
  dryRun?: boolean
  force?: boolean
  logger?: (message: string) => void
}

export type InstallEntitiesResult = {
  processed: number
  synchronized: number
  skipped: number
  fieldChanges: number
}

export type AggregatedEntityConfig = {
  entityId: string
  moduleIds: Set<string>
  spec?: CustomEntitySpec
  fieldSets: CustomFieldSet[]
}

const FIELD_DETAIL_KEYS: Array<keyof CustomFieldDefinition> = [
  'label',
  'description',
  'options',
  'optionsUrl',
  'defaultValue',
  'required',
  'multi',
  'filterable',
  'formEditable',
  'listVisible',
  'indexed',
  'editor',
  'input',
  'relatedEntityId',
  'validation',
  'maxAttachmentSizeMb',
  'acceptExtensions',
]

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeValue(item))
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = normalizeValue((value as Record<string, unknown>)[key])
        return acc
      }, {})
  }
  return value
}

function computeChecksum(payload: unknown): string {
  return crypto.createHash('md5').update(JSON.stringify(normalizeValue(payload))).digest('hex')
}

function systemEntityIds(): Set<string> {
  const ids = new Set<string>()
  const GeneratedEntities = getEntityIds()
  for (const moduleEntities of Object.values(GeneratedEntities)) {
    for (const id of Object.values(moduleEntities as Record<string, string>)) {
      ids.add(id)
    }
  }
  return ids
}

function buildAggregatedConfigs(): AggregatedEntityConfig[] {
  const map = new Map<string, AggregatedEntityConfig>()
  const modules = getModules()
  for (const mod of modules) {
    const moduleId = mod.id
    const entitySpecs = ((mod as any).customEntities as CustomEntitySpec[] | undefined) ?? []
    for (const spec of entitySpecs) {
      const existing = map.get(spec.id) ?? { entityId: spec.id, moduleIds: new Set<string>(), spec: undefined, fieldSets: [] }
      existing.moduleIds.add(moduleId)
      if (!existing.spec) existing.spec = spec
      map.set(spec.id, existing)
    }
    const fieldSets = ((mod as any).customFieldSets as CustomFieldSet[] | undefined) ?? []
    for (const set of fieldSets) {
      const existing = map.get(set.entity) ?? { entityId: set.entity, moduleIds: new Set<string>(), spec: undefined, fieldSets: [] }
      existing.moduleIds.add(moduleId)
      existing.fieldSets.push(set)
      map.set(set.entity, existing)
    }
  }
  return Array.from(map.values())
}

function resolveFields(fieldSets: CustomFieldSet[]): CustomFieldDefinition[] {
  const byKey = new Map<string, CustomFieldDefinition>()
  for (const set of fieldSets) {
    for (const field of set.fields ?? []) {
      byKey.set(field.key, { ...field })
    }
  }
  return Array.from(byKey.values()).sort((a, b) => a.key.localeCompare(b.key))
}

function normalizeField(field: CustomFieldDefinition) {
  const payload: Record<string, unknown> = {
    key: field.key,
    kind: field.kind,
  }
  for (const key of FIELD_DETAIL_KEYS) {
    const value = field[key]
    if (value !== undefined) payload[key] = value as unknown
  }
  if (field.id) payload.id = field.id
  return payload
}

function buildChecksumPayload(params: {
  entityId: string
  scope: InstallScope
  spec: CustomEntitySpec | undefined
  global: boolean
  fields: CustomFieldDefinition[]
}) {
  const { entityId, scope, spec, global, fields } = params
  return {
    entityId,
    scope,
    global,
    label: spec?.label ?? null,
    description: spec?.description ?? null,
    labelField: spec?.labelField ?? null,
    defaultEditor: spec?.defaultEditor ?? null,
    showInSidebar: spec?.showInSidebar ?? false,
    fields: fields.map((f) => normalizeField(f)),
  }
}

export async function installCustomEntitiesFromModules(
  em: EntityManager,
  cache: CacheStrategy | null | undefined,
  options: InstallEntitiesOptions = {}
): Promise<InstallEntitiesResult> {
  const aggregated = buildAggregatedConfigs()
  const systemIds = systemEntityIds()
  const includeGlobal = options.includeGlobal !== false
  const dryRun = options.dryRun === true
  const force = options.force === true
  const logger = options.logger

  let tenantIds: string[] | undefined
  if (options.tenantIds !== undefined) {
    tenantIds = Array.from(new Set(options.tenantIds.filter((id): id is string => typeof id === 'string' && id.length > 0)))
  }

  const ensureTenantIds = async (): Promise<string[]> => {
    if (tenantIds !== undefined) return tenantIds
    const rows = await em.find(Tenant, { deletedAt: null } as any, { fields: ['id'] as any })
    tenantIds = rows.map((row) => row.id)
    return tenantIds ?? []
  }

  let processed = 0
  let synchronized = 0
  let skipped = 0
  let fieldChanges = 0

  for (const entry of aggregated) {
    const { entityId } = entry
    const spec = entry.spec
    const fields = resolveFields(entry.fieldSets)
    const isSystem = systemIds.has(entityId)
    const registerEntity = !isSystem && !!spec
    const isGlobal = spec?.global === true

    const scopes: InstallScope[] = []
    if (isGlobal) {
      if (includeGlobal) scopes.push({ tenantId: null })
    } else {
      const ids = await ensureTenantIds()
      if (!ids.length) {
        skipped++
        continue
      }
      for (const tenantId of ids) scopes.push({ tenantId })
    }

    if (!scopes.length && fields.length === 0 && !registerEntity) {
      skipped++
      continue
    }

    for (const scope of scopes) {
      processed++
      const scopeKey = scope.tenantId ? `tenant:${scope.tenantId}` : 'global'
      const checksumPayload = buildChecksumPayload({
        entityId,
        scope,
        spec,
        global: isGlobal,
        fields,
      })
      const checksum = computeChecksum(checksumPayload)
      const cacheKey = `custom-entities:v1:${scopeKey}:${entityId}`

      if (!dryRun && !force && cache) {
        try {
          const cached = await cache.get(cacheKey)
          if (typeof cached === 'string' && cached === checksum) {
            skipped++
            continue
          }
        } catch {}
      }

      let entityResult: UpsertCustomEntityResult = 'unchanged'
      if (registerEntity) {
        entityResult = await upsertCustomEntity(em, entityId, {
          label: spec?.label ?? entityId,
          description: spec?.description ?? null,
          organizationId: null,
          tenantId: scope.tenantId,
          showInSidebar: spec?.showInSidebar ?? false,
          labelField: spec?.labelField ?? null,
          defaultEditor: spec?.defaultEditor ?? null,
          isActive: true,
          dryRun,
        })
      }

      let fieldResult = { created: 0, updated: 0, unchanged: 0 }
      if (fields.length) {
        fieldResult = await ensureCustomFieldDefinitions(
          em,
          [{ entity: entityId, fields }],
          { organizationId: null, tenantId: scope.tenantId, dryRun }
        )
      }

      const changed = (entityResult !== 'unchanged') || fieldResult.created > 0 || fieldResult.updated > 0
      if (changed) {
        synchronized++
        fieldChanges += fieldResult.created + fieldResult.updated
        if (!dryRun && cache) {
          try {
            await cache.set(cacheKey, checksum, { tags: [`custom-entity:${entityId}`, `custom-entity-scope:${scopeKey}`] })
          } catch {}
        }
        if (logger) {
          const parts: string[] = []
          if (entityResult !== 'unchanged') parts.push(`entity ${entityResult}`)
          if (fieldResult.created || fieldResult.updated) {
            parts.push(`fields +${fieldResult.created} / ~${fieldResult.updated}`)
          }
          logger(`Synced ${entityId} for ${scopeKey}${parts.length ? ` (${parts.join(', ')})` : ''}`)
        }
      } else {
        skipped++
        if (!dryRun && cache) {
          try {
            await cache.set(cacheKey, checksum, { tags: [`custom-entity:${entityId}`, `custom-entity-scope:${scopeKey}`] })
          } catch {}
        }
      }
    }
  }

  return { processed, synchronized, skipped, fieldChanges }
}

export function listCustomEntityIds(): string[] {
  return buildAggregatedConfigs().map((entry) => entry.entityId)
}

export function getAggregatedCustomEntityConfigs(): AggregatedEntityConfig[] {
  return buildAggregatedConfigs()
}
