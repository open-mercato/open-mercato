/**
 * Public runner — GET /api/forms/:id/run/context.
 *
 * Returns the currently published `FormVersion` for the form id so the
 * minimal public runner can render. Auth is not required (matches the
 * parent spec — customer-facing forms support unauthenticated runs). Forms
 * that require authenticated customers should be served through the
 * existing portal route; this endpoint is purposefully scoped to the
 * minimal runner introduced in `2026-05-12-forms-reactive-core.md`.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/core'
import { Form } from '../../../../data/entities'
import { FormVersion } from '../../../../data/entities'
import { FormVersionCompiler } from '../../../../services/form-version-compiler'

export const metadata = {
  GET: { requireAuth: false },
}

export async function GET(
  _req: NextRequest,
  context: { params: { id: string } | Promise<{ id: string }> },
) {
  const params = await Promise.resolve(context.params)
  const formId = String(params.id)

  const container = await createRequestContainer()
  const emFactory = container.resolve('emFactory') as () => EntityManager
  const compiler = container.resolve('formVersionCompiler') as FormVersionCompiler
  const em = emFactory()

  const form = await em.findOne(Form, { id: formId, deletedAt: null })
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
  summary: 'Get the published form version for the minimal public runner.',
  description: 'Returns the schema + uiSchema for the form\'s currently published version. No auth — exposed for the minimal public runner.',
  tags: ['Forms Runtime'],
  responses: [{ status: 200, description: 'Published form version', schema: responseSchema }],
  errors: [
    { status: 404, description: 'Form or version not found', schema: errorSchema },
    { status: 422, description: 'Form not active or unpublished', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Public form version bootstrap',
  methods: { GET: getMethodDoc },
}
