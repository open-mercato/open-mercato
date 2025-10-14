/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { Role, RoleAcl, UserRole } from '@open-mercato/core/modules/auth/data/entities'
import { Tenant } from '@open-mercato/core/modules/directory/data/entities'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { splitCustomFieldPayload, loadCustomFieldValues } from '@open-mercato/shared/lib/crud/custom-fields'
import type { EntityManager } from '@mikro-orm/postgresql'

const querySchema = z.object({
  id: z.string().uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  search: z.string().optional(),
}).passthrough()

const createSchema = z.object({
  name: z.string().min(2).max(100),
  tenantId: z.string().uuid().nullable().optional(),
})
const updateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(2).max(100).optional(),
  tenantId: z.string().uuid().nullable().optional(),
})

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['auth.roles.list'] },
  POST: { requireAuth: true, requireFeatures: ['auth.roles.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['auth.roles.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['auth.roles.manage'] },
}

export const metadata = routeMetadata

const rawBodySchema = z.object({}).passthrough()
type CrudInput = Record<string, unknown>

type CreateState = {
  input: z.infer<typeof createSchema>
  custom: Record<string, unknown>
  resolvedTenantId: string | null
}

type UpdateState = {
  input: z.infer<typeof updateSchema>
  custom: Record<string, unknown>
}

const createStateStore = new WeakMap<object, CreateState>()
const updateStateStore = new WeakMap<object, UpdateState>()

