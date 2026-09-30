/**
 * In-app runner — GET /api/forms/:id/run/context.
 *
 * Returns the currently published `FormVersion` for the form id so the
 * in-app runner at `/forms/:id/run` can render.
 *
 * Authenticated and tenant-scoped. This route is addressed by FORM id, not by
 * a distribution slug or an invitation token, so it carries no capability a
 * tenant deliberately handed out. Served anonymously it would return the full
 * `schema` + `uiSchema` of ANY active published form in ANY tenant to anyone
 * holding the form UUID — bypassing the distribution gate, the availability and
 * cap checks, the CAPTCHA and the rate limiter that `/api/forms/public/*`
 * enforces. Anonymous traffic belongs on that flow (`/f/:slug`, `/i/:token`),
 * which is what the render-surfaces spec assigns it to.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import type { EntityManager } from '@mikro-orm/core'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { Form } from '../../../../data/entities'
import { FormVersion } from '../../../../data/entities'
import { FormVersionCompiler } from '../../../../services/form-version-compiler'
import { buildFormsRouteContext, jsonError } from '../../../helpers'

export const metadata = {
  GET: { requireAuth: true },
}

export async function GET(
  req: Request,
  context: { params: { id: string } | Promise<{ id: string }> },
) {
  const params = await Promise.resolve(context.params)
  const formId = String(params.id)

  let scoped: Awaited<ReturnType<typeof buildFormsRouteContext>>
  try {
    scoped = await buildFormsRouteContext(req)
  } catch (error) {
    if (isCrudHttpError(error)) return NextResponse.json(error.body, { status: error.status })
    throw error
  }
  const { ctx, organizationId, tenantId } = scoped
  if (!organizationId || !tenantId) {
    return jsonError(400, 'forms.errors.organization_required')
  }

  const compiler = ctx.container.resolve('formVersionCompiler') as FormVersionCompiler
  const em = ctx.container.resolve('em') as EntityManager

  const form = await em.findOne(Form, { id: formId, tenantId, organizationId, deletedAt: null })
  if (!form) {
    return NextResponse.json({ error: 'NOT_FOUND', message: 'Form not found.' }, { status: 404 })
  }
  if (form.status !== 'active') {
    return NextResponse.json({ error: 'FORM_INACTIVE', message: 'Form is not active.' }, { status: 422 })
  }
  if (!form.currentPublishedVersionId) {
    return NextResponse.json(
      { error: 'FORM_VERSION_NOT_PUBLISHED', message: 'Form has no published version.' },
      { status: 422 },
    )
  }
  const formVersion = await em.findOne(FormVersion, {
    id: form.currentPublishedVersionId,
    organizationId: form.organizationId,
    tenantId: form.tenantId,
  })
  if (!formVersion) {
    return NextResponse.json({ error: 'NOT_FOUND', message: 'Form version not found.' }, { status: 404 })
  }

  const compiled = compiler.compile({
    id: formVersion.id,
    updatedAt: formVersion.updatedAt,
    schema: formVersion.schema,
    uiSchema: formVersion.uiSchema,
  })

  return NextResponse.json({
    form: {
      id: form.id,
      key: form.key,
      name: form.name,
      defaultLocale: form.defaultLocale,
      supportedLocales: form.supportedLocales,
    },
    formVersion: {
      id: formVersion.id,
      versionNumber: formVersion.versionNumber,
      schemaHash: compiled.schemaHash,
      registryVersion: compiled.registryVersion,
    },
    schema: formVersion.schema,
    uiSchema: formVersion.uiSchema,
    requiresCustomerAuth: false,
  })
}

const responseSchema = z.object({
  form: z.object({
    id: z.string().uuid(),
    key: z.string(),
    name: z.string(),
    defaultLocale: z.string(),
    supportedLocales: z.array(z.string()),
  }),
  formVersion: z.object({
    id: z.string().uuid(),
    versionNumber: z.number().int(),
    schemaHash: z.string(),
    registryVersion: z.string(),
  }),
  schema: z.record(z.string(), z.unknown()),
  uiSchema: z.record(z.string(), z.unknown()),
  requiresCustomerAuth: z.boolean(),
})

const errorSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
})

const getMethodDoc: OpenApiMethodDoc = {
  summary: 'Get the published form version for the in-app runner.',
  description: 'Returns the schema + uiSchema for the form\'s currently published version. Authenticated and scoped to the caller\'s tenant and organization — anonymous runs go through POST /api/forms/public/start instead.',
  tags: ['Forms Runtime'],
  responses: [{ status: 200, description: 'Published form version', schema: responseSchema }],
  errors: [
    { status: 400, description: 'Missing tenant or organization context', schema: errorSchema },
    { status: 401, description: 'Unauthenticated', schema: errorSchema },
    { status: 404, description: 'Form or version not found', schema: errorSchema },
    { status: 422, description: 'Form not active or unpublished', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Public form version bootstrap',
  methods: { GET: getMethodDoc },
}
