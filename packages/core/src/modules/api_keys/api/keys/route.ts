import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { Role } from '@open-mercato/core/modules/auth/data/entities'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { ApiKey } from '../../data/entities'
import { createApiKeySchema } from '../../data/validators'
import { generateApiKeySecret, hashApiKey } from '../../services/apiKeyService'

const listQuerySchema = z.object({
  page: z.string().optional(),
  pageSize: z.string().optional(),
  search: z.string().optional(),
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
      const secretData = (ctx as any).__apiKeySecret as { secret: string; prefix: string }
      const roles = Array.isArray(input.roles) ? input.roles : []
      const organizationId = (ctx as any).__apiKeyOrganizationId as string | null
      return {
        name: input.name,
        description: input.description ?? null,
        organizationId,
        keyHash: hashApiKey(secretData.secret),
        keyPrefix: secretData.prefix,
        rolesJson: roles,
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
      if (!auth?.tenantId) throw json({ error: 'Tenant context required' }, { status: 400 })
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
      if (!auth?.tenantId) throw json({ error: 'Tenant context required' }, { status: 400 })

      const secretData = generateApiKeySecret()
      ;(ctx as any).__apiKeySecret = secretData

      const em = ctx.container.resolve<EntityManager>('em')
      const roleIds = Array.isArray(input.roles) ? input.roles : []
      const roleEntities = roleIds.length
        ? await em.find(Role, { id: { $in: roleIds as any } } as any)
        : []
      if (roleEntities.length !== roleIds.length) {
        throw json({ error: 'One or more roles not found' }, { status: 400 })
      }
      const invalidTenant = roleEntities.find((role) => role.tenantId && role.tenantId !== auth.tenantId)
      if (invalidTenant) {
        throw json({ error: `Role ${invalidTenant.name} belongs to another tenant` }, { status: 400 })
      }
      ;(ctx as any).__apiKeyRoles = roleEntities

      const organizationId = input.organizationId ?? ctx.selectedOrganizationId ?? auth.orgId ?? null
      if (organizationId && Array.isArray(ctx.organizationScope?.allowedIds) && ctx.organizationScope!.allowedIds!.length > 0) {
        if (!ctx.organizationScope!.allowedIds!.includes(organizationId)) {
          throw json({ error: 'Organization out of scope' }, { status: 403 })
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
      if (!auth?.tenantId) throw json({ error: 'Tenant context required' }, { status: 400 })
      const em = ctx.container.resolve<EntityManager>('em')
      const record = await em.findOne(ApiKey, { id, deletedAt: null })
      if (!record) throw json({ error: 'Not found' }, { status: 404 })
      if (record.tenantId && record.tenantId !== auth.tenantId) {
        throw json({ error: 'Forbidden' }, { status: 403 })
      }
      if (record.organizationId && Array.isArray(ctx.organizationScope?.allowedIds) && ctx.organizationScope!.allowedIds!.length > 0) {
        if (!ctx.organizationScope!.allowedIds!.includes(record.organizationId)) {
          throw json({ error: 'Organization out of scope' }, { status: 403 })
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
