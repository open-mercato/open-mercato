/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { User, Role, UserRole, UserAcl } from '@open-mercato/core/modules/auth/data/entities'
import { Organization, Tenant } from '@open-mercato/core/modules/directory/data/entities'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { splitCustomFieldPayload, loadCustomFieldValues } from '@open-mercato/shared/lib/crud/custom-fields'
import type { EntityManager } from '@mikro-orm/postgresql'

const querySchema = z.object({
  id: z.string().uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  search: z.string().optional(),
  organizationId: z.string().uuid().optional(),
  roleIds: z.array(z.string().uuid()).optional(),
}).passthrough()

const createSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  organizationId: z.string().uuid(),
  roles: z.array(z.string()).optional(),
})

const updateSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  organizationId: z.string().uuid().optional(),
  roles: z.array(z.string()).optional(),
})

const rawBodySchema = z.object({}).passthrough()

type CrudInput = Record<string, unknown>

type CreateHookState = {
  input: z.infer<typeof createSchema>
  custom: Record<string, unknown>
  passwordHash: string
  tenantId: string | null
  roles: string[]
}

type UpdateHookState = {
  input: z.infer<typeof updateSchema>
  custom: Record<string, unknown>
  passwordHash: string | null
  roles?: string[]
  shouldInvalidateCache: boolean
}

const createStateStore = new WeakMap<object, CreateHookState>()
const updateStateStore = new WeakMap<object, UpdateHookState>()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['auth.users.list'] },
  POST: { requireAuth: true, requireFeatures: ['auth.users.create'] },
  PUT: { requireAuth: true, requireFeatures: ['auth.users.edit'] },
  DELETE: { requireAuth: true, requireFeatures: ['auth.users.delete'] },
}

export const metadata = routeMetadata

