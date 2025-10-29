import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { Role } from '@open-mercato/core/modules/auth/data/entities'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { ApiKey } from '../../data/entities'
import { createApiKeySchema } from '../../data/validators'
import { generateApiKeySecret, hashApiKey } from '../../services/apiKeyService'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

const listQuerySchema = z.object({
  page: z.string().optional(),
  pageSize: z.string().optional(),
  search: z.string().optional(),
})

const apiKeyRoleSchema = z.object({
  id: z.string().describe('Role identifier or alias assigned to the key'),
  name: z.string().nullable().describe('Display name of the mapped role, if available'),
})

const apiKeyListItemSchema = z.object({
  id: z.string().describe('API key identifier'),
  name: z.string().describe('Friendly label used to identify the key'),
  description: z.string().nullable().describe('Optional free-form description'),
  keyPrefix: z.string().describe('Public prefix exposed to clients'),
  organizationId: z.string().uuid().nullable().describe('Organization scope of the key'),
  organizationName: z.string().nullable().describe('Resolved organization display name'),
  createdAt: z.string().describe('Creation timestamp (ISO 8601)'),
  lastUsedAt: z.string().nullable().describe('Last time the key was observed in use (ISO 8601)'),
  expiresAt: z.string().nullable().describe('When the key expires (ISO 8601)'),
  roles: z.array(apiKeyRoleSchema).describe('Effective roles applied when this key authenticates'),
})

const apiKeyCollectionResponseSchema = z.object({
  items: z.array(apiKeyListItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
})

const apiKeyCreateResponseSchema = z.object({
  id: z.string().describe('Newly created API key identifier'),
  name: z.string(),
  keyPrefix: z.string(),
  secret: z.string().describe('Full API key value. Shown once for secure persistence.').optional(),
  tenantId: z.string().uuid().nullable(),
  organizationId: z.string().uuid().nullable(),
  roles: z.array(apiKeyRoleSchema),
})

const deleteResponseSchema = z.object({
  success: z.literal(true),
})

const errorSchema = z.object({
  error: z.string(),
})

function json(payload: unknown, init: ResponseInit = { status: 200 }) {
  return new Response(JSON.stringify(payload), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
  })
}

function sanitizeSearchValue(value: string) {
  return value.replace(/[%_]/g, '\\$&')
}

const crud = makeCrudRoute<
  z.infer<typeof createApiKeySchema>,
  never,
  z.infer<typeof listQuerySchema>