const crud = makeCrudRoute<CrudInput, CrudInput, Record<string, unknown>>({
  metadata: routeMetadata,
  orm: {
    entity: Role,
    idField: 'id',
    orgField: null,
    tenantField: null,
    softDeleteField: 'deletedAt',
  },
  events: { module: 'auth', entity: 'role', persistent: true },
  indexer: { entityType: E.auth.role },
  resolveIdentifiers: (entity) => ({
    id: String((entity as any).id),
    organizationId: null,
    tenantId: (entity as any).tenantId ? String((entity as any).tenantId) : null,
  }),
  create: {
    schema: rawBodySchema,
    mapToEntity: (input) => {
      const state = createStateStore.get(input as object)
      if (!state) throw new CrudHttpError(400, { error: 'Invalid input' })
      return {
        name: state.input.name,
        tenantId: state.resolvedTenantId ?? null,
      }
    },
    response: (entity: Role) => ({ id: String(entity.id) }),
  },
  update: {
    schema: rawBodySchema,
    applyToEntity: (entity: Role, input) => {
      const state = updateStateStore.get(input as object)
      if (!state) throw new CrudHttpError(400, { error: 'Invalid input' })
      if (state.input.name !== undefined) entity.name = state.input.name
      if (state.input.tenantId !== undefined) entity.tenantId = state.input.tenantId ?? null
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
      const resolvedTenantId = parsed.data.tenantId === undefined ? ctx.auth?.tenantId ?? null : parsed.data.tenantId ?? null
      const token = parsed.data as unknown as object
      createStateStore.set(token, {
        input: parsed.data,
        custom,
        resolvedTenantId,
      })
      return token as CrudInput
    },
    afterCreate: async (entity, ctx) => {
      const state = createStateStore.get(ctx.input as object)
      if (!state) return
      if (Object.keys(state.custom).length) {
        const de = ctx.container.resolve<DataEngine>('dataEngine')
        await de.setCustomFields({
          entityId: E.auth.role,
          recordId: String(entity.id),
          organizationId: null,
          tenantId: state.resolvedTenantId,
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
      const token = parsed.data as unknown as object
      updateStateStore.set(token, {
        input: parsed.data,
        custom,
      })
      return token as CrudInput
    },
    afterUpdate: async (entity, ctx) => {
      const state = updateStateStore.get(ctx.input as object)
      if (!state) return
      if (Object.keys(state.custom).length) {
        const de = ctx.container.resolve<DataEngine>('dataEngine')
        await de.setCustomFields({
          entityId: E.auth.role,
          recordId: String(entity.id),
          organizationId: null,
          tenantId: entity.tenantId ? String(entity.tenantId) : null,
          values: state.custom,
          notify: false,
        })
      }
      updateStateStore.delete(ctx.input as object)
    },
    beforeDelete: async (id, ctx) => {
      const em = ctx.container.resolve<EntityManager>('em')
      const role = await em.findOne(Role, { id })
      if (!role || (role as any).deletedAt) throw new CrudHttpError(404, { error: 'Not found' })
      const activeAssignments = await em.count(UserRole, { role, deletedAt: null })
      if (activeAssignments > 0) throw new CrudHttpError(400, { error: 'Role has assigned users' })
      await em.nativeDelete(RoleAcl, { role: id as any })
    },
  },
})

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ items: [], total: 0, totalPages: 1 })
  const url = new URL(req.url)
  const parsed = querySchema.safeParse({
    id: url.searchParams.get('id') || undefined,
    page: url.searchParams.get('page') || undefined,
    pageSize: url.searchParams.get('pageSize') || undefined,
    search: url.searchParams.get('search') || undefined,
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
    console.error('roles: failed to resolve rbac', err)
  }
  const { id, page, pageSize, search } = parsed.data
  const where: any = { deletedAt: null }
  if (id) {
    where.id = id
  }
  if (search) where.name = { $ilike: `%${search}%` } as any
  const [rows, count] = await em.findAndCount(Role, where, { limit: pageSize, offset: (page - 1) * pageSize })
  const roleIds = rows.map((r: any) => r.id)
  const counts: Record<string, number> = {}
  if (roleIds.length) {
    const links = await em.find(UserRole, { role: { $in: roleIds as any } } as any)
    for (const l of links) {
      const rid = String((l as any).role?.id || (l as any).role)
      counts[rid] = (counts[rid] || 0) + 1
    }
  }
  const roleTenantIds = rows
    .map((role: any) => (role.tenantId ? String(role.tenantId) : null))
    .filter((tenantId): tenantId is string => typeof tenantId === 'string' && tenantId.length > 0)
  const uniqueTenantIds = Array.from(new Set(roleTenantIds))
  let tenantMap: Record<string, string> = {}
  if (uniqueTenantIds.length) {
    const tenants = await em.find(Tenant, { id: { $in: uniqueTenantIds as any }, deletedAt: null })
    tenantMap = tenants.reduce<Record<string, string>>((acc, tenant) => {
      const tid = tenant?.id ? String(tenant.id) : null
      if (!tid) return acc
      const rawName = (tenant as any)?.name
      const name = typeof rawName === 'string' && rawName.length > 0 ? rawName : tid
      acc[tid] = name
      return acc
    }, {})
  }
  const tenantByRole: Record<string, string | null> = {}
  for (const role of rows) {
    const rid = String(role.id)
    tenantByRole[rid] = role.tenantId ? String(role.tenantId) : null
  }
  const tenantFallbacks = Array.from(new Set<string | null>([
    auth.tenantId ?? null,
    ...Object.values(tenantByRole),
  ]))
  const cfByRole = roleIds.length
    ? await loadCustomFieldValues({
        em,
        entityId: E.auth.role,
        recordIds: roleIds.map((id: any) => String(id)),
        tenantIdByRecord: tenantByRole,
        tenantFallbacks,
      })
    : {}
  const items = rows.map((r: any) => {
    const idStr = String(r.id)
    const tenantId = tenantByRole[idStr]
    const tenantName = tenantId ? tenantMap[tenantId] ?? tenantId : null
    const exposeTenant = isSuperAdmin || (tenantId && auth.tenantId && tenantId === auth.tenantId)
    return {
      id: idStr,
      name: String(r.name),
      usersCount: counts[idStr] || 0,
      tenantId: tenantId ?? null,
      tenantIds: exposeTenant && tenantId ? [tenantId] : [],
      tenantName: exposeTenant ? tenantName : null,
      ...(cfByRole[idStr] || {}),
    }
  })
  const totalPages = Math.max(1, Math.ceil(count / pageSize))
  return NextResponse.json({ items, total: count, totalPages, isSuperAdmin })
}

export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE
