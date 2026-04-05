import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CustomerInteraction } from '@open-mercato/core/modules/customers/data/entities'
import { loadCustomerSummaries } from '@open-mercato/core/modules/customers/lib/interactionReadModel'
import { exampleTag } from '../../../../example/api/openapi'
import { mappingListQuerySchema } from '../../../data/validators'

export const metadata = {
  path: '/example-customers-sync/mappings',
  requireAuth: true,
  requireFeatures: ['example_customers_sync.view'],
}

type MappingRow = {
  id: string
  interaction_id: string
  todo_id: string
  sync_status: string
  last_synced_at: Date | null
  last_error: string | null
  source_updated_at: Date | null
  created_at: Date
  updated_at: Date
  organization_id: string
  tenant_id: string
}

type CursorPayload = {
  updatedAt: string
  id: string
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
}

function decodeCursor(token: string | undefined): CursorPayload | null {
  if (!token) return null
  try {
    const parsed = JSON.parse(Buffer.from(token, 'base64').toString('utf8')) as CursorPayload
    if (typeof parsed.id !== 'string' || typeof parsed.updatedAt !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

export async function GET(request: Request) {
  const { translate } = await resolveTranslations()
  try {
    const auth = await getAuthFromRequest(request)
    if (!auth?.tenantId) {
      return NextResponse.json(
        { error: translate('exampleCustomersSync.errors.unauthorized', 'Unauthorized') },
        { status: 401 },
      )
    }

    const url = new URL(request.url)
    const query = mappingListQuerySchema.parse(Object.fromEntries(url.searchParams))
    const cursor = decodeCursor(query.cursor)
    if (query.cursor && !cursor) {
      return NextResponse.json(
        { error: translate('exampleCustomersSync.errors.invalidCursor', 'Invalid cursor.') },
        { status: 400 },
      )
    }

    const container = await createRequestContainer()
    const scope = await resolveOrganizationScopeForRequest({ container, auth, request })
    const organizationIds = Array.isArray(scope?.filterIds) && scope.filterIds.length > 0
      ? scope.filterIds
      : auth.orgId
        ? [auth.orgId]
        : []

    const em = (container.resolve('em') as EntityManager).fork()
    const knex = em.getKnex()
    const rowsQuery = knex('example_customer_interaction_mappings')
      .select<MappingRow[]>([
        'id',
        'interaction_id',
        'todo_id',
        'sync_status',
        'last_synced_at',
        'last_error',
        'source_updated_at',
        'created_at',
        'updated_at',
        'organization_id',
        'tenant_id',
      ])
      .where('tenant_id', auth.tenantId)
      .orderBy('updated_at', 'desc')
      .orderBy('id', 'desc')
      .limit(query.limit + 1)

    if (organizationIds.length > 0) {
      rowsQuery.whereIn('organization_id', organizationIds)
    }
    if (query.interactionId) {
      rowsQuery.andWhere('interaction_id', query.interactionId)
    }
    if (query.todoId) {
      rowsQuery.andWhere('todo_id', query.todoId)
    }
    if (cursor) {
      rowsQuery.andWhere(function applyCursor() {
        this.where('updated_at', '<', new Date(cursor.updatedAt)).orWhere(function applyTieBreaker() {
          this.where('updated_at', new Date(cursor.updatedAt)).andWhere('id', '<', cursor.id)
        })
      })
    }

    const rows = await rowsQuery
    const pageRows = rows.slice(0, query.limit)
    const interactionIds = Array.from(new Set(pageRows.map((row) => row.interaction_id)))
    const interactions = interactionIds.length > 0
      ? await findWithDecryption(
          em,
          CustomerInteraction,
          {
            id: { $in: interactionIds },
            tenantId: auth.tenantId,
            ...(organizationIds.length > 0 ? { organizationId: { $in: organizationIds } } : {}),
            deletedAt: null,
          },
          undefined,
          { tenantId: auth.tenantId, organizationId: null },
        )
      : []
    const interactionById = new Map(interactions.map((interaction) => [interaction.id, interaction]))
    const customerSummaries = await loadCustomerSummaries(
      em,
      Array.from(new Set(
        interactions
          .map((interaction) => (typeof interaction.entity === 'string' ? interaction.entity : interaction.entity.id))
          .filter((value): value is string => typeof value === 'string' && value.length > 0),
      )),
      auth.tenantId,
      null,
    )

    const items = pageRows.map((row) => {
      const interaction = interactionById.get(row.interaction_id)
      const entityId = interaction
        ? (typeof interaction.entity === 'string' ? interaction.entity : interaction.entity.id)
        : null
      return {
        id: row.id,
        interactionId: row.interaction_id,
        todoId: row.todo_id,
        syncStatus: row.sync_status,
        lastSyncedAt: row.last_synced_at?.toISOString() ?? null,
        lastError: row.last_error ?? null,
        sourceUpdatedAt: row.source_updated_at?.toISOString() ?? null,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
        organizationId: row.organization_id,
        tenantId: row.tenant_id,
        exampleHref: `/backend/todos/${encodeURIComponent(row.todo_id)}/edit`,
        interaction: interaction ? {
          id: interaction.id,
          title: interaction.title ?? null,
          status: interaction.status,
          interactionType: interaction.interactionType,
          customer: entityId ? (customerSummaries.get(entityId) ?? null) : null,
        } : null,
      }
    })

    const hasMore = rows.length > query.limit
    const last = hasMore ? pageRows[pageRows.length - 1] : null

    return NextResponse.json({
      items,
      ...(last ? { nextCursor: encodeCursor({ updatedAt: last.updated_at.toISOString(), id: last.id }) } : {}),
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: translate('exampleCustomersSync.errors.validationFailed', 'Validation failed'),
          details: error.issues,
        },
        { status: 400 },
      )
    }
    console.error('example-customers-sync.mappings.get failed', error)
    return NextResponse.json(
      {
        error: translate(
          'exampleCustomersSync.errors.mappingsLoadFailed',
          'Failed to load Example customer sync mappings.',
        ),
      },
      { status: 500 },
    )
  }
}

const mappingItemSchema = z.object({
  id: z.string().uuid(),
  interactionId: z.string().uuid(),
  todoId: z.string().uuid(),
  syncStatus: z.string(),
  lastSyncedAt: z.string().nullable(),
  lastError: z.string().nullable(),
  sourceUpdatedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  organizationId: z.string().uuid(),
  tenantId: z.string().uuid(),
  exampleHref: z.string(),
  interaction: z.object({
    id: z.string().uuid(),
    title: z.string().nullable(),
    status: z.string(),
    interactionType: z.string(),
    customer: z.object({
      id: z.string().uuid(),
      displayName: z.string().nullable(),
      kind: z.string().nullable(),
    }).nullable(),
  }).nullable(),
})

export const openApi: OpenApiRouteDoc = {
  tag: exampleTag,
  methods: {
    GET: {
      summary: 'List Example customer sync mappings',
      tags: [exampleTag],
      query: mappingListQuerySchema,
      responses: [
        {
          status: 200,
          description: 'Sync mappings',
          schema: z.object({
            items: z.array(mappingItemSchema),
            nextCursor: z.string().optional(),
          }),
        },
      ],
    },
  },
}
