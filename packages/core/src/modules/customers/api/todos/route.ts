import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import type { CommandRuntimeContext, CommandBus } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { withScopedPayload } from '../utils'
import { todoLinkCreateSchema, todoLinkWithTodoCreateSchema } from '../../data/validators'
import { CustomerTodoLink, CustomerEntity } from '../../data/entities'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { E as ExampleEntities } from '@open-mercato/example/generated/entities.ids.generated'

const unlinkSchema = z.object({
  id: z.string().uuid(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.activities.view'] },
  POST: { requireAuth: true, requireFeatures: ['customers.activities.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['customers.activities.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['customers.activities.manage'] },
}

async function buildContext(
  req: Request
): Promise<{ ctx: CommandRuntimeContext; auth: Awaited<ReturnType<typeof getAuthFromRequest>>; translate: (key: string, fallback?: string) => string }> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth) throw new CrudHttpError(401, { error: translate('customers.errors.unauthorized', 'Unauthorized') })
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const ctx: CommandRuntimeContext = {
    container,
    auth,
    organizationScope: scope,
    selectedOrganizationId: scope?.selectedId ?? auth.orgId ?? null,
    organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
    request: req,
  }
  return { ctx, auth, translate }
}

const listQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  search: z.string().trim().min(1).optional(),
  isDone: z.enum(['true', 'false']).optional(),
  organizationId: z.string().uuid().optional(),
  entityId: z.string().uuid().optional(),
})

function normalizeString(value: string | null | undefined): string {
  return value ? value.trim().toLowerCase() : ''
}

type CustomerTodoLinkRow = {
  id: string
  todoId: string
  todoSource: string
  todoTitle: string | null
  todoIsDone: boolean | null
  todoPriority: number | null
  todoSeverity: string | null
  todoDescription: string | null
  todoDueAt: string | null
  todoCustomValues: Record<string, unknown> | null
  todoOrganizationId: string | null
  organizationId: string
  tenantId: string
  createdAt: string
  customer: {
    id: string | null
    displayName: string | null
    kind: string | null
  }
}

