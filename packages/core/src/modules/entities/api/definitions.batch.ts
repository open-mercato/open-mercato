import { NextResponse } from 'next/server'
import type { CacheStrategy } from '@open-mercato/cache'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { CustomFieldDef, CustomFieldEntityConfig } from '@open-mercato/core/modules/entities/data/entities'
import { customFieldEntityConfigSchema, upsertCustomFieldDefSchema } from '@open-mercato/core/modules/entities/data/validators'
import { z } from 'zod'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { invalidateDefinitionsCache } from './definitions.cache'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { mergeEntityFieldsetConfig, normalizeEntityFieldsetConfig } from '../lib/fieldsets'
import { resolveEntityDefinitionsVersion } from '../lib/definitions-version'
import {
  beginEntitiesMutationGuard,
  FIELD_DEFINITION_RESOURCE_KIND,
} from './definitions.mutation-guard'
import {
  createExactDefinitionWhere,
  createScopedDefinitionTombstone,
  createVisibleDefinitionWhere,
  markDefinitionTombstoned,
  resolveDefinitionMutationScope,
  selectVisibleDefinitionWinner,
} from '../lib/definition-scope'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['entities.definitions.manage'] },
}

const MAX_DEFINITIONS_PER_BATCH = 1000

const batchSchema = z
  .object({
    entityId: z.string().regex(/^[a-z0-9_]+:[a-z0-9_]+$/),
    definitions: z
      .array(
        upsertCustomFieldDefSchema
          .omit({ entityId: true })
          .extend({
            configJson: z.any().optional(),
          })
      )
      .max(MAX_DEFINITIONS_PER_BATCH),
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
  const scope = await resolveDefinitionMutationScope({ auth, container, request: req })
  const { resolve } = container
  const em = resolve('em') as any
  let cache: CacheStrategy | undefined
  try {
    cache = resolve('cache') as CacheStrategy
  } catch {}

  const guard = await beginEntitiesMutationGuard({
    container,
    auth,
    req,
    resourceKind: FIELD_DEFINITION_RESOURCE_KIND,
    resourceId: entityId,
    operation: 'custom',
    mutationPayload: { entityId, definitionCount: definitions.length },
  })
  if (guard.blockedResponse) return guard.blockedResponse

  // Optimistic locking (issue #3152): the batch upserts a whole definition set,
  // so guard the entity's aggregate schema version (the newest updated_at across
  // its field definitions and fieldset config). A stale save — another tab changed
  // the schema after this form loaded — fails with the same structured 409 the CRUD
  // path returns. Strictly additive: callers that do not send the expected version
  // header pass through unchanged.
  const currentVersion = await resolveEntityDefinitionsVersion(em, {
    entityId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  try {
    enforceCommandOptimisticLock({
      resourceKind: FIELD_DEFINITION_RESOURCE_KIND,
      resourceId: entityId,
      current: currentVersion,
      request: req,
    })
  } catch (err) {
    if (isCrudHttpError(err) && err.status === 409) {
      return NextResponse.json(err.body, { status: err.status })
    }
    throw err
  }

  await em.begin()
  try {
    // Prefetch every existing definition for this entity in a single query, then index
    // by key so the per-definition loop resolves create/update without round trips.
    const defByKey = new Map<string, any>()
    const keys = definitions.map((d) => d.key)
    if (keys.length > 0) {
      const existingDefs = await em.find(CustomFieldDef, {
        ...createExactDefinitionWhere(entityId, { $in: keys }, scope),
      })
      for (const existing of existingDefs) defByKey.set(existing.key, existing)
    }

    const inheritedByKey = new Map<string, any>()
    const inactiveKeys = definitions.filter((d) => d.isActive === false).map((d) => d.key)
    if (inactiveKeys.length > 0) {
      const visibleDefs = await em.find(CustomFieldDef, createVisibleDefinitionWhere(
        entityId,
        { $in: inactiveKeys },
        scope,
        { deletedAt: null, isActive: true },
      ))
      const grouped = new Map<string, any[]>()
      for (const visible of visibleDefs) {
        if (!grouped.has(visible.key)) grouped.set(visible.key, [])
        grouped.get(visible.key)!.push(visible)
      }
      for (const [key, group] of grouped) {
        inheritedByKey.set(key, selectVisibleDefinitionWinner(group))
      }
    }

    for (const [idx, d] of definitions.entries()) {
      const where: any = createExactDefinitionWhere(entityId, d.key, scope)
      let def = defByKey.get(d.key)

      const inCfg = (d as any).configJson ?? {}
      const cfg: Record<string, any> = { ...inCfg }
      if (cfg.label == null || String(cfg.label).trim() === '') cfg.label = d.key
      if (cfg.formEditable === undefined) cfg.formEditable = true
      if (cfg.listVisible === undefined) cfg.listVisible = true
      if (d.kind === 'multiline' && (cfg.editor == null || String(cfg.editor).trim() === '')) cfg.editor = 'markdown'
      cfg.priority = idx

      if (d.isActive === false) {
        const now = new Date()
        const inherited = inheritedByKey.get(d.key)
        if (!def) {
          def = createScopedDefinitionTombstone(
            em,
            {
              entityId,
              key: d.key,
              kind: d.kind,
              configJson: inherited?.configJson ?? cfg,
            },
            scope,
            now,
          )
          defByKey.set(d.key, def)
        } else {
          markDefinitionTombstoned(def, now)
        }
        def.kind = d.kind
        def.configJson = cfg
        def.isActive = false
        def.deletedAt = def.deletedAt ?? now
        def.updatedAt = now
        em.persist(def)
        continue
      }

      if (!def) {
        def = em.create(CustomFieldDef, { ...where, createdAt: new Date() })
        defByKey.set(d.key, def)
      }
      def.kind = d.kind
      def.configJson = cfg
      def.isActive = true
      def.deletedAt = null
      def.updatedAt = new Date()
      em.persist(def)
    }
    if (fieldsets !== undefined || singleFieldsetPerRecord !== undefined) {
      const entityConfigScope: any = { entityId, organizationId: scope.organizationId, tenantId: scope.tenantId }
      let cfg = await em.findOne(CustomFieldEntityConfig, entityConfigScope)
      if (!cfg) cfg = em.create(CustomFieldEntityConfig, { ...entityConfigScope, createdAt: new Date() })
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

  await guard.runAfterSuccess()

  await invalidateDefinitionsCache(cache, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    entityIds: [entityId],
  })

  // Return the post-save version so the form can round-trip the token for a
  // subsequent save (reorder, delete, second save) without a false conflict.
  const nextVersion = await resolveEntityDefinitionsVersion(em, {
    entityId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })

  return NextResponse.json({ ok: true, version: nextVersion })
}

const batchResponseSchema = z.object({
  ok: z.literal(true),
  version: z.string().nullable().optional(),
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
