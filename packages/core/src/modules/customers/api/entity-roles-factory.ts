import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { validateCrudMutationGuard, runCrudMutationGuardAfterSuccess } from '@open-mercato/shared/lib/crud/mutation-guard'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { CustomerEntity, CustomerEntityRole } from '../data/entities'
import { entityRoleCreateSchema, entityRoleUpdateSchema, entityRoleDeleteSchema, type EntityRoleCreateInput, type EntityRoleUpdateInput, type EntityRoleDeleteInput } from '../data/validators'
import { withScopedPayload } from './utils'
import { resolveCustomersRequestContext, resolveAuthActorId } from '../lib/interactionRequestContext'

const paramsSchema = z.object({ id: z.string().uuid() })
const roleIdQuerySchema = z.object({ roleId: z.string().uuid() })

const createBodySchema = z.object({
  roleType: z.string().trim().min(1).max(100),
  userId: z.string().uuid(),
})
const updateBodySchema = z.object({
  userId: z.string().uuid(),
})

const listItemSchema = z.object({
  id: z.string().uuid(),
  entityType: z.enum(['company', 'person']),
  entityId: z.string().uuid(),
  userId: z.string().uuid(),
  userName: z.string().nullable().optional(),
  userEmail: z.string().nullable().optional(),
  userPhone: z.string().nullable().optional(),
  roleType: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const listResponseSchema = z.object({ items: z.array(listItemSchema) })
const okResponseSchema = z.object({ ok: z.boolean() })
const createResponseSchema = z.object({ id: z.string().uuid() })
const errorSchema = z.object({ error: z.string() })

type EntityType = 'company' | 'person'

function getRoleContext(entityType: EntityType, entityId: string) {
  const resourceKind = entityType === 'company' ? 'customers.company' : 'customers.person'
  return { entityType, entityId, resourceKind, resourceId: entityId }
}

function buildValidationErrorResponse(error: z.ZodError) {
  return NextResponse.json(
    { error: 'Validation failed', fieldErrors: error.flatten().fieldErrors },
    { status: 400 },
  )
}

function withOperationMetadata(
  response: NextResponse,
  logEntry: { undoToken?: string | null; id?: string | null; commandId?: string | null; actionLabel?: string | null; resourceKind?: string | null; resourceId?: string | null; createdAt?: Date | null } | null | undefined,
  fallback: { resourceKind: string; resourceId: string | null },
) {
  if (!logEntry?.undoToken || !logEntry.id || !logEntry.commandId) return response
  response.headers.set(
    'x-om-operation',
    serializeOperationMetadata({
      id: logEntry.id,
      undoToken: logEntry.undoToken,
      commandId: logEntry.commandId,
      actionLabel: logEntry.actionLabel ?? null,
      resourceKind: logEntry.resourceKind ?? fallback.resourceKind,
      resourceId: logEntry.resourceId ?? fallback.resourceId,
      executedAt: logEntry.createdAt instanceof Date ? logEntry.createdAt.toISOString() : new Date().toISOString(),
    }),
  )
  return response
}

async function buildContext(request: Request) {
  const context = await resolveCustomersRequestContext(request)
  return {
    ...context,
    ctx: context.commandContext,
  }
}

function collectAllowedOrganizationIds(
  scope: Awaited<ReturnType<typeof resolveCustomersRequestContext>>['scope'],
  auth: Awaited<ReturnType<typeof resolveCustomersRequestContext>>['auth'],
) {
  const allowedOrgIds = new Set<string>()
  if (scope?.filterIds?.length) scope.filterIds.forEach((id) => allowedOrgIds.add(id))
  else if (auth.orgId) allowedOrgIds.add(auth.orgId)
  return allowedOrgIds
}

function ensureRouteOrganizationAccess(
  organizationId: string,
  scope: Awaited<ReturnType<typeof resolveCustomersRequestContext>>['scope'],
  auth: Awaited<ReturnType<typeof resolveCustomersRequestContext>>['auth'],
) {
  const allowedOrgIds = collectAllowedOrganizationIds(scope, auth)
  if (allowedOrgIds.size > 0 && !allowedOrgIds.has(organizationId)) {
    throw new CrudHttpError(403, { error: 'Access denied' })
  }
}

async function resolveEntityRouteScope(
  em: Awaited<ReturnType<typeof resolveCustomersRequestContext>>['em'],
  auth: Awaited<ReturnType<typeof resolveCustomersRequestContext>>['auth'],
  scope: Awaited<ReturnType<typeof resolveCustomersRequestContext>>['scope'],
  entityType: EntityType,
  entityId: string,
) {
  const entity = await findOneWithDecryption(
    em,
    CustomerEntity,
    { id: entityId, kind: entityType, tenantId: auth.tenantId, deletedAt: null },
    undefined,
    { tenantId: auth.tenantId, organizationId: null },
  )
  if (!entity || entity.tenantId !== auth.tenantId) {
    throw new CrudHttpError(404, { error: 'Customer not found' })
  }
  ensureRouteOrganizationAccess(entity.organizationId, scope, auth)
  return {
    entity,
    organizationId: entity.organizationId,
    tenantId: entity.tenantId,
  }
}

async function resolveRoleRouteScope(
  em: Awaited<ReturnType<typeof resolveCustomersRequestContext>>['em'],
  auth: Awaited<ReturnType<typeof resolveCustomersRequestContext>>['auth'],
  scope: Awaited<ReturnType<typeof resolveCustomersRequestContext>>['scope'],
  entityType: EntityType,
  entityId: string,
  roleId: string,
) {
  const role = await findOneWithDecryption(
    em,
    CustomerEntityRole,
    { id: roleId, tenantId: auth.tenantId, entityType, entityId, deletedAt: null },
    undefined,
    { tenantId: auth.tenantId, organizationId: null },
  )
  if (
    !role ||
    role.tenantId !== auth.tenantId ||
    role.entityType !== entityType ||
    role.entityId !== entityId
  ) {
    throw new CrudHttpError(404, { error: 'Role not found' })
  }
  ensureRouteOrganizationAccess(role.organizationId, scope, auth)
  return {
    role,
    organizationId: role.organizationId,
    tenantId: role.tenantId,
  }
}

function createScopedCommandContext(
  ctx: Awaited<ReturnType<typeof buildContext>>['ctx'],
  organizationId: string,
) {
  return {
    ...ctx,
    selectedOrganizationId: organizationId,
    organizationIds: [organizationId],
  }
}

export const entityRolesMetadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.roles.view'] },
  POST: { requireAuth: true, requireFeatures: ['customers.roles.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['customers.roles.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['customers.roles.manage'] },
}

export function buildEntityRolesOpenApi(entityType: EntityType): OpenApiRouteDoc {
  const label = entityType === 'company' ? 'company' : 'person'
  return {
    tag: 'Customers',
    summary: `${label.charAt(0).toUpperCase() + label.slice(1)} role assignments`,
    pathParams: paramsSchema,
    methods: {
      GET: {
        summary: `List roles for a ${label}`,
        responses: [{ status: 200, description: 'Role assignments', schema: listResponseSchema }],
        errors: [
          { status: 400, description: 'Invalid request', schema: errorSchema },
          { status: 401, description: 'Unauthorized', schema: errorSchema },
        ],
      },
      POST: {
        summary: `Assign a role to a ${label}`,
        requestBody: { contentType: 'application/json', schema: createBodySchema },
        responses: [{ status: 201, description: 'Role created', schema: createResponseSchema }],
        errors: [
          { status: 400, description: 'Invalid request', schema: errorSchema },
          { status: 401, description: 'Unauthorized', schema: errorSchema },
          { status: 409, description: 'Role already assigned', schema: errorSchema },
        ],
      },
      PUT: {
        summary: `Update a ${label} role assignment`,
        query: roleIdQuerySchema,
        requestBody: { contentType: 'application/json', schema: updateBodySchema },
        responses: [{ status: 200, description: 'Role updated', schema: okResponseSchema }],
        errors: [
          { status: 400, description: 'Invalid request', schema: errorSchema },
          { status: 401, description: 'Unauthorized', schema: errorSchema },
          { status: 404, description: 'Role not found', schema: errorSchema },
        ],
      },
      DELETE: {
        summary: `Remove a ${label} role assignment`,
        query: roleIdQuerySchema,
        responses: [{ status: 200, description: 'Role deleted', schema: okResponseSchema }],
        errors: [
          { status: 400, description: 'Invalid request', schema: errorSchema },
          { status: 401, description: 'Unauthorized', schema: errorSchema },
          { status: 404, description: 'Role not found', schema: errorSchema },
        ],
      },
    },
  }
}

export function createEntityRolesHandlers(entityType: EntityType) {
  const resourceKind = entityType === 'company' ? 'customers.company' : 'customers.person'
  const logPrefix = entityType === 'company' ? 'customers.company.roles' : 'customers.person.roles'

  async function GET(request: Request, { params }: { params: { id: string } }) {
    try {
      const { id: entityId } = paramsSchema.parse(params)
      const { em, auth, scope } = await buildContext(request)
      const targetScope = await resolveEntityRouteScope(em, auth, scope, entityType, entityId)

      const roles = await findWithDecryption(
        em,
        CustomerEntityRole,
        {
          entityType,
          entityId,
          organizationId: targetScope.organizationId,
          tenantId: targetScope.tenantId,
          deletedAt: null,
        },
        { orderBy: { roleType: 'asc' } },
        {
          tenantId: targetScope.tenantId,
          organizationId: targetScope.organizationId,
        },
      )

      const userIds = Array.from(new Set(roles.map((role) => role.userId).filter((value): value is string => typeof value === 'string' && value.length > 0)))
      const users = userIds.length
        ? await findWithDecryption(
            em,
            User,
            {
              id: { $in: userIds },
              deletedAt: null,
              ...(targetScope.tenantId ? { tenantId: targetScope.tenantId } : {}),
            },
            undefined,
            {
              tenantId: targetScope.tenantId,
              organizationId: targetScope.organizationId,
            },
          )
        : []
      const userMap = new Map(users.map((user) => [user.id, {
        name: user.name ?? null,
        email: user.email ?? null,
        phone: null,
      }]))

      return NextResponse.json({
        items: roles.map((role) => ({
          ...(userMap.has(role.userId)
            ? {
                userName: userMap.get(role.userId)?.name ?? null,
                userEmail: userMap.get(role.userId)?.email ?? null,
                userPhone: userMap.get(role.userId)?.phone ?? null,
              }
            : {}),
          id: role.id,
          entityType: role.entityType,
          entityId: role.entityId,
          userId: role.userId,
          roleType: role.roleType,
          createdAt: role.createdAt.toISOString(),
          updatedAt: role.updatedAt.toISOString(),
        })),
      })
    } catch (err) {
      if (err instanceof CrudHttpError) return NextResponse.json(err.body, { status: err.status })
      if (err instanceof z.ZodError) return buildValidationErrorResponse(err)
      console.error(`${logPrefix}.get failed`, err)
      return NextResponse.json({ error: 'Failed to load roles' }, { status: 500 })
    }
  }

  async function POST(request: Request, { params }: { params: { id: string } }) {
    try {
      const { id: entityId } = paramsSchema.parse(params)
      const { container, em, auth, scope, ctx } = await buildContext(request)
      const { translate } = await resolveTranslations()
      const targetScope = await resolveEntityRouteScope(em, auth, scope, entityType, entityId)
      const commandCtx = createScopedCommandContext(ctx, targetScope.organizationId)

      const rawBody = await readJsonSafe<Record<string, unknown>>(request, {})
      const scoped = withScopedPayload(
        {
          ...rawBody,
          organizationId: targetScope.organizationId,
          tenantId: targetScope.tenantId,
          ...getRoleContext(entityType, entityId),
        },
        commandCtx,
        translate,
      )
      const parsed = entityRoleCreateSchema.parse(scoped)

      const guardUserId = resolveAuthActorId(auth)
      const guardResult = await validateCrudMutationGuard(container, {
        tenantId: targetScope.tenantId, organizationId: targetScope.organizationId, userId: guardUserId,
        resourceKind, resourceId: entityId, operation: 'custom',
        requestMethod: request.method, requestHeaders: request.headers, mutationPayload: rawBody,
      })
      if (guardResult && !guardResult.ok) return NextResponse.json(guardResult.body, { status: guardResult.status })

      const commandBus = container.resolve('commandBus') as CommandBus
      const { result, logEntry } = await commandBus.execute<EntityRoleCreateInput, { roleId: string }>(
        'customers.entityRoles.create',
        { input: parsed, ctx: commandCtx },
      )

      if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
        await runCrudMutationGuardAfterSuccess(container, {
          tenantId: targetScope.tenantId, organizationId: targetScope.organizationId, userId: guardUserId,
          resourceKind, resourceId: entityId, operation: 'custom',
          requestMethod: request.method, requestHeaders: request.headers, metadata: guardResult.metadata ?? null,
        })
      }

      return withOperationMetadata(
        NextResponse.json({ id: result?.roleId ?? null }, { status: 201 }),
        logEntry,
        { resourceKind, resourceId: entityId },
      )
    } catch (err) {
      if (err instanceof CrudHttpError) return NextResponse.json(err.body, { status: err.status })
      if (err instanceof z.ZodError) return buildValidationErrorResponse(err)
      console.error(`${logPrefix}.post failed`, err)
      return NextResponse.json({ error: 'Failed to assign role' }, { status: 500 })
    }
  }

  async function PUT(request: Request, { params }: { params: { id: string } }) {
    try {
      const { id: entityId } = paramsSchema.parse(params)
      const { roleId } = roleIdQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
      const { container, em, auth, scope, ctx } = await buildContext(request)
      const { translate } = await resolveTranslations()
      const targetScope = await resolveRoleRouteScope(em, auth, scope, entityType, entityId, roleId)
      const commandCtx = createScopedCommandContext(ctx, targetScope.organizationId)

      const rawBody = await readJsonSafe<Record<string, unknown>>(request, {})
      const scoped = withScopedPayload(
        {
          ...rawBody,
          id: roleId,
          organizationId: targetScope.organizationId,
          tenantId: targetScope.tenantId,
        },
        commandCtx,
        translate,
      )
      const parsed = entityRoleUpdateSchema.parse(scoped)

      const guardUserId = resolveAuthActorId(auth)
      const guardResult = await validateCrudMutationGuard(container, {
        tenantId: targetScope.tenantId, organizationId: targetScope.organizationId, userId: guardUserId,
        resourceKind, resourceId: entityId, operation: 'custom',
        requestMethod: request.method, requestHeaders: request.headers, mutationPayload: { roleId, ...rawBody },
      })
      if (guardResult && !guardResult.ok) return NextResponse.json(guardResult.body, { status: guardResult.status })

      const commandBus = container.resolve('commandBus') as CommandBus
      const { logEntry } = await commandBus.execute<EntityRoleUpdateInput, { roleId: string }>(
        'customers.entityRoles.update',
        { input: parsed, ctx: commandCtx },
      )

      if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
        await runCrudMutationGuardAfterSuccess(container, {
          tenantId: targetScope.tenantId, organizationId: targetScope.organizationId, userId: guardUserId,
          resourceKind, resourceId: entityId, operation: 'custom',
          requestMethod: request.method, requestHeaders: request.headers, metadata: guardResult.metadata ?? null,
        })
      }

      return withOperationMetadata(
        NextResponse.json({ ok: true }),
        logEntry,
        { resourceKind, resourceId: entityId },
      )
    } catch (err) {
      if (err instanceof CrudHttpError) return NextResponse.json(err.body, { status: err.status })
      if (err instanceof z.ZodError) return buildValidationErrorResponse(err)
      console.error(`${logPrefix}.put failed`, err)
      return NextResponse.json({ error: 'Failed to update role' }, { status: 500 })
    }
  }

  async function DELETE(request: Request, { params }: { params: { id: string } }) {
    try {
      const { id: entityId } = paramsSchema.parse(params)
      const { roleId } = roleIdQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
      const { container, em, auth, scope, ctx } = await buildContext(request)
      const targetScope = await resolveRoleRouteScope(em, auth, scope, entityType, entityId, roleId)
      const commandCtx = createScopedCommandContext(ctx, targetScope.organizationId)

      const parsed = entityRoleDeleteSchema.parse(
        withScopedPayload(
          {
            id: roleId,
            organizationId: targetScope.organizationId,
            tenantId: targetScope.tenantId,
          },
          commandCtx,
          () => 'Organization context is required',
        ),
      )
      const guardUserId = resolveAuthActorId(auth)
      const guardResult = await validateCrudMutationGuard(container, {
        tenantId: targetScope.tenantId, organizationId: targetScope.organizationId, userId: guardUserId,
        resourceKind, resourceId: entityId, operation: 'custom',
        requestMethod: request.method, requestHeaders: request.headers, mutationPayload: { roleId },
      })
      if (guardResult && !guardResult.ok) return NextResponse.json(guardResult.body, { status: guardResult.status })

      const commandBus = container.resolve('commandBus') as CommandBus
      const { logEntry } = await commandBus.execute<EntityRoleDeleteInput, { roleId: string }>(
        'customers.entityRoles.delete',
        { input: parsed, ctx: commandCtx },
      )

      if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
        await runCrudMutationGuardAfterSuccess(container, {
          tenantId: targetScope.tenantId, organizationId: targetScope.organizationId, userId: guardUserId,
          resourceKind, resourceId: entityId, operation: 'custom',
          requestMethod: request.method, requestHeaders: request.headers, metadata: guardResult.metadata ?? null,
        })
      }

      return withOperationMetadata(
        NextResponse.json({ ok: true }),
        logEntry,
        { resourceKind, resourceId: entityId },
      )
    } catch (err) {
      if (err instanceof CrudHttpError) return NextResponse.json(err.body, { status: err.status })
      if (err instanceof z.ZodError) return buildValidationErrorResponse(err)
      console.error(`${logPrefix}.delete failed`, err)
      return NextResponse.json({ error: 'Failed to delete role' }, { status: 500 })
    }
  }

  return { GET, POST, PUT, DELETE }
}