export async function GET(req: Request) {
  try {
    const { ctx, auth, translate } = await buildContext(req)

    const url = new URL(req.url)
    const rawQuery = Object.fromEntries(url.searchParams.entries())
    const parsed = listQuerySchema.safeParse(rawQuery)
    if (!parsed.success) {
      throw new CrudHttpError(400, { error: translate('customers.errors.invalid_query', 'Invalid query parameters') })
    }

    const { page, pageSize, search, isDone, organizationId, entityId } = parsed.data
    const tenantId = auth?.tenantId ?? null
    if (!tenantId) {
      throw new CrudHttpError(400, { error: translate('customers.errors.tenant_required', 'Tenant context is required') })
    }

    const scopedOrgIds = (() => {
      if (organizationId) return [organizationId]
      if (Array.isArray(ctx.organizationIds) && ctx.organizationIds.length > 0) return ctx.organizationIds
      if (ctx.organizationIds === null) {
        const fallback = ctx.selectedOrganizationId ?? auth?.orgId ?? null
        if (fallback) return [fallback]
      }
      const selected = ctx.selectedOrganizationId ?? auth?.orgId ?? null
      if (selected) return [selected]
      throw new CrudHttpError(400, { error: translate('customers.errors.organization_required', 'Organization context is required') })
    })()

    const allowedOrgIds = ctx.organizationIds
    if (organizationId && Array.isArray(allowedOrgIds) && allowedOrgIds.length > 0 && !allowedOrgIds.includes(organizationId)) {
      throw new CrudHttpError(403, { error: translate('customers.errors.organization_forbidden', 'Organization not accessible') })
    }

    const em = ctx.container.resolve<EntityManager>('em')
    const queryEngine = ctx.container.resolve<QueryEngine>('queryEngine')

    const where = {
      tenantId,
      organizationId: scopedOrgIds.length === 1 ? scopedOrgIds[0] : { $in: scopedOrgIds },
    } as Record<string, unknown>

    if (entityId) {
      const entity = await em.findOne(CustomerEntity, { id: entityId, deletedAt: null })
      if (!entity) {
        throw new CrudHttpError(404, { error: translate('customers.errors.todo_list_failed', 'Failed to load customer tasks') })
      }
      if (entity.tenantId && entity.tenantId !== tenantId) {
        throw new CrudHttpError(404, { error: translate('customers.errors.todo_list_failed', 'Failed to load customer tasks') })
      }
      const entityOrgId = typeof entity.organizationId === 'string' && entity.organizationId.trim().length > 0 ? entity.organizationId : null
      if (entityOrgId) {
        if (!scopedOrgIds.includes(entityOrgId)) {
          throw new CrudHttpError(403, { error: translate('customers.errors.organization_forbidden', 'Organization not accessible') })
        }
      }
      where.entity = entityId
    }

    const linkEntities = await em.find(CustomerTodoLink, where, {
      populate: ['entity'],
      orderBy: { createdAt: 'desc' },
    })

    const idsBySource = new Map<string, Set<string>>()
    for (const link of linkEntities) {
      const source = typeof link.todoSource === 'string' && link.todoSource.length ? link.todoSource : ExampleEntities.example.todo
      const id = String(link.todoId ?? '')
      if (!id) continue
      if (!idsBySource.has(source)) idsBySource.set(source, new Set<string>())
      idsBySource.get(source)!.add(id)
    }

    type TodoRecord = {
      id: string
      title: string | null
      is_done: boolean | null
      organization_id: string | null
      priority: number | null
      severity: string | null
      description: string | null
      due_at: string | null
      custom_values: Record<string, unknown> | null
    }
    const todoMap = new Map<string, TodoRecord>()
    for (const [source, idSet] of idsBySource.entries()) {
      const ids = Array.from(idSet)
      if (!ids.length) continue
      try {
        const result = await queryEngine.query<Record<string, unknown>>(source as any, {
          tenantId,
          organizationIds: scopedOrgIds,
          filters: { id: { $in: ids } },
          fields: ['id', 'title', 'is_done', 'organization_id'],
          withDeleted: false,
          page: { page: 1, pageSize: Math.max(ids.length, 1) },
        })
        for (const item of result.items ?? []) {
          if (!item || typeof item !== 'object') continue
          const record = item as Record<string, unknown>
          const todoId = typeof record.id === 'string' && record.id.length ? record.id : String(record.id ?? '')
          if (!todoId) continue
          const readNestedCustom = (key: string): unknown => {
            const bucket = record.custom ?? record.customFields ?? record.cf
            if (!bucket || typeof bucket !== 'object') return undefined
            const value = (bucket as Record<string, unknown>)[key]
            return value
          }
          const coerceNumber = (value: unknown): number | null => {
            if (typeof value === 'number' && Number.isFinite(value)) return value
            if (typeof value === 'string') {
              const trimmed = value.trim()
              if (!trimmed.length) return null
              const parsed = Number(trimmed)
              if (!Number.isNaN(parsed)) return parsed
            }
            return null
          }
          const coerceString = (value: unknown): string | null => {
            if (typeof value === 'string') {
              const trimmed = value.trim()
              return trimmed.length ? trimmed : null
            }
            return null
          }
          const priorityValue = (() => {
            const candidates = [
              record['cf:priority'],
              record['cf_priority'],
              record.priority,
              readNestedCustom('priority'),
            ]
            for (const candidate of candidates) {
              const parsed = coerceNumber(candidate)
              if (parsed !== null) return parsed
            }
            return null
          })()
          const severityValue = (() => {
            const candidates = [
              record['cf:severity'],
              record['cf_severity'],
              readNestedCustom('severity'),
            ]
            for (const candidate of candidates) {
              const parsed = coerceString(candidate)
              if (parsed) return parsed
            }
            return null
          })()
          const descriptionValue = (() => {
            const candidates = [
              record.description,
              record['cf:description'],
              record['cf_description'],
              readNestedCustom('description'),
            ]
            for (const candidate of candidates) {
              const parsed = coerceString(candidate)
              if (parsed) return parsed
            }
            return null
          })()
          const dueAtValue = (() => {
            const candidates = [
              record.due_at,
              record['cf:due_at'],
              record['cf_due_at'],
              readNestedCustom('due_at'),
              readNestedCustom('dueAt'),
            ]
            for (const candidate of candidates) {
              if (candidate instanceof Date) {
                const iso = candidate.toISOString()
                return Number.isNaN(new Date(iso).getTime()) ? null : iso
              }
              if (typeof candidate === 'string') {
                const trimmed = candidate.trim()
                if (!trimmed.length) continue
                const parsed = new Date(trimmed)
                if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
              }
            }
            return null
          })()
          const customValues: Record<string, unknown> = {}
          const assignCustomValue = (key: unknown, value: unknown) => {
            if (typeof key !== 'string') return
            const trimmedKey = key.trim()
            if (!trimmedKey.length) return
            customValues[trimmedKey] = value === undefined ? null : value
          }
          for (const [rawKey, rawValue] of Object.entries(record)) {
            if (rawKey.startsWith('cf:')) {
              assignCustomValue(rawKey.slice(3), rawValue)
            } else if (rawKey.startsWith('cf_')) {
              assignCustomValue(rawKey.slice(3), rawValue)
            }
          }
          const nestedCustom = record.custom ?? record.customFields ?? record.cf
          if (nestedCustom && typeof nestedCustom === 'object') {
            for (const [nestedKey, nestedValue] of Object.entries(nestedCustom as Record<string, unknown>)) {
              assignCustomValue(nestedKey, nestedValue)
            }
          }

          todoMap.set(`${source}:${todoId}`, {
            id: todoId,
            title: typeof record.title === 'string' ? record.title : null,
            is_done: typeof record.is_done === 'boolean' ? record.is_done : null,
            organization_id: typeof record.organization_id === 'string' ? record.organization_id : null,
            priority: priorityValue,
            severity: severityValue,
            description: descriptionValue,
            due_at: dueAtValue,
            custom_values: Object.keys(customValues).length ? customValues : null,
          })
        }
      } catch (err) {
        console.warn(`customers.todos.list: failed to resolve todos for source ${source}`, err)
      }
    }

    const normalizedSearch = search ? normalizeString(search) : ''
    const filterByDone = typeof isDone === 'string'
    const wantDone = isDone === 'true'

    const filtered = linkEntities.filter((link) => {
      const source = typeof link.todoSource === 'string' && link.todoSource.length ? link.todoSource : ExampleEntities.example.todo
      const key = `${source}:${link.todoId}`
      const todo = todoMap.get(key)

      if (filterByDone) {
        if (!todo) return false
        const doneValue = todo.is_done === true
        if (wantDone !== doneValue) return false
      }

      if (normalizedSearch) {
        const haystacks: string[] = []
        if (todo?.title) haystacks.push(todo.title)
        if (todo?.description) haystacks.push(todo.description)
        if (todo?.severity) haystacks.push(todo.severity)
        const entity = link.entity
        if (entity && typeof entity !== 'string') {
          const e = entity as CustomerEntity
          if (e.displayName) haystacks.push(e.displayName)
        }
        const matched = haystacks.some((value) => normalizeString(value).includes(normalizedSearch))
        if (!matched) return false
      }

      return true
    })

    const sorted = filtered.map<CustomerTodoLinkRow>((link) => {
      const source = typeof link.todoSource === 'string' && link.todoSource.length ? link.todoSource : ExampleEntities.example.todo
      const key = `${source}:${link.todoId}`
      const todo = todoMap.get(key)
      const entity = link.entity && typeof link.entity !== 'string' ? (link.entity as CustomerEntity) : null
      return {
        id: link.id,
        todoId: link.todoId,
        todoSource: source,
        todoTitle: todo?.title ?? null,
        todoIsDone: todo?.is_done ?? null,
        todoPriority: todo?.priority ?? null,
        todoSeverity: todo?.severity ?? null,
        todoDescription: todo?.description ?? null,
        todoDueAt: todo?.due_at ?? null,
        todoCustomValues: todo?.custom_values ?? null,
        todoOrganizationId: todo?.organization_id ?? null,
        organizationId: link.organizationId,
        tenantId: link.tenantId,
        createdAt: link.createdAt.toISOString(),
        customer: {
          id: entity?.id ?? (typeof link.entity === 'string' ? link.entity : null),
          displayName: entity?.displayName ?? null,
          kind: entity?.kind ?? null,
        },
      }
    })

    sorted.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))

    const total = sorted.length
    const totalPages = Math.max(1, Math.ceil(total / pageSize))
    const start = (page - 1) * pageSize
    const end = start + pageSize
    const items = sorted.slice(start, end)

    return NextResponse.json({
      items,
      total,
      page,
      pageSize,
      totalPages,
    })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    console.error('customers.todos.list failed', err)
    return NextResponse.json(
      { error: translate('customers.errors.todo_list_failed', 'Failed to load customer tasks') },
      { status: 500 },
    )
  }
}

