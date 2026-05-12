import { NextResponse } from 'next/server'
import { z } from 'zod'
import { CustomerLabel, CustomerLabelAssignment } from '../../data/entities'
import { labelCreateCommandSchema, labelCreateSchema, type LabelCreateCommandInput } from '../../data/validators'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import { findWithDecryption, findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveLabelActorUserId } from './auth'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import {
  createMissingCustomerLabelTablesError,
  isMissingCustomerLabelTable,
} from './table-errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.people.view'] },
  POST: { requireAuth: true, requireFeatures: ['customers.people.manage'] },
}

const querySchema = z.object({
  entityId: z.string().uuid().optional(),
  organizationId: z.string().uuid().optional(),
  ids: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  search: z.string().optional(),
})

const createLabelRequestSchema = labelCreateSchema.extend({
  organizationId: z.string().uuid().optional(),
})

export async function GET(req: Request) {
  const { translate } = await resolveTranslations()
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const actorUserId = resolveLabelActorUserId(auth)
    if (!auth || !auth.tenantId || !actorUserId) {
      return NextResponse.json({ error: translate('customers.errors.unauthorized', 'Unauthorized') }, { status: 401 })
    }

    const em = container.resolve('em') as EntityManager
    const url = new URL(req.url)
    const query = querySchema.parse({
      entityId: url.searchParams.get('entityId') ?? undefined,
      organizationId: url.searchParams.get('organizationId') ?? undefined,
      ids: url.searchParams.get('ids') ?? undefined,
      page: url.searchParams.get('page') ?? undefined,
      pageSize: url.searchParams.get('pageSize') ?? undefined,
      search: url.searchParams.get('search') ?? undefined,
    })
    const scope = await resolveOrganizationScopeForRequest({
      container,
      auth,
      request: req,
      selectedId: query.organizationId ?? undefined,
    })
    const organizationId = scope?.selectedId ?? auth.orgId ?? null
    if (!organizationId) {
      throw new CrudHttpError(400, { error: translate('customers.errors.organization_required', 'Organization context is required') })
    }

    // Load all labels for this user
    const labels = await findWithDecryption(em, CustomerLabel, {
      tenantId: auth.tenantId,
      organizationId,
      userId: actorUserId,
    }, { orderBy: { label: 'asc' } }, { tenantId: auth.tenantId, organizationId })

    // If entityId provided, also load assignments for that entity
    let assignedLabelIds: string[] = []
    if (query.entityId) {
      const assignments = await findWithDecryption(em, CustomerLabelAssignment, {
        tenantId: auth.tenantId,
        organizationId,
        userId: actorUserId,
        entity: query.entityId,
      } as FilterQuery<CustomerLabelAssignment>, {}, { tenantId: auth.tenantId, organizationId })
      assignedLabelIds = assignments.map((a) => {
        try { return a.label.id } catch { return '' }
      })
      // Handle unloaded references
      if (assignedLabelIds.some((id) => !id)) {
        const loaded = await findWithDecryption(em, CustomerLabelAssignment, {
          tenantId: auth.tenantId,
          organizationId,
          userId: actorUserId,
          entity: query.entityId,
        } as FilterQuery<CustomerLabelAssignment>, { populate: ['label'] }, { tenantId: auth.tenantId, organizationId })
        assignedLabelIds = loaded.map((a) => a.label.id)
      }
    }

    const requestedIds = query.ids
      ? new Set(
          query.ids
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
        )
      : null
    const scopedLabels = requestedIds
      ? labels.filter((label) => requestedIds.has(label.id))
      : labels
    const filteredLabels = query.search?.trim().length
      ? scopedLabels.filter((label) => label.label.toLowerCase().includes(query.search!.trim().toLowerCase()))
      : scopedLabels
    const total = filteredLabels.length
    const totalPages = Math.max(1, Math.ceil(total / query.pageSize))
    const page = Math.min(query.page, totalPages)
    const start = (page - 1) * query.pageSize
    const items = filteredLabels.slice(start, start + query.pageSize)

    return NextResponse.json({
      items: items.map((l) => ({
        id: l.id,
        slug: l.slug,
        label: l.label,
      })),
      assignedIds: assignedLabelIds.filter(Boolean),
      total,
      page,
      pageSize: query.pageSize,
      totalPages,
    })
  } catch (err) {
    if (isMissingCustomerLabelTable(err)) {
      return NextResponse.json({ items: [], assignedIds: [] })
    }
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('[customers/labels.GET]', err)
    return NextResponse.json({ error: translate('customers.errors.labels_load_failed', 'Failed to load labels') }, { status: 500 })
  }
}

function slugifyLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export async function POST(req: Request) {
  try {
    const { translate } = await resolveTranslations()
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const actorUserId = resolveLabelActorUserId(auth)
    if (!auth || !auth.tenantId || !actorUserId) {
      return NextResponse.json({ error: translate('customers.errors.unauthorized', 'Unauthorized') }, { status: 401 })
    }

    const body = createLabelRequestSchema.parse(await readJsonSafe(req, {}))
    const scope = await resolveOrganizationScopeForRequest({
      container,
      auth,
      request: req,
      selectedId: body.organizationId ?? undefined,
    })
    const organizationId = scope?.selectedId ?? auth.orgId ?? null
    if (!organizationId) {
      throw new CrudHttpError(400, { error: translate('customers.errors.organization_required', 'Organization context is required') })
    }
    const slug = body.slug || slugifyLabel(body.label)

    const guardResult = await validateCrudMutationGuard(container, {
      tenantId: auth.tenantId,
      organizationId,
      userId: actorUserId,
      resourceKind: 'customers.label',
      resourceId: organizationId,
      operation: 'custom',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: body,
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }

    const commandInput = labelCreateCommandSchema.parse({
      tenantId: auth.tenantId,
      organizationId,
      userId: actorUserId,
      slug,
      label: body.label,
    } satisfies LabelCreateCommandInput)

    const commandBus = container.resolve('commandBus') as CommandBus
    const { result, logEntry } = await commandBus.execute<LabelCreateCommandInput, { labelId: string; slug: string; label: string }>(
      'customers.labels.create',
      {
        input: commandInput,
        ctx: {
          container,
          auth,
          organizationScope: scope,
          selectedOrganizationId: organizationId,
          organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
          request: req,
        },
      },
    )

    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(container, {
        tenantId: auth.tenantId,
        organizationId,
        userId: actorUserId,
        resourceKind: 'customers.label',
        resourceId: organizationId,
        operation: 'custom',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }

    const response = NextResponse.json({
      id: result.labelId,
      slug: result.slug,
      label: result.label,
    }, { status: 201 })
    if (logEntry?.undoToken && logEntry.id && logEntry.commandId) {
      response.headers.set(
        'x-om-operation',
        serializeOperationMetadata({
          id: logEntry.id,
          undoToken: logEntry.undoToken,
          commandId: logEntry.commandId,
          actionLabel: logEntry.actionLabel ?? null,
          resourceKind: logEntry.resourceKind ?? 'customers.label',
          resourceId: logEntry.resourceId ?? result.labelId,
          executedAt: logEntry.createdAt instanceof Date ? logEntry.createdAt.toISOString() : new Date().toISOString(),
        }),
      )
    }
    return response
  } catch (err) {
    if (isMissingCustomerLabelTable(err)) {
      const migrationError = await createMissingCustomerLabelTablesError()
      return NextResponse.json(migrationError.body, { status: migrationError.status })
    }
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('[customers/labels.POST]', err)
    return NextResponse.json({ error: 'Failed to create label' }, { status: 500 })
  }
}

const labelSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  label: z.string(),
})

const labelsListSchema = z.object({
  items: z.array(labelSchema),
  assignedIds: z.array(z.string().uuid()),
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  totalPages: z.number().int().min(1),
})

const errorSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Customer labels (user- and organization-scoped)',
  methods: {
    GET: {
      summary: 'List labels',
      description: 'Returns labels for the current user within the selected organization. Optionally includes assignment status for a specific entity.',
      responses: [
        { status: 200, description: 'Labels list', schema: labelsListSchema },
      ],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorSchema },
      ],
    },
    POST: {
      summary: 'Create label',
      description: 'Creates a new label scoped to the current user and selected organization.',
      requestBody: { contentType: 'application/json', schema: createLabelRequestSchema },
      responses: [
        { status: 201, description: 'Label created', schema: labelSchema },
      ],
      errors: [
        { status: 409, description: 'Duplicate slug', schema: errorSchema },
      ],
    },
  },
}
