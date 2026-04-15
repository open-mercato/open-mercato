import { NextResponse } from 'next/server'
import { z } from 'zod'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import {
  removePersonCompanyLink,
  updatePersonCompanyLink,
} from '@open-mercato/core/modules/customers/lib/personCompanies'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { resolveAuthActorId } from '@open-mercato/core/modules/customers/lib/interactionRequestContext'
import { loadPersonContext } from '../context'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

const paramsSchema = z.object({
  id: z.string().uuid(),
  linkId: z.string().uuid(),
})

const updateSchema = z.object({
  isPrimary: z.boolean().optional(),
})

const updateResponseSchema = z.object({
  ok: z.literal(true),
  result: z
    .object({
      id: z.string().uuid(),
      companyId: z.string().uuid(),
      displayName: z.string(),
      isPrimary: z.boolean(),
    })
    .nullable(),
})

export const metadata = {
  PATCH: { requireAuth: true, requireFeatures: ['customers.people.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['customers.people.manage'] },
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  methods: {
    PATCH: {
      summary: 'Update a linked company for a person',
      requestBody: { schema: updateSchema },
      responses: [{ status: 200, description: 'Updated company link', schema: updateResponseSchema }],
    },
    DELETE: {
      summary: 'Remove a linked company from a person',
      responses: [{ status: 200, description: 'Deletion result', schema: z.object({ ok: z.literal(true) }) }],
    },
  },
}

export async function PATCH(req: Request, ctx: { params?: { id?: string; linkId?: string } }) {
  const { translate } = await resolveTranslations()
  try {
    const { id, linkId } = paramsSchema.parse({ id: ctx.params?.id, linkId: ctx.params?.linkId })
    const payload = updateSchema.parse(await readJsonSafe(req, {}))
    const { container, auth, selectedOrganizationId, em, person, profile } = await loadPersonContext(req, id)
    const guardUserId = resolveAuthActorId(auth)
    const guardResult = await validateCrudMutationGuard(container, {
      tenantId: auth.tenantId,
      organizationId: selectedOrganizationId,
      userId: guardUserId,
      resourceKind: 'customers.person',
      resourceId: person.id,
      operation: 'custom',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: payload,
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }
    const link = await updatePersonCompanyLink(em, person, profile, linkId, payload)
    await em.flush()
    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(container, {
        tenantId: auth.tenantId,
        organizationId: selectedOrganizationId,
        userId: guardUserId,
        resourceKind: 'customers.person',
        resourceId: person.id,
        operation: 'custom',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }
    const company = link && typeof link.company !== 'string' ? link.company : null
    return NextResponse.json({
      ok: true,
      result: link
        ? {
            id: link.id,
            companyId: company?.id ?? '',
            displayName: company?.displayName ?? '',
            isPrimary: Boolean(link.isPrimary),
          }
        : null,
    })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    return NextResponse.json({ error: translate('customers.errors.internal', 'Internal server error') }, { status: 500 })
  }
}

export async function DELETE(req: Request, ctx: { params?: { id?: string; linkId?: string } }) {
  const { translate } = await resolveTranslations()
  try {
    const { id, linkId } = paramsSchema.parse({ id: ctx.params?.id, linkId: ctx.params?.linkId })
    const { container, auth, selectedOrganizationId, em, person, profile } = await loadPersonContext(req, id)
    const guardUserId = resolveAuthActorId(auth)
    const guardResult = await validateCrudMutationGuard(container, {
      tenantId: auth.tenantId,
      organizationId: selectedOrganizationId,
      userId: guardUserId,
      resourceKind: 'customers.person',
      resourceId: person.id,
      operation: 'custom',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: { id: linkId },
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }
    await removePersonCompanyLink(em, person, profile, linkId)
    await em.flush()
    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(container, {
        tenantId: auth.tenantId,
        organizationId: selectedOrganizationId,
        userId: guardUserId,
        resourceKind: 'customers.person',
        resourceId: person.id,
        operation: 'custom',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    return NextResponse.json({ error: translate('customers.errors.internal', 'Internal server error') }, { status: 500 })
  }
}