function attachOperationHeader(response: NextResponse, logEntry: any, fallbackId: string | null) {
  if (!response || !logEntry || !logEntry.undoToken || !logEntry.id || !logEntry.commandId) return
  response.headers.set(
    'x-om-operation',
    serializeOperationMetadata({
      id: logEntry.id,
      undoToken: logEntry.undoToken,
      commandId: logEntry.commandId,
      actionLabel: logEntry.actionLabel ?? null,
      resourceKind: logEntry.resourceKind ?? 'customers.todoLink',
      resourceId: logEntry.resourceId ?? fallbackId,
      executedAt: logEntry.createdAt instanceof Date ? logEntry.createdAt.toISOString() : undefined,
    })
  )
}

export async function POST(req: Request) {
  try {
    const { ctx, translate } = await buildContext(req)
    const raw = await req.json().catch(() => ({}))
    const scopedPayload = withScopedPayload(raw, ctx, translate)
    const input = todoLinkWithTodoCreateSchema.parse({
      ...scopedPayload,
      todoCustom: (scopedPayload as { todoCustom?: unknown; custom?: unknown }).todoCustom ?? (scopedPayload as { custom?: unknown }).custom,
    })

    const commandBus = ctx.container.resolve<CommandBus>('commandBus')
    const { result, logEntry } = await commandBus.execute('customers.todos.create', { input, ctx })
    const response = NextResponse.json(
      {
        todoId: result?.todoId ?? null,
        linkId: result?.linkId ?? null,
      },
      { status: 201 }
    )
    attachOperationHeader(response, logEntry, result?.linkId ?? null)
    return response
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    console.error('customers.todos.create failed', err)
    return NextResponse.json({ error: translate('customers.errors.todo_create_failed', 'Failed to create todo') }, { status: 400 })
  }
}

