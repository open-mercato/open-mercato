import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { tableNameFromEntityId } from '@open-mercato/shared/lib/entities/naming'
import {
  canReadSearchEntity,
  type SearchEntityConfigLookup,
} from '@open-mercato/shared/lib/search/entityAccess'
import { CustomEntity, CustomFieldDef } from '@open-mercato/core/modules/entities/data/entities'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { resolveRegisteredEntityTableName } from '@open-mercato/shared/lib/query/engine'
import { createLogger } from '@open-mercato/shared/lib/logger'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['entities.definitions.view'] },
}

const ALLOWED_ROUTE_CONTEXT_FIELDS = new Set(['kind', 'entity_id', 'product_id'])

const logger = createLogger('entities')

/**
 * GHSA-9mqj-q2h7-8279: `labelField` decides which column of the target entity is
 * selected and echoed back as each option's `label`. It arrives from the query
 * string, so an unchecked value turns this endpoint into an arbitrary-column
 * reader (`?labelField=password_hash`). Only fields that are display labels by
 * construction may serve as the label source; everything else is dropped and
 * resolution falls through to the safe candidates below (`id` at worst).
 */
const SAFE_LABEL_FIELDS = new Set([
  'name',
  'title',
  'code',
  'email',
  'label',
  'display_name',
  'displayName',
  'full_name',
  'fullName',
  'first_name',
  'firstName',
  'last_name',
  'lastName',
  'primary_email',
  'sku',
  'reference',
  'number',
])

/**
 * Structural shape of the `rbacService` consumed by the per-entity read gate —
 * same narrowing the search API route uses, so tests can pass a plain object.
 */
type RbacLike = {
  loadAcl: (
    userId: string,
    scope: { tenantId: string | null; organizationId: string | null },
  ) => Promise<{ isSuperAdmin: boolean; features: string[]; organizations: string[] | null }>
}

/**
 * Custom (doc-storage) entities keep their admin-chosen label field — e.g. a
 * tenant entity labeled by its own `summary` column — so a field outside
 * `SAFE_LABEL_FIELDS` is still acceptable when it is an active, non-encrypted
 * declared field of that entity. Encrypted fields are refused: their doc value
 * is ciphertext and must never be projected as a plain option label.
 */