>({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['api_keys.view'] },
    POST: { requireAuth: true, requireFeatures: ['api_keys.create'] },
    DELETE: { requireAuth: true, requireFeatures: ['api_keys.delete'] },
  },
  orm: { entity: ApiKey, orgField: null },
  list: { schema: listQuerySchema },
  create: {
    schema: createApiKeySchema,
    mapToEntity: (input, ctx) => {
      const secretData = (ctx as any).__apiKeySecret as { secret: string; prefix: string } | undefined
      if (!secretData) throw new Error('API key secret not prepared')
      const roleIds = Array.isArray((ctx as any).__apiKeyRoleIds) ? (ctx as any).__apiKeyRoleIds as string[] : []
      const organizationId = (ctx as any).__apiKeyOrganizationId as string | null
      return {
        name: input.name,
        description: input.description ?? null,
        organizationId,
        keyHash: hashApiKey(secretData.secret),
        keyPrefix: secretData.prefix,
        rolesJson: roleIds,
        createdBy: ctx.auth?.sub ?? null,
        expiresAt: input.expiresAt ?? null,
      }
    },
    response: (entity) => {
      const secret = (entity as any).__apiKeySecret as string | undefined
      const roles = (entity as any).__apiKeyRoles as Role[] | undefined
      return {
        id: String(entity.id),
        name: entity.name,
        keyPrefix: entity.keyPrefix,
        secret,
        tenantId: entity.tenantId ?? null,
        organizationId: entity.organizationId ?? null,
        roles: Array.isArray(roles)
          ? roles.map((role) => ({ id: String(role.id), name: role.name ?? null }))
          : (Array.isArray(entity.rolesJson) ? entity.rolesJson.map((id: string) => ({ id, name: null })) : []),
      }
    },
  },
  del: { idFrom: 'query' },
  hooks: {
    beforeList: async (query, ctx) => {
      const auth = ctx.auth
      const { translate } = await resolveTranslations()
      if (!auth?.tenantId) throw json({ error: translate('api_keys.errors.tenantRequired', 'Tenant context required') }, { status: 400 })
      const page = Math.max(parseInt(query.page ?? '1', 10) || 1, 1)
      const pageSize = Math.min(Math.max(parseInt(query.pageSize ?? '20', 10) || 20, 1), 200)
      const search = (query.search ?? '').trim().toLowerCase()

      if (Array.isArray(ctx.organizationIds) && ctx.organizationIds.length === 0) {
        throw json({ items: [], total: 0, page, pageSize, totalPages: 0 })
      }

      const em = ctx.container.resolve<EntityManager>('em')
      const qb = em.createQueryBuilder(ApiKey, 'k')
      qb.where({ deletedAt: null })
      qb.andWhere({ tenantId: auth.tenantId })
      if (Array.isArray(ctx.organizationIds) && ctx.organizationIds.length > 0) {
        qb.andWhere({ organizationId: { $in: ctx.organizationIds as any } })
      } else if (auth.orgId) {
        qb.andWhere({ organizationId: auth.orgId })
      }
      if (search) {
        const pattern = `%${sanitizeSearchValue(search)}%`
        qb.andWhere({
          $or: [
            { name: { $ilike: pattern } },
            { keyPrefix: { $ilike: pattern } },
          ],
        })
      }
      qb.orderBy({ createdAt: 'desc' })
      qb.limit(pageSize).offset((page - 1) * pageSize)
      const [items, total] = await qb.getResultAndCount()

      if (!items.length) {
        throw json({ items: [], total, page, pageSize, totalPages: Math.ceil(total / pageSize) })
      }

      const roleIdSet = new Set<string>()
      const orgIdSet = new Set<string>()
      for (const item of items) {
        if (Array.isArray(item.rolesJson)) {
          for (const roleId of item.rolesJson) roleIdSet.add(String(roleId))
        }
        if (item.organizationId) orgIdSet.add(String(item.organizationId))
      }

      const [roles, organizations] = await Promise.all([
        roleIdSet.size ? em.find(Role, { id: { $in: Array.from(roleIdSet) as any } } as any) : [],
        orgIdSet.size ? em.find(Organization, { id: { $in: Array.from(orgIdSet) as any } } as any) : [],
      ])
      const roleMap = new Map(roles.map((role) => [String(role.id), role.name ?? null]))
      const orgMap = new Map(organizations.map((org) => [String(org.id), org.name ?? null]))

      const payload = {
        items: items.map((item) => ({
          id: item.id,
          name: item.name,
          description: item.description ?? null,
          keyPrefix: item.keyPrefix,
          organizationId: item.organizationId ?? null,
          organizationName: item.organizationId ? orgMap.get(String(item.organizationId)) ?? null : null,
          createdAt: item.createdAt,
          lastUsedAt: item.lastUsedAt ?? null,
          expiresAt: item.expiresAt ?? null,
          roles: Array.isArray(item.rolesJson)
            ? item.rolesJson.map((id) => ({ id, name: roleMap.get(String(id)) ?? null }))
            : [],
        })),
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      }

      throw json(payload)
    },
    beforeCreate: async (input, ctx) => {
      const auth = ctx.auth
      const { translate } = await resolveTranslations()
      if (!auth?.tenantId) throw json({ error: translate('api_keys.errors.tenantRequired', 'Tenant context required') }, { status: 400 })

      const secretData = generateApiKeySecret()
      ;(ctx as any).__apiKeySecret = secretData

      const em = ctx.container.resolve<EntityManager>('em')
      const roleTokens = Array.isArray(input.roles) ? input.roles.filter((value) => typeof value === 'string' && value.trim().length > 0) : []
      const roleEntities: Role[] = []
      const roleIds: string[] = []
      for (const token of roleTokens) {
        const value = token.trim()
        let role: Role | null = null
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
          role = await em.findOne(Role, { id: value })
        }
        if (!role) {
          role = await em.findOne(Role, { name: value })
        }
        if (!role) {
          throw json({ error: translate('api_keys.errors.roleNotFound', `Role ${value} not found`, { identifier: value }) }, { status: 400 })
        }
        if (role.tenantId && auth.tenantId && role.tenantId !== auth.tenantId) {
          throw json({ error: translate('api_keys.errors.roleWrongTenant', `Role ${role.name} belongs to another tenant`, { role: role.name ?? value }) }, { status: 400 })
        }
        roleEntities.push(role)
        roleIds.push(String(role.id))
      }
      ;(ctx as any).__apiKeyRoles = roleEntities
      ;(ctx as any).__apiKeyRoleIds = roleIds

      const allowedIds = ctx.organizationScope?.allowedIds ?? null
      const organizationId = input.organizationId ?? ctx.selectedOrganizationId ?? auth.orgId ?? null
      if (organizationId && Array.isArray(allowedIds) && allowedIds.length > 0) {
        if (!allowedIds.includes(organizationId)) {
          throw json({ error: translate('api_keys.errors.organizationOutOfScope', 'Organization out of scope') }, { status: 403 })
        }
      }
      ;(ctx as any).__apiKeyOrganizationId = organizationId ?? null

      return { ...input, organizationId }
    },
    afterCreate: async (entity, ctx) => {
      const secretData = (ctx as any).__apiKeySecret as { secret: string } | undefined
      const roles = (ctx as any).__apiKeyRoles as Role[] | undefined
      if (secretData) (entity as any).__apiKeySecret = secretData.secret
      if (roles) (entity as any).__apiKeyRoles = roles
      try {
        const rbac = ctx.container.resolve<RbacService>('rbacService')
        await rbac.invalidateUserCache(`api_key:${entity.id}`)
      } catch {}
    },
    beforeDelete: async (id, ctx) => {
      const auth = ctx.auth
      const { translate } = await resolveTranslations()
      if (!auth?.tenantId) throw json({ error: translate('api_keys.errors.tenantRequired', 'Tenant context required') }, { status: 400 })
      const em = ctx.container.resolve<EntityManager>('em')
      const record = await em.findOne(ApiKey, { id, deletedAt: null })
      if (!record) throw json({ error: translate('api_keys.errors.notFound', 'Not found') }, { status: 404 })
      if (record.tenantId && record.tenantId !== auth.tenantId) {
        throw json({ error: translate('api_keys.errors.forbidden', 'Forbidden') }, { status: 403 })
      }
      const allowedIds = ctx.organizationScope?.allowedIds ?? null
      if (record.organizationId && Array.isArray(allowedIds) && allowedIds.length > 0) {
        if (!allowedIds.includes(record.organizationId)) {
          throw json({ error: translate('api_keys.errors.organizationOutOfScope', 'Organization out of scope') }, { status: 403 })
        }
      }
      ;(ctx as any).__apiKeyOrganizationId = record.organizationId ?? null
    },
    afterDelete: async (id, ctx) => {
      try {
        const rbac = ctx.container.resolve<RbacService>('rbacService')
        await rbac.invalidateUserCache(`api_key:${id}`)
      } catch {}
    },
  },
})

