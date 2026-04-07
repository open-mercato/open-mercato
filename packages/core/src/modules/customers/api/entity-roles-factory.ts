import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { validateCrudMutationGuard, runCrudMutationGuardAfterSuccess } from '@open-mercato/shared/lib/crud/mutation-guard'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { CustomerEntityRole } from '../data/entities'
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
  return { entityType, resourceKind, resourceId: entityId }
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
  const { container, em, auth, selectedOrganizationId, commandContext } = await resolveCustomersRequestContext(request)
  return { container, em, auth, selectedOrganizationId, ctx: commandContext }
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
      const { em, auth, selectedOrganizationId } = await buildContext(request)
      if (!selectedOrganizationId) {
        throw new CrudHttpError(400, { error: 'Organization context is required' })
      }

      const roles = await findWithDecryption(
        em,
        CustomerEntityRole,
        { entityType, entityId, organizationId: selectedOrganizationId, tenantId: auth.tenantId },
        { orderBy: { roleType: 'asc' } },
        { tenantId: auth.tenantId, organizationId: selectedOrganizationId },
      )

      const userIds = Array.from(new Set(roles.map((role) => role.userId).filter((value): value is string => typeof value === 'string' && value.length > 0)))
      const users = userIds.length
        ? await findWithDecryption(
            em,
            User,
            { id: { $in: userIds }, deletedAt: null, ...(auth.tenantId ? { tenantId: auth.tenantId } : {}) },
            undefined,
            { tenantId: auth.tenantId, organizationId: selectedOrganizationId },
          )
        : []
      const userMap = new Map(users.map((user) => [user.id, { name: user.name ?? null, email: user.email ?? null }]))

      return NextResponse.json({
        items: roles.map((role) => ({
          ...(userMap.has(role.userId)
            ? { userName: userMap.get(role.userId)?.name ?? null, userEmail: userMap.get(role.userId)?.email ?? null }
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
      if (err instanceof z.ZodError) return NextResponse.json({ error: 'Validation failed' }, { status: 400 })
      console.error(`${logPrefix}.get failed`, err)
      return NextResponse.json({ error: 'Failed to load roles' }, { status: 500 })
    }
  }

  async function POST(request: Request, { params }: { params: { id: string } }) {
    try {
      const { id: entityId } = paramsSchema.parse(params)
      const { container, auth, selectedOrganizationId, ctx } = await buildContext(request)
      const { translate } = await resolveTranslations()
      if (!selectedOrganizationId) {
        throw new CrudHttpError(400, { error: translate('customers.errors.organization_required', 'Organization context is required') })
      }

      const rawBody = await readJsonSafe<Record<string, unknown>>(request, {})
      const scoped = withScopedPayload({ ...rawBody, ...getRoleContext(entityType, entityId) }, ctx, translate)
      const parsed = entityRoleCreateSchema.parse(scoped)

      const guardUserId = resolveAuthActorId(auth)
      const guardResult = await validateCrudMutationGuard(container, {
        tenantId: auth.tenantId, organizationId: selectedOrganizationId, userId: guardUserId,
        resourceKind, resourceId: entityId, operation: 'custom',
        requestMethod: request.method, requestHeaders: request.headers, mutationPayload: rawBody,
      })
      if (guardResult && !guardResult.ok) return NextResponse.json(guardResult.body, { status: guardResult.status })

      const commandBus = container.resolve('commandBus') as CommandBus
      const { result, logEntry } = await commandBus.execute<EntityRoleCreateInput, { roleId: string }>(
        'customers.entityRoles.create',
        { input: parsed, ctx },
      )

      if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
        await runCrudMutationGuardAfterSuccess(container, {
          tenantId: auth.tenantId, organizationId: selectedOrganizationId, userId: guardUserId,
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
      if (err instanceof z.ZodError) return NextResponse.json({ error: 'Validation failed' }, { status: 400 })
      console.error(`${logPrefix}.post failed`, err)
      return NextResponse.json({ error: 'Failed to assign role' }, { status: 500 })
    }
  }

  async function PUT(request: Request, { params }: { params: { id: string } }) {
    try {
      const { id: entityId } = paramsSchema.parse(params)
      const { roleId } = roleIdQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
      const { container, auth, selectedOrganizationId, ctx } = await buildContext(request)
      const { translate } = await resolveTranslations()
      if (!selectedOrganizationId) {
        throw new CrudHttpError(400, { error: translate('customers.errors.organization_required', 'Organization context is required') })
      }

      const rawBody = await readJsonSafe<Record<string, unknown>>(request, {})
      const scoped = withScopedPayload({ ...rawBody, id: roleId }, ctx, translate)
      const parsed = entityRoleUpdateSchema.parse(scoped)

      const guardUserId = resolveAuthActorId(auth)
      const guardResult = await validateCrudMutationGuard(container, {
        tenantId: auth.tenantId, organizationId: selectedOrganizationId, userId: guardUserId,
        resourceKind, resourceId: entityId, operation: 'custom',
        requestMethod: request.method, requestHeaders: request.headers, mutationPayload: { roleId, ...rawBody },
      })
      if (guardResult && !guardResult.ok) return NextResponse.json(guardResult.body, { status: guardResult.status })

      const commandBus = container.resolve('commandBus') as CommandBus
      const { logEntry } = await commandBus.execute<EntityRoleUpdateInput, { roleId: string }>(
        'customers.entityRoles.update',
        { input: parsed, ctx },
      )

      if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
        await runCrudMutationGuardAfterSuccess(container, {
          tenantId: auth.tenantId, organizationId: selectedOrganizationId, userId: guardUserId,
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
      if (err instanceof z.ZodError) return NextResponse.json({ error: 'Validation failed' }, { status: 400 })
      console.error(`${logPrefix}.put failed`, err)
      return NextResponse.json({ error: 'Failed to update role' }, { status: 500 })
    }
  }

  async function DELETE(request: Request, { params }: { params: { id: string } }) {
    try {
      const { id: entityId } = paramsSchema.parse(params)
      const { roleId } = roleIdQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
      const { container, auth, selectedOrganizationId, ctx } = await buildContext(request)
      if (!selectedOrganizationId) {
        throw new CrudHttpError(400, { error: 'Organization context is required' })
      }

      const parsed = entityRoleDeleteSchema.parse(withScopedPayload({ id: roleId }, ctx, () => 'Organization context is required'))
      const guardUserId = resolveAuthActorId(auth)
      const guardResult = await validateCrudMutationGuard(container, {
        tenantId: auth.tenantId, organizationId: selectedOrganizationId, userId: guardUserId,
        resourceKind, resourceId: entityId, operation: 'custom',
        requestMethod: request.method, requestHeaders: request.headers, mutationPayload: { roleId },
      })
      if (guardResult && !guardResult.ok) return NextResponse.json(guardResult.body, { status: guardResult.status })

      const commandBus = container.resolve('commandBus') as CommandBus
      const { logEntry } = await commandBus.execute<EntityRoleDeleteInput, { roleId: string }>(
        'customers.entityRoles.delete',
        { input: parsed, ctx },
      )

      if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
        await runCrudMutationGuardAfterSuccess(container, {
          tenantId: auth.tenantId, organizationId: selectedOrganizationId, userId: guardUserId,
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
      if (err instanceof z.ZodError) return NextResponse.json({ error: 'Validation failed' }, { status: 400 })
      console.error(`${logPrefix}.delete failed`, err)
      return NextResponse.json({ error: 'Failed to delete role' }, { status: 500 })
    }
  }

  return { GET, POST, PUT, DELETE }
}