export async function PUT(req: Request) {
  try {
    const { ctx, translate } = await buildContext(req)
    const raw = await req.json().catch(() => ({}))
    const scopedPayload = withScopedPayload(raw, ctx, translate)
    const input = todoLinkCreateSchema.parse(scopedPayload)

    const commandBus = ctx.container.resolve<CommandBus>('commandBus')
    const { result, logEntry } = await commandBus.execute('customers.todos.link', { input, ctx })
    const response = NextResponse.json({ linkId: result?.linkId ?? null })
    attachOperationHeader(response, logEntry, result?.linkId ?? null)
    return response
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    console.error('customers.todos.link failed', err)
    return NextResponse.json({ error: translate('customers.errors.todo_link_failed', 'Failed to link todo') }, { status: 400 })
  }
}

export async function DELETE(req: Request) {
  try {
    const { ctx, translate } = await buildContext(req)
    let body: unknown = {}
    try {
      body = await req.json()
    } catch {
      // ignore empty body
    }
    const params = new URL(req.url).searchParams
    const idValue = (body as { id?: string })?.id ?? params.get('id')
    if (!idValue) {
      throw new CrudHttpError(400, { error: translate('customers.errors.todo_link_required', 'Todo link id is required') })
    }
    const input = unlinkSchema.parse({ id: idValue })

    const commandBus = ctx.container.resolve<CommandBus>('commandBus')
    const { result, logEntry } = await commandBus.execute('customers.todos.unlink', { input, ctx })
    const response = NextResponse.json({ linkId: result?.linkId ?? null })
    attachOperationHeader(response, logEntry, result?.linkId ?? input.id)
    return response
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    console.error('customers.todos.unlink failed', err)
    return NextResponse.json({ error: translate('customers.errors.todo_unlink_failed', 'Failed to unlink todo') }, { status: 400 })
  }
}