export const metadata = crud.metadata
export const GET = crud.GET
export const POST = crud.POST
export const DELETE = crud.DELETE

export const openApi: OpenApiRouteDoc = {
  summary: 'Manage API keys',
  description:
    'Provides list, creation, and deletion capabilities for API keys scoped to the authenticated tenant and organization.',
  methods: {
    GET: {
      summary: 'List API keys',
      description:
        'Returns paginated API keys visible to the current user, including per-key role assignments and organization context.',
      query: listQuerySchema,
      responses: [
        {
          status: 200,
          description: 'Collection of API keys',
          schema: apiKeyCollectionResponseSchema,
        },
      ],
      errors: [
        { status: 400, description: 'Tenant context missing', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Forbidden by organization scope', schema: errorSchema },
      ],
    },
    POST: {
      summary: 'Create API key',
      description:
        'Creates a new API key, returning the one-time secret value together with the generated key prefix and scope details.',
      requestBody: {
        contentType: 'application/json',
        schema: createApiKeySchema,
        description: 'API key definition including optional scope and role assignments.',
      },
      responses: [
        {
          status: 201,
          description: 'API key created successfully',
          schema: apiKeyCreateResponseSchema,
        },
      ],
      errors: [
        { status: 400, description: 'Invalid payload or missing tenant context', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Organization outside allowed scope', schema: errorSchema },
      ],
    },
    DELETE: {
      summary: 'Delete API key',
      description:
        'Removes an API key by identifier. The key must belong to the current tenant and fall within the requester organization scope.',
      query: z.object({
        id: z.string().uuid().describe('API key identifier to delete'),
      }),
      responses: [
        { status: 200, description: 'Key deleted successfully', schema: deleteResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Missing or invalid identifier', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Organization outside allowed scope', schema: errorSchema },
        { status: 404, description: 'Key not found within scope', schema: errorSchema },
      ],
    },
  },
}