async function isDeclaredLabelField(
  em: EntityManager,
  entityId: string,
  field: string,
  scope: { organizationId: string | null; tenantId: string | null },
): Promise<boolean> {
  if (!field) return false
  try {
    const defs = await em.find(CustomFieldDef, {
      entityId,
      isActive: true,
      $and: [
        { $or: [{ organizationId: scope.organizationId ?? (undefined as any) }, { organizationId: null }] },
        { $or: [{ tenantId: scope.tenantId ?? (undefined as any) }, { tenantId: null }] },
      ],
    } as any, { fields: ['key', 'configJson'] } as any)
    return defs.some((def) => {
      if (def.key !== field) return false
      const config = def.configJson
      return !(config && typeof config === 'object' && (config as Record<string, unknown>).encrypted === true)
    })
  } catch {
    return false
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const entityId = url.searchParams.get('entityId') || ''
  const requestedLabelField = url.searchParams.get('labelField') || ''
  const q = url.searchParams.get('q') || ''
  const ids = Array.from(
    new Set(
      (url.searchParams.get('ids') || '')
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    ),
  )
  const routeContextFields = Array.from(
    new Set(
      (url.searchParams.get('routeContextFields') || '')
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => ALLOWED_ROUTE_CONTEXT_FIELDS.has(entry)),
    ),
  )
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.tenantId || (!auth.orgId && !auth.isSuperAdmin)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!entityId) return NextResponse.json({ items: [] })

  const container = await createRequestContainer()
  const qe = container.resolve('queryEngine') as QueryEngine
  const em = container.resolve('em') as EntityManager

  const customEntity = await em.findOne(CustomEntity, {
    entityId,
    $and: [
      { $or: [ { organizationId: auth.orgId ?? undefined as any }, { organizationId: null } ] },
      { $or: [ { tenantId: auth.tenantId ?? undefined as any }, { tenantId: null } ] },
    ],
    isActive: true,
  })

  // A relation field can point at an entity that does not exist — most often a half-configured
  // `relatedEntityId` that was never filled in (#4949 reported `entityId=p:0`). The query engine
  // falls back to a pluralized table-name guess for ids it cannot resolve, so such a lookup used
  // to reach Postgres as `select ... from "0s"` and escape this handler as an unhandled 500 on
  // every render of the section holding the field. Resolve the id first and answer with an empty
  // option list instead, mirroring the empty-`entityId` contract above.
  if (!customEntity && resolveRegisteredEntityTableName(em, entityId) === null) {
    logger.warn('Relation options requested for an unresolvable entity id', { entityId })
    return NextResponse.json({ items: [] })
  }

  // GHSA-9mqj-q2h7-8279: `entities.definitions.view` authorizes managing custom-entity
  // definitions, not reading every registered ORM entity. Without a target-entity gate
  // this route happily projected any column of any table in the caller's reach —
  // password hashes within the tenant, or tenant names from tables the query engine
  // cannot even tenant-scope. Registered ORM targets now require the same per-entity
  // read grant the search pipeline enforces (`aclFeatures` declared in the target's
  // `search.ts`, matched through `canReadSearchEntity`), failing closed when the entity
  // is not registered for search or declares no gate. Doc-storage custom entities keep
  // working unchanged: they are this module's own records, never search-registered, and
  // the caller already passed this route's `entities.definitions.view` guard.
  if (!customEntity) {
    if (!container.hasRegistration('rbacService') || !container.hasRegistration('searchIndexer')) {
      logger.warn('Relation options cannot resolve the per-entity read ACL', {
        entityId,
        rbacService: container.hasRegistration('rbacService'),
        searchIndexer: container.hasRegistration('searchIndexer'),
      })
      return NextResponse.json({ error: 'Relation options unavailable' }, { status: 503 })
    }
    const rbac = container.resolve('rbacService') as RbacLike
    const searchIndexer = container.resolve('searchIndexer') as SearchEntityConfigLookup
    const acl = await rbac.loadAcl(auth.sub, {
      tenantId: auth.tenantId ?? null,
      organizationId: auth.orgId ?? null,
    })
    const allowed = canReadSearchEntity(entityId, searchIndexer, {
      grantedFeatures: acl.features,
      isSuperAdmin: acl.isSuperAdmin,
    }, {
      onDeny: (deniedEntityId, reason) => {
        logger.warn('Relation options denied by the target-entity read ACL', { entityId: deniedEntityId, reason })
      },
    })
    if (!allowed) return NextResponse.json({ items: [] })
  }

  // Label resolution (GHSA-9mqj-q2h7-8279): caller-supplied and entity-configured
  // values are only honored when they are safe by construction — a member of the
  // display-label allowlist, or (doc-storage custom entities only) an active,
  // non-encrypted declared field of that entity. Anything else is dropped and the
  // resolution falls through to the fixed sniff candidates and finally `id`, so the
  // projection can no longer be steered at arbitrary columns like `password_hash`.
  const labelScope = { organizationId: auth.orgId ?? null, tenantId: auth.tenantId ?? null }
  const isSafeLabelField = async (field: string): Promise<boolean> =>
    SAFE_LABEL_FIELDS.has(field)
    || (customEntity != null && await isDeclaredLabelField(em, entityId, field, labelScope))

  let labelFieldSource = ''
  if (requestedLabelField) {
    if (await isSafeLabelField(requestedLabelField)) {
      labelFieldSource = requestedLabelField
    } else {
      logger.warn('Rejected an unsafe relation options labelField', { entityId, labelField: requestedLabelField })
    }
  } else {
    const configured = typeof customEntity?.labelField === 'string' ? customEntity.labelField : ''
    if (configured && await isSafeLabelField(configured)) {
      labelFieldSource = configured
    } else if (configured) {
      logger.warn('Rejected an unsafe configured relation labelField', { entityId, labelField: configured })
    }
  }

  if (!labelFieldSource) {
    const candidates = ['name', 'title', 'code', 'email']
    const table = tableNameFromEntityId(entityId)
    const db = (em as any).getKysely() as any
    for (const c of candidates) {
      const exists = await db
        .selectFrom('information_schema.columns')
        .select('column_name')
        .where('table_name', '=', table)
        .where('column_name', '=', c)
        .executeTakeFirst()
      if (exists) { labelFieldSource = c; break }
    }
    if (!labelFieldSource) labelFieldSource = 'id'
  } else if (!customEntity && labelFieldSource !== 'id') {
    // A safe-listed label must also be a real column of the registered target table —
    // otherwise the query engine would raise on the missing column. Degrade to `id`
    // instead of failing the whole option list.
    const table = resolveRegisteredEntityTableName(em, entityId)
    const db = (em as any).getKysely() as any
    const exists = table
      ? await db
        .selectFrom('information_schema.columns')
        .select('column_name')
        .where('table_name', '=', table)
        .where('column_name', '=', labelFieldSource)
        .executeTakeFirst()
      : undefined
    if (!exists) labelFieldSource = 'id'
  }
  const labelField = labelFieldSource
  const filters: Record<string, unknown> = {}
  if (ids.length === 1) filters.id = ids[0]
  else if (ids.length > 1) filters.id = { $in: ids }
  if (q) filters[labelField] = { $ilike: `%${escapeLikePattern(q)}%` }
  const fields = Array.from(new Set(['id', labelField, ...routeContextFields]))
  const res = await qe.query(entityId, {
    tenantId: auth.tenantId ?? undefined,
    ...(auth.orgId ? { organizationId: auth.orgId } : {}),
    fields,
    filters,
    page: { page: 1, pageSize: Math.min(ids.length || 50, 200) },
  })
  const items = (res.items || []).map((it: any) => {
    const routeContext = routeContextFields.reduce<Record<string, unknown>>((acc, field) => {
      if (it[field] !== undefined) {
        acc[field] = it[field]
      }
      return acc
    }, {})
    return {
      value: String(it.id),
      label: String(it[labelField] ?? it.id),
      ...(Object.keys(routeContext).length > 0 ? { routeContext } : {}),
    }
  })
  return NextResponse.json({ items })
}