const crud = makeCrudRoute<CrudInput, CrudInput, Record<string, unknown>>({
  metadata: routeMetadata,
  orm: {
    entity: User,
    idField: 'id',
    orgField: null,
    tenantField: null,
    softDeleteField: 'deletedAt',
  },
  events: { module: 'auth', entity: 'user', persistent: true },
  indexer: { entityType: E.auth.user },
  resolveIdentifiers: (entity) => ({
    id: String((entity as any).id),
    organizationId: (entity as any).organizationId ? String((entity as any).organizationId) : null,
    tenantId: (entity as any).tenantId ? String((entity as any).tenantId) : null,
  }),
  create: {
    schema: rawBodySchema,
    mapToEntity: (input) => {
      const state = createStateStore.get(input as object)
      if (!state) throw new CrudHttpError(400, { error: 'Invalid input' })
      return {
        email: state.input.email,
        passwordHash: state.passwordHash,
        isConfirmed: true,
        organizationId: state.input.organizationId,
        tenantId: state.tenantId,
      }
    },
    response: (entity: User) => ({ id: String(entity.id) }),
  },
  update: {
    schema: rawBodySchema,
    applyToEntity: (entity: User, input) => {
      const state = updateStateStore.get(input as object)
      if (!state) throw new CrudHttpError(400, { error: 'Invalid input' })
      const data = state.input
      if (data.email !== undefined) entity.email = data.email
      if (data.organizationId !== undefined) entity.organizationId = data.organizationId
      if (state.passwordHash) entity.passwordHash = state.passwordHash
    },
    response: () => ({ ok: true }),
  },
  del: {
    idFrom: 'query',
    softDelete: false,
    response: () => ({ ok: true }),
  },
  hooks: {
    beforeCreate: async (raw, ctx) => {
      const { base, custom } = splitCustomFieldPayload(raw)
      const parsed = createSchema.safeParse(base)
      if (!parsed.success) throw new CrudHttpError(400, { error: 'Invalid input' })

      const em = ctx.container.resolve<EntityManager>('em')
      const org = await em.findOne(Organization, { id: parsed.data.organizationId }, { populate: ['tenant'] })
      if (!org) throw new CrudHttpError(400, { error: 'Organization not found' })

      const { hash } = await import('bcryptjs')
      const passwordHash = await hash(parsed.data.password, 10)
      const tenantId = org.tenant?.id ? String(org.tenant.id) : null
      const roles = Array.isArray(parsed.data.roles) ? parsed.data.roles : []

      createStateStore.set(raw as object, {
        input: parsed.data,
        custom,
        passwordHash,
        tenantId,
        roles,
      })
    },
    afterCreate: async (entity, ctx) => {
      const state = createStateStore.get(ctx.input as object)
      if (!state) return
      const em = ctx.container.resolve<EntityManager>('em')

      if (state.roles.length) {
        for (const name of state.roles) {
          let role = await em.findOne(Role, { name })
          if (!role) {
            role = em.create(Role, { name, tenantId: entity.tenantId ? String(entity.tenantId) : null })
            await em.persistAndFlush(role)
          }
          const link = em.create(UserRole, { user: entity, role })
          await em.persistAndFlush(link)
        }
      }

      if (Object.keys(state.custom).length) {
        const de = ctx.container.resolve<DataEngine>('dataEngine')
        await de.setCustomFields({
          entityId: E.auth.user,
          recordId: String(entity.id),
          organizationId: entity.organizationId ? String(entity.organizationId) : null,
          tenantId: entity.tenantId ? String(entity.tenantId) : null,
          values: state.custom,
          notify: false,
        })
      }

      createStateStore.delete(ctx.input as object)
    },
    beforeUpdate: async (raw) => {
      const { base, custom } = splitCustomFieldPayload(raw)
      const parsed = updateSchema.safeParse(base)
      if (!parsed.success) throw new CrudHttpError(400, { error: 'Invalid input' })

      let passwordHash: string | null = null
      if (parsed.data.password) {
        const { hash } = await import('bcryptjs')
        passwordHash = await hash(parsed.data.password, 10)
      }

      const shouldInvalidateCache = parsed.data.organizationId !== undefined || parsed.data.roles !== undefined

      updateStateStore.set(raw as object, {
        input: parsed.data,
        custom,
        passwordHash,
        roles: parsed.data.roles,
        shouldInvalidateCache,
      })
    },
    afterUpdate: async (entity, ctx) => {
      const state = updateStateStore.get(ctx.input as object)
      if (!state) return
      const em = ctx.container.resolve<EntityManager>('em')

      if (Array.isArray(state.roles)) {
        const current = await em.find(UserRole, { user: entity as any }, { populate: ['role'] })
        const currentNames = new Set(
          current
            .map((ur: any) => (ur.role?.name ? String(ur.role.name) : null))
            .filter((name): name is string => !!name),
        )
        const desired = new Set(state.roles)

        for (const link of current) {
          const name = link.role?.name ? String(link.role.name) : ''
          if (!desired.has(name)) {
            em.remove(link)
          }
        }

        for (const name of desired) {
          if (!currentNames.has(name)) {
            let role = await em.findOne(Role, { name })
            if (!role) {
              role = em.create(Role, { name, tenantId: entity.tenantId ? String(entity.tenantId) : null })
              await em.persistAndFlush(role)
            }
            em.persist(em.create(UserRole, { user: entity as any, role: role as any }))
          }
        }

        await em.flush()
      }

      if (Object.keys(state.custom).length) {
        const de = ctx.container.resolve<DataEngine>('dataEngine')
        await de.setCustomFields({
          entityId: E.auth.user,
          recordId: String(entity.id),
          organizationId: entity.organizationId ? String(entity.organizationId) : null,
          tenantId: entity.tenantId ? String(entity.tenantId) : null,
          values: state.custom,
          notify: false,
        })
      }

      if (state.shouldInvalidateCache) {
        const rbacService = ctx.container.resolve('rbacService') as { invalidateUserCache: (userId: string) => Promise<void> }
        await rbacService.invalidateUserCache(state.input.id)
        try {
          const cache = ctx.container.resolve('cache') as { deleteByTags?: (tags: string[]) => Promise<void> }
          if (cache?.deleteByTags) await cache.deleteByTags([`rbac:user:${state.input.id}`])
        } catch {
          // noop — cache not available
        }
      }

      updateStateStore.delete(ctx.input as object)
    },
    beforeDelete: async (id, ctx) => {
      const em = ctx.container.resolve<EntityManager>('em')
      await em.nativeDelete(UserAcl, { user: id as any })
      await em.nativeDelete(UserRole, { user: id as any })
    },
    afterDelete: async (id, ctx) => {
      const rbacService = ctx.container.resolve('rbacService') as { invalidateUserCache: (userId: string) => Promise<void> }
      await rbacService.invalidateUserCache(id)
      try {
        const cache = ctx.container.resolve('cache') as { deleteByTags?: (tags: string[]) => Promise<void> }
        if (cache?.deleteByTags) await cache.deleteByTags([`rbac:user:${id}`])
      } catch {
        // noop — cache not available
      }
    },
  },
})

