import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { ActionLogService } from '@open-mercato/core/modules/audit_logs/services/actionLogService'
import { loadAuditLogDisplayMaps } from '@open-mercato/core/modules/audit_logs/api/audit-logs/display'
import { SalesOrder, SalesQuote, SalesNote } from '../../data/entities'
import { documentHistoryQuerySchema } from '../../data/validators'
import { buildSalesHistoryEntries, type SalesHistoryEntry } from '../../lib/history'

export const metadata = {
  GET: { requireAuth: true },
}

type RequestContext = {
  ctx: CommandRuntimeContext
  translate: (key: string, fallback?: string) => string
}

async function resolveRequestContext(req: Request): Promise<RequestContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()

  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('sales.documents.errors.unauthorized', 'Unauthorized') })
  }

  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = scope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, {
      error: translate('sales.documents.errors.organization_required', 'Organization context is required'),
    })
  }

  const ctx: CommandRuntimeContext = {
    container,
    auth,
    organizationScope: scope,
    selectedOrganizationId: organizationId,
    organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
    request: req,
  }

  return { ctx, translate }
}

async function ensureKindPermission(
  ctx: CommandRuntimeContext,
  kind: 'order' | 'quote',
  translate: (key: string, fallback?: string) => string
) {
  const rbac = ctx.container.resolve('rbacService') as RbacService | null
  const auth = ctx.auth
  if (!rbac || !auth?.sub) return
  const feature = kind === 'order' ? 'sales.orders.view' : 'sales.quotes.view'
  const ok = await rbac.userHasAllFeatures(auth.sub, [feature], {
    tenantId: auth.tenantId ?? null,
    organizationId: ctx.selectedOrganizationId ?? auth.orgId ?? null,
  })
  if (!ok) {
    throw new CrudHttpError(403, {
      error: translate('sales.documents.errors.forbidden', 'Forbidden'),
    })
  }
}

function parseTypes(value: string | null): string[] | undefined {
  if (!value) return undefined
  const parts = value.split(',').map((entry) => entry.trim()).filter(Boolean)
  return parts.length ? parts : undefined
}

function parseQuery(req: Request) {
  const url = new URL(req.url)
  return {
    kind: url.searchParams.get('kind') ?? undefined,
    id: url.searchParams.get('id') ?? undefined,
    types: parseTypes(url.searchParams.get('types')),
    limit: url.searchParams.get('limit') ?? undefined,
    before: url.searchParams.get('before') ?? undefined,
    after: url.searchParams.get('after') ?? undefined,
  }
}

const historyEntrySchema = z.object({
  id: z.string(),
  kind: z.enum(['status', 'action', 'comment']),
  occurredAt: z.string(),
  actionLabel: z.string().nullable(),
  actor: z.object({
    id: z.string().nullable(),
    label: z.string().nullable(),
    kind: z.enum(['user', 'api_key', 'system']),
  }),
  source: z.enum(['action_log', 'note']),
  metadata: z
    .object({
      statusFrom: z.string().nullable().optional(),
      statusTo: z.string().nullable().optional(),
      documentKind: z.enum(['order', 'quote']).optional(),
      commandId: z.string().nullable().optional(),
    })
    .optional(),
  note: z
    .object({
      body: z.string().nullable(),
      appearanceIcon: z.string().nullable().optional(),
      appearanceColor: z.string().nullable().optional(),
    })
    .optional(),
})

const historyResponseSchema = z.object({
  items: z.array(historyEntrySchema),
})

export async function GET(req: Request) {
  try {
    const { ctx, translate } = await resolveRequestContext(req)
    const rawQuery = parseQuery(req)
    const input = documentHistoryQuerySchema.parse(rawQuery)
    await ensureKindPermission(ctx, input.kind, translate)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let encryptionService: TenantDataEncryptionService | null = null
    try {
      encryptionService = ctx.container.resolve('tenantDataEncryptionService') as TenantDataEncryptionService
    } catch {
      encryptionService = null
    }

    const scope = {
      tenantId: ctx.auth?.tenantId ?? null,
      organizationId: ctx.selectedOrganizationId ?? null,
      encryptionService,
    }
    const docEntity = input.kind === 'order' ? SalesOrder : SalesQuote
    const document = await findOneWithDecryption(
      em,
      docEntity,
      {
        id: input.id,
        tenantId: scope.tenantId ?? undefined,
        organizationId: scope.organizationId ?? undefined,
        deletedAt: null,
      },
      undefined,
      scope
    )
    if (!document) {
      throw new CrudHttpError(404, { error: translate('sales.documents.detail.error', 'Document not found or inaccessible.') })
    }

    const includeTypes = new Set(input.types ?? ['status', 'action', 'comment'])
    const actionLogs = includeTypes.has('status') || includeTypes.has('action')
      ? await (ctx.container.resolve('actionLogService') as ActionLogService).list({
          tenantId: scope.tenantId ?? undefined,
          organizationId: scope.organizationId ?? undefined,
          resourceKind: input.kind === 'order' ? 'sales.order' : 'sales.quote',
          resourceId: input.id,
          limit: input.limit,
          before: input.before,
          after: input.after,
        })
      : []

    const notes = includeTypes.has('comment')
      ? await em.find(
          SalesNote,
          {
            contextType: input.kind,
            contextId: input.id,
            tenantId: scope.tenantId ?? undefined,
            organizationId: scope.organizationId ?? undefined,
            deletedAt: null,
          },
          {
            orderBy: { createdAt: 'desc' },
            limit: input.limit,
          }
        )
      : []

    const userIds = new Set<string>()
    actionLogs.forEach((log) => {
      if (log.actorUserId) userIds.add(log.actorUserId)
    })
    notes.forEach((note) => {
      if (note.authorUserId) userIds.add(note.authorUserId)
    })
    const displayMaps = await loadAuditLogDisplayMaps(em, {
      userIds,
      tenantIds: [],
      organizationIds: [],
    })

    const items = buildSalesHistoryEntries({
      actionLogs,
      notes,
      userLabels: displayMaps.users,
      includeTypes,
      documentKind: input.kind,
    }).slice(0, input.limit)

    return NextResponse.json({ items } satisfies { items: SalesHistoryEntry[] })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    console.error('sales.document-history failed', err)
    return NextResponse.json(
      { error: translate('sales.documents.history.error', 'Failed to load document history.') },
      { status: 400 }
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Sales',
  summary: 'List sales document history',
  methods: {
    GET: {
      summary: 'Document history timeline',
      query: documentHistoryQuerySchema,
      responses: [
        { status: 200, description: 'History entries', schema: historyResponseSchema },
        { status: 400, description: 'Invalid request', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Forbidden', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'Not found', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