const relationOptionsQuerySchema = z.object({
  entityId: z.string().min(1),
  labelField: z.string().optional(),
  q: z.string().optional(),
  ids: z.string().optional(),
  routeContextFields: z.string().optional(),
})

const relationOptionsResponseSchema = z.object({
  items: z.array(
    z.object({
      value: z.string(),
      label: z.string(),
      routeContext: z.record(z.string(), z.unknown()).optional(),
    })
  ),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Entities',
  summary: 'Relation options lookup',
  methods: {
    GET: {
      summary: 'List relation options',
      description: 'Returns up to 200 option entries for populating relation dropdowns, automatically resolving label fields when omitted. An entityId that matches neither an active custom entity nor a registered ORM entity yields an empty option list. Registered ORM targets additionally require the caller to hold the target entity\'s declared search `aclFeatures` (superadmins exempt) and answer with an empty list otherwise; `labelField` is only honored when it names a safe display field of the target.',
      query: relationOptionsQuerySchema,
      responses: [
        {
          status: 200,
          description: 'Option list',
          schema: relationOptionsResponseSchema,
        },
        {
          status: 401,
          description: 'Missing authentication',
          schema: z.object({ error: z.string() }),
        },
        {
          status: 503,
          description: 'The per-entity read ACL cannot be resolved (rbacService or searchIndexer unavailable in the container)',
          schema: z.object({ error: z.string() }),
        },
      ],
    },
  },
}
