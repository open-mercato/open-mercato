import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { Form, FormVersion } from '../../data/entities'
import {
  formArchiveCommandSchema,
  formPatchRequestSchema,
  formRenameCommandSchema,
  type FormArchiveCommandInput,
  type FormRenameCommandInput,
} from '../../data/validators'
import {
  attachOperationMetadata,
  buildFormsRouteContext,
  handleRouteError,
  jsonError,
  withMutationGuard,
  withScopedPayload,
} from '../helpers'
import { FORM_RESOURCE_KIND } from '../../commands/shared'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['forms.view'] },
  PATCH: { requireAuth: true, requireFeatures: ['forms.design'] },
  DELETE: { requireAuth: true, requireFeatures: ['forms.design'] },
}

const versionSummarySchema = z.object({
  id: z.string().uuid(),
  versionNumber: z.number().int(),
  status: z.enum(['draft', 'published', 'archived']),
  schemaHash: z.string(),
  registryVersion: z.string(),
  publishedAt: z.string().nullable(),
  publishedBy: z.string().uuid().nullable(),
  changelog: z.string().nullable(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const detailResponseSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  status: z.enum(['draft', 'active', 'archived']),
  defaultLocale: z.string(),
  supportedLocales: z.array(z.string()),
  currentPublishedVersionId: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  versions: z.array(versionSummarySchema),
})

const okSchema = z.object({ ok: z.literal(true) })
const errorSchema = z.object({ error: z.string() })

function extractFormId(req: Request): string {
  const url = new URL(req.url)
  const segments = url.pathname.split('/').filter(Boolean)
  const idx = segments.findIndex((segment) => segment === 'forms')
  return idx >= 0 ? segments[idx + 1] ?? '' : ''
}

async function loadForm(em: EntityManager, id: string, tenantId: string, organizationId: string): Promise<Form | null> {
  return em.findOne(Form, { id, tenantId, organizationId, deletedAt: null })
}

export async function GET(req: Request) {
  try {
    const { ctx, organizationId, tenantId } = await buildFormsRouteContext(req)
    if (!organizationId || !tenantId) {
      return jsonError(400, 'forms.errors.organization_required')
    }
    const id = extractFormId(req)
    if (!id) return jsonError(400, 'forms.errors.invalid_id')

    const em = ctx.container.resolve('em') as EntityManager
    const form = await loadForm(em, id, tenantId, organizationId)
    if (!form) return jsonError(404, 'forms.errors.form_not_found')

    const versions = await em.find(
      FormVersion,
      { formId: form.id, tenantId, organizationId },
      { orderBy: { versionNumber: 'desc' } },
    )

    return NextResponse.json({
      id: form.id,
      key: form.key,
      name: form.name,
      description: form.description ?? null,
      status: form.status,
      defaultLocale: form.defaultLocale,
      supportedLocales: [...form.supportedLocales],
      currentPublishedVersionId: form.currentPublishedVersionId ?? null,
      createdAt: form.createdAt.toISOString(),
      updatedAt: form.updatedAt.toISOString(),
      versions: versions.map((version) => ({
        id: version.id,
        versionNumber: version.versionNumber,
        status: version.status,
        schemaHash: version.schemaHash,
        registryVersion: version.registryVersion,
        publishedAt: version.publishedAt ? version.publishedAt.toISOString() : null,
        publishedBy: version.publishedBy ?? null,
        changelog: version.changelog ?? null,
        archivedAt: version.archivedAt ? version.archivedAt.toISOString() : null,
        createdAt: version.createdAt.toISOString(),
        updatedAt: version.updatedAt.toISOString(),
      })),
    })
  } catch (error) {
    return handleRouteError('forms[id].GET', error)
  }
}

export async function PATCH(req: Request) {
  try {
    const { ctx, organizationId, tenantId, translate } = await buildFormsRouteContext(req)
    if (!organizationId || !tenantId) {
      return jsonError(400, 'forms.errors.organization_required')
    }
    const id = extractFormId(req)
    if (!id) return jsonError(400, 'forms.errors.invalid_id')

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const parsed = formPatchRequestSchema.parse(body)
    const scoped = withScopedPayload({ ...parsed, id }, ctx, translate)
    const renameInput = formRenameCommandSchema.parse(scoped) satisfies FormRenameCommandInput

    return await withMutationGuard({
      ctx,
      tenantId,
      organizationId,
      resourceKind: FORM_RESOURCE_KIND,
      resourceId: id,
      operation: 'update',
      request: req,
      payload: scoped as Record<string, unknown>,
      run: async () => {
        const commandBus = ctx.container.resolve('commandBus') as CommandBus
        const { result, logEntry } = await commandBus.execute<FormRenameCommandInput, { formId: string }>(
          'forms.form.rename',
          { input: renameInput, ctx },
        )
        const response = NextResponse.json({ ok: true })
        return attachOperationMetadata(response, logEntry, FORM_RESOURCE_KIND, result?.formId ?? id)
      },
    })
  } catch (error) {
    return handleRouteError('forms[id].PATCH', error)
  }
}

export async function DELETE(req: Request) {
  try {
    const { ctx, organizationId, tenantId, translate } = await buildFormsRouteContext(req)
    if (!organizationId || !tenantId) {
      return jsonError(400, 'forms.errors.organization_required')
    }
    const id = extractFormId(req)
    if (!id) return jsonError(400, 'forms.errors.invalid_id')

    const scoped = withScopedPayload({ id }, ctx, translate)
    const archiveInput = formArchiveCommandSchema.parse(scoped) satisfies FormArchiveCommandInput

    return await withMutationGuard({
      ctx,
      tenantId,
      organizationId,
      resourceKind: FORM_RESOURCE_KIND,
      resourceId: id,
      operation: 'delete',
      request: req,
      payload: scoped as Record<string, unknown>,
      run: async () => {
        const commandBus = ctx.container.resolve('commandBus') as CommandBus
        const { result, logEntry } = await commandBus.execute<FormArchiveCommandInput, { formId: string }>(
          'forms.form.archive',
          { input: archiveInput, ctx },
        )
        const response = NextResponse.json({ ok: true })
        return attachOperationMetadata(response, logEntry, FORM_RESOURCE_KIND, result?.formId ?? id)
      },
    })
  } catch (error) {
    return handleRouteError('forms[id].DELETE', error)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Forms',
  summary: 'Form detail and lifecycle',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: {
    GET: {
      summary: 'Get form detail',
      description: 'Returns the form metadata + version summaries.',
      responses: [
        { status: 200, description: 'Form detail', schema: detailResponseSchema },
      ],
      errors: [
        { status: 404, description: 'Form not found', schema: errorSchema },
      ],
    },
    PATCH: {
      summary: 'Rename form',
      description: 'Updates the form name and/or description.',
      requestBody: { contentType: 'application/json', schema: formPatchRequestSchema },
      responses: [{ status: 200, description: 'Form updated', schema: okSchema }],
      errors: [
        { status: 404, description: 'Form not found', schema: errorSchema },
        { status: 400, description: 'Invalid payload', schema: errorSchema },
      ],
    },
    DELETE: {
      summary: 'Archive form',
      description: 'Soft-archives the form (sets archived_at, status=archived).',
      responses: [{ status: 200, description: 'Form archived', schema: okSchema }],
      errors: [
        { status: 404, description: 'Form not found', schema: errorSchema },
      ],
    },
  },
}