export async function GET(req: Request) {
  const auth = getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ items: [], total: 0, totalPages: 1 })
  const url = new URL(req.url)
  const rawRoleIds = url.searchParams.getAll('roleId').filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
  const parsed = querySchema.safeParse({
    id: url.searchParams.get('id') || undefined,
    page: url.searchParams.get('page') || undefined,
    pageSize: url.searchParams.get('pageSize') || undefined,
    search: url.searchParams.get('search') || undefined,
    organizationId: url.searchParams.get('organizationId') || undefined,
    roleIds: rawRoleIds.length ? rawRoleIds : undefined,
  })
  if (!parsed.success) return NextResponse.json({ items: [], total: 0, totalPages: 1 })
  const { resolve } = await createRequestContainer()
  const em = resolve('em') as any
  let isSuperAdmin = false
  try {
    if (auth.sub) {
      const rbacService = resolve('rbacService') as any
      const acl = await rbacService.loadAcl(auth.sub, { tenantId: auth.tenantId ?? null, organizationId: auth.orgId ?? null })
      isSuperAdmin = !!acl?.isSuperAdmin
    }
  } catch (err) {
    console.error('users: failed to resolve rbac', err)
  }
  const { id, page, pageSize, search, organizationId, roleIds } = parsed.data
  const where: any = { deletedAt: null }
  if (!isSuperAdmin) {
    if (!auth.tenantId) {
      return NextResponse.json({ items: [], total: 0, totalPages: 1, isSuperAdmin })
    }
    where.tenantId = auth.tenantId
  }
  if (organizationId) where.organizationId = organizationId
  if (search) where.email = { $ilike: `%${search}%` } as any
  let idFilter: Set<string> | null = id ? new Set([id]) : null
  if (Array.isArray(roleIds) && roleIds.length > 0) {
    const uniqueRoleIds = Array.from(new Set(roleIds))
    const linksForRoles = await em.find(UserRole, { role: { $in: uniqueRoleIds as any } } as any)
    const roleUserIds = new Set<string>()
    for (const link of linksForRoles) {
      const uid = String((link as any).user?.id || (link as any).user || '')
      if (uid) roleUserIds.add(uid)
    }
    if (roleUserIds.size === 0) return NextResponse.json({ items: [], total: 0, totalPages: 1 })
    if (idFilter) {
      for (const uid of Array.from(idFilter)) {
        if (!roleUserIds.has(uid)) idFilter.delete(uid)
      }
    } else {
      idFilter = roleUserIds
    }
    if (!idFilter || idFilter.size === 0) return NextResponse.json({ items: [], total: 0, totalPages: 1 })
  }
  if (idFilter && idFilter.size) {
    where.id = { $in: Array.from(idFilter) as any }
  } else if (id) {
    where.id = id
  }
  const [rows, count] = await em.findAndCount(User, where, { limit: pageSize, offset: (page - 1) * pageSize })
  const userIds = rows.map((u: any) => u.id)
  const links = userIds.length ? await em.find(UserRole, { user: { $in: userIds as any } } as any, { populate: ['role'] }) : []
  const roleMap: Record<string, string[]> = {}
  for (const l of links) {
    const uid = String((l as any).user?.id || (l as any).user)
    const rname = String((l as any).role?.name || '')
    if (!roleMap[uid]) roleMap[uid] = []
    if (rname) roleMap[uid].push(rname)
  }
  const orgIds = rows
    .map((u: any) => (u.organizationId ? String(u.organizationId) : null))
    .filter((id): id is string => !!id)
  const uniqueOrgIds = Array.from(new Set(orgIds))
  let orgMap: Record<string, string> = {}
  if (uniqueOrgIds.length) {
    const organizations = await em.find(
      Organization,
      { id: { $in: uniqueOrgIds as any }, deletedAt: null },
    )
    orgMap = organizations.reduce<Record<string, string>>((acc, org) => {
      const orgId = org?.id ? String(org.id) : null
      if (!orgId) return acc
      const rawName = (org as any)?.name
      const orgName = typeof rawName === 'string' && rawName.length > 0 ? rawName : orgId
      acc[orgId] = orgName
      return acc
    }, {})
  }
  const tenantIds = rows
    .map((u: any) => (u.tenantId ? String(u.tenantId) : null))
    .filter((id): id is string => !!id)
  const uniqueTenantIds = Array.from(new Set(tenantIds))
  let tenantMap: Record<string, string> = {}
  if (uniqueTenantIds.length) {
    const tenants = await em.find(
      Tenant,
      { id: { $in: uniqueTenantIds as any }, deletedAt: null },
    )
    tenantMap = tenants.reduce<Record<string, string>>((acc, tenant) => {
      const tenantId = tenant?.id ? String(tenant.id) : null
      if (!tenantId) return acc
      const rawName = (tenant as any)?.name
      const tenantName = typeof rawName === 'string' && rawName.length > 0 ? rawName : tenantId
      acc[tenantId] = tenantName
      return acc
    }, {})
  }
  const tenantByUser: Record<string, string | null> = {}
  const organizationByUser: Record<string, string | null> = {}
  for (const u of rows) {
    const uid = String(u.id)
    tenantByUser[uid] = u.tenantId ? String(u.tenantId) : null
    organizationByUser[uid] = u.organizationId ? String(u.organizationId) : null
  }
  const cfByUser = userIds.length
    ? await loadCustomFieldValues({
        em,
        entityId: E.auth.user,
        recordIds: userIds.map(String),
        tenantIdByRecord: tenantByUser,
        organizationIdByRecord: organizationByUser,
        tenantFallbacks: auth.tenantId ? [auth.tenantId] : [],
      })
    : {}

  const items = rows.map((u: any) => {
    const uid = String(u.id)
    const orgId = u.organizationId ? String(u.organizationId) : null
    return {
      id: uid,
      email: String(u.email),
      organizationId: orgId,
      organizationName: orgId ? orgMap[orgId] ?? orgId : null,
      tenantId: u.tenantId ? String(u.tenantId) : null,
      tenantName: u.tenantId ? tenantMap[String(u.tenantId)] ?? String(u.tenantId) : null,
      roles: roleMap[uid] || [],
      ...(cfByUser[uid] || {}),
    }
  })
  const totalPages = Math.max(1, Math.ceil(count / pageSize))
  return NextResponse.json({ items, total: count, totalPages, isSuperAdmin })
}

export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE
