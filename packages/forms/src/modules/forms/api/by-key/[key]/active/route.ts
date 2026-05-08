/**
 * Runtime API — GET /api/forms/by-key/:key/active
 *
 * Returns the active (published) form version for a form key, sliced to the
 * roles the calling customer is permitted to act on. Customer authentication
 * is required.
 *
 * The API exposes the JSON Schema, ui schema, declared roles, declared
 * sections, and the field index sliced by the caller's available roles.
 * It does not return submission data.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getCustomerAuthFromRequest } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import { SubmissionService, SubmissionServiceError } from '../../../../../services/submission-service'

export const metadata = {
  GET: { requireAuth: false },
}

export async function GET(
  req: NextRequest,
  context: { params: { key: string } | Promise<{ key: string }> },
) {
  const auth = await getCustomerAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const params = await Promise.resolve(context.params)
  const key = String(params.key)

  const container = await createRequestContainer()
  const service = container.resolve('formsSubmissionService') as SubmissionService

  try {
    const { form, formVersion, compiled } = await service.getActiveFormVersionByKey({
      organizationId: auth.orgId,
      tenantId: auth.tenantId,
      formKey: key,
    })

    // Caller's available roles — for now we treat the customer as a generic
    // "patient"-like actor. Phase 1d's renderer will refine this once it
    // resolves the submission context. We always include 'admin' implicitly
    // when the caller has the matching feature.
    const callerRoles = resolveCallerRoles(auth.resolvedFeatures)

    const fieldIndex: Record<string, unknown> = {}
    for (const [fieldKey, descriptor] of Object.entries(compiled.fieldIndex)) {
      const visible = callerRoles.some((role) =>
        descriptor.visibleTo.includes(role) || descriptor.editableBy.includes(role),
      )
      if (!visible) continue
      fieldIndex[fieldKey] = {
        key: descriptor.key,
        type: descriptor.type,
        sectionKey: descriptor.sectionKey,
        sensitive: descriptor.sensitive,
        editableBy: descriptor.editableBy,
        visibleTo: descriptor.visibleTo,
        required: descriptor.required,
      }
    }

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
        roles: Array.isArray(formVersion.roles) ? formVersion.roles : [],
      },
      schema: formVersion.schema,
      uiSchema: formVersion.uiSchema,
      fieldIndex,
      callerRoles,
    })
  } catch (error) {
    return mapError(error)
  }
}

function resolveCallerRoles(features: string[]): string[] {
  // Customers don't carry a "role" claim per-form; we expose the wildcard
  // bucket so the renderer can refine. Admin staff calling this route would
  // hit the admin variant; portal callers default to declared customer roles.
  // Phase 1d/2a will tighten this to look up the active actor row.
  if (features.includes('*')) return ['admin']
  return ['patient', 'customer', 'guardian']
}

function mapError(error: unknown): NextResponse {
  if (error instanceof SubmissionServiceError) {
    return NextResponse.json(
      { error: error.code, message: error.message, details: error.details ?? null },
      { status: error.httpStatus },
    )
  }
  const message = error instanceof Error ? error.message : 'Unknown error'
  return NextResponse.json({ error: 'INTERNAL_ERROR', message }, { status: 500 })
}

const fieldDescriptorSchema = z.object({
  key: z.string(),
  type: z.string(),
  sectionKey: z.string().nullable(),
  sensitive: z.boolean(),
  editableBy: z.array(z.string()),
  visibleTo: z.array(z.string()),
  required: z.boolean(),
})

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
    roles: z.array(z.string()),
  }),
  schema: z.record(z.string(), z.unknown()),
  uiSchema: z.record(z.string(), z.unknown()),
  fieldIndex: z.record(z.string(), fieldDescriptorSchema),
  callerRoles: z.array(z.string()),
})

const errorSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
  details: z.unknown().optional(),
})

const getMethodDoc: OpenApiMethodDoc = {
  summary: 'Get active form version by key',
  description: 'Returns the published form version matching the supplied key, sliced to the caller\'s available roles.',
  tags: ['Forms Runtime'],
  responses: [{ status: 200, description: 'Active form version', schema: responseSchema }],
  errors: [
    { status: 401, description: 'Not authenticated', schema: errorSchema },
    { status: 404, description: 'Form not found', schema: errorSchema },
    { status: 422, description: 'Form is not active or has no published version', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Active form version',
  methods: { GET: getMethodDoc },
}
