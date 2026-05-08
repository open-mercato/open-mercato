import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { Form, FormVersion } from '../data/entities'
import {
  formCreateRequestSchema,
  formListQuerySchema,
  type FormCreateCommandInput,
  type FormCreateRequestInput,
} from '../data/validators'
import {
  attachOperationMetadata,
  buildFormsRouteContext,
  handleRouteError,
  jsonError,
  withMutationGuard,
  withScopedPayload,
} from './helpers'
import { FORM_RESOURCE_KIND } from '../commands/shared'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['forms.view'] },
  POST: { requireAuth: true, requireFeatures: ['forms.design'] },
}

const listItemSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  status: z.enum(['draft', 'active', 'archived']),
  defaultLocale: z.string(),
  supportedLocales: z.array(z.string()),
  currentPublishedVersionId: z.string().uuid().nullable(),
  currentPublishedVersionNumber: z.number().int().nullable(),
  draftVersionId: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const listResponseSchema = z.object({
  items: z.array(listItemSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  totalPages: z.number().int(),
})

const createResponseSchema = z.object({
  id: z.string().uuid(),
})

const errorSchema = z.object({ error: z.string() })

function pickStatuses(raw: string | null): Array<'draft' | 'active' | 'archived'> {
  if (!raw) return []
  const tokens = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  return tokens.filter((t): t is 'draft' | 'active' | 'archived' =>
    t === 'draft' || t === 'active' || t === 'archived',
  )
}

export async function GET(req: Request) {
  try {
    const { ctx, organizationId, tenantId } = await buildFormsRouteContext(req)
    if (!organizationId || !tenantId) {
      return jsonError(400, 'forms.errors.organization_required')
    }
    const url = new URL(req.url)
    const queryRaw: Record<string, unknown> = {}
    const statusParam = url.searchParams.get('status')
    if (statusParam !== null) queryRaw.status = pickStatuses(statusParam)
    const qParam = url.searchParams.get('q')
    if (qParam !== null) queryRaw.q = qParam
    const pageParam = url.searchParams.get('page')
    if (pageParam !== null) queryRaw.page = pageParam
    const pageSizeParam = url.searchParams.get('pageSize')
    if (pageSizeParam !== null) queryRaw.pageSize = pageSizeParam

    const parsed = formListQuerySchema.parse(queryRaw)
    const page = parsed.page ?? 1
    const pageSize = Math.min(parsed.pageSize ?? 20, 100)

    const em = ctx.container.resolve('em') as EntityManager
    const where: Record<string, unknown> = {
      tenantId,
      organizationId,
      deletedAt: null,
    }
    const statuses = Array.isArray(parsed.status)
      ? parsed.status
      : parsed.status
        ? [parsed.status]
        : []
    if (statuses.length > 0) {
      where.status = { $in: statuses }
    }
    if (parsed.q && parsed.q.trim()) {
      const pattern = `%${escapeLikePattern(parsed.q.trim().toLowerCase())}%`
      where.$or = [
        { name: { $ilike: pattern } },
        { key: { $ilike: pattern } },
      ]
    }
    const [forms, total] = await em.findAndCount(Form, where, {
      orderBy: { updatedAt: 'desc' },
      limit: pageSize,
      offset: (page - 1) * pageSize,
    })

    // Aggregate version metadata in a single pass to avoid N+1.
    const formIds = forms.map((entry) => entry.id)
    const versions = formIds.length
      ? await em.find(FormVersion, {
          formId: { $in: formIds },
          tenantId,
          organizationId,
        })
      : []
    const draftByForm = new Map<string, string>()
    const publishedNumberByForm = new Map<string, number>()
    for (const version of versions) {
      if (version.status === 'draft') {
        if (!draftByForm.has(version.formId)) {
          draftByForm.set(version.formId, version.id)
        }
      }
    }
    for (const form of forms) {
      if (form.currentPublishedVersionId) {
        const match = versions.find((v) => v.id === form.currentPublishedVersionId)
        if (match) publishedNumberByForm.set(form.id, match.versionNumber)
      }
    }

    const items = forms.map((form) => ({
      id: form.id,
      key: form.key,
      name: form.name,
      description: form.description ?? null,
      status: form.status,
      defaultLocale: form.defaultLocale,
      supportedLocales: [...form.supportedLocales],
      currentPublishedVersionId: form.currentPublishedVersionId ?? null,
      currentPublishedVersionNumber: publishedNumberByForm.get(form.id) ?? null,
      draftVersionId: draftByForm.get(form.id) ?? null,
      createdAt: form.createdAt.toISOString(),
      updatedAt: form.updatedAt.toISOString(),
    }))

    return NextResponse.json({
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    })
  } catch (error) {
    return handleRouteError('forms.GET', error)
  }
}

export async function POST(req: Request) {
  try {
    const { ctx, organizationId, tenantId, translate } = await buildFormsRouteContext(req)
    if (!organizationId || !tenantId) {
      return jsonError(400, 'forms.errors.organization_required')
    }
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const parsedBody = formCreateRequestSchema.parse(body) satisfies FormCreateRequestInput
    const scoped = withScopedPayload(parsedBody as Record<string, unknown>, ctx, translate)

    return await withMutationGuard({
      ctx,
      tenantId,
      organizationId,
      resourceKind: FORM_RESOURCE_KIND,
      resourceId: 'new',
      operation: 'create',
      request: req,
      payload: scoped as Record<string, unknown>,
      run: async () => {
        const commandBus = ctx.container.resolve('commandBus') as CommandBus
        const { result, logEntry } = await commandBus.execute<FormCreateCommandInput, { formId: string }>(
          'forms.form.create',
          { input: scoped as FormCreateCommandInput, ctx },
        )
        const response = NextResponse.json({ id: result?.formId ?? null }, { status: 201 })
        return attachOperationMetadata(response, logEntry, FORM_RESOURCE_KIND, result?.formId ?? null)
      },
    })
  } catch (error) {
    return handleRouteError('forms.POST', error)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Forms',
  summary: 'Manage forms',
  methods: {
    GET: {
      summary: 'List forms',
      description: 'Returns paginated forms scoped to the authenticated organization.',
      query: formListQuerySchema,
      responses: [
        { status: 200, description: 'Form list', schema: listResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Tenant or organization context missing', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
      ],
    },
    POST: {
      summary: 'Create form',
      description: 'Creates a new form. Status starts as draft until a version is published.',
      requestBody: { contentType: 'application/json', schema: formCreateRequestSchema },
      responses: [
        { status: 201, description: 'Form created', schema: createResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid payload', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 422, description: 'Form key already taken', schema: errorSchema },
      ],
    },
  },
}
