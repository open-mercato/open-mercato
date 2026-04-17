import { NextResponse } from 'next/server'
import { z } from 'zod'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveAuthActorId } from '@open-mercato/core/modules/customers/lib/interactionRequestContext'
import { CustomerPersonCompanyLink } from '@open-mercato/core/modules/customers/data/entities'
import {
  personCompanyLinkDeleteSchema,
  personCompanyLinkUpdateSchema,
  type PersonCompanyLinkDeleteInput,
  type PersonCompanyLinkUpdateInput,
} from '@open-mercato/core/modules/customers/data/validators'
import { loadPersonContext } from '../context'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { EntityManager } from '@mikro-orm/postgresql'

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
    const { container, auth, selectedOrganizationId, person } = await loadPersonContext(req, id)
    if (!selectedOrganizationId) {
      throw new CrudHttpError(400, { error: translate('customers.errors.organization_required', 'Organization context is required') })
    }
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

    if (payload.isPrimary === undefined) {
      return NextResponse.json({ ok: true as const, result: null })
    }

    const commandInput = personCompanyLinkUpdateSchema.parse({
      linkId,
      isPrimary: payload.isPrimary,
      tenantId: auth.tenantId,
      organizationId: selectedOrganizationId,
    } satisfies PersonCompanyLinkUpdateInput)

    const commandBus = container.resolve('commandBus') as CommandBus
    const { result, logEntry } = await commandBus.execute<PersonCompanyLinkUpdateInput, { linkId: string }>(
      'customers.personCompanyLinks.update',
      {
        input: commandInput,
        ctx: {
          container,
          auth,
          organizationScope: null,
          selectedOrganizationId,
          organizationIds: [selectedOrganizationId],
          request: req,
        },
      },
    )

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

    const freshEm = (container.resolve('em') as EntityManager).fork()
    const linkRecord = await findOneWithDecryption(
      freshEm,
      CustomerPersonCompanyLink,
      { id: result.linkId },
      { populate: ['company'] },
      { tenantId: auth.tenantId, organizationId: selectedOrganizationId },
    )
    const company = linkRecord && typeof linkRecord.company !== 'string' ? linkRecord.company : null
    const response = NextResponse.json({
      ok: true as const,
      result: linkRecord
        ? {
            id: linkRecord.id,
            companyId: company?.id ?? '',
            displayName: company?.displayName ?? '',
            isPrimary: Boolean(linkRecord.isPrimary),
          }
        : null,
    })
    if (logEntry?.undoToken && logEntry.id && logEntry.commandId) {
      response.headers.set(
        'x-om-operation',
        serializeOperationMetadata({
          id: logEntry.id,
          undoToken: logEntry.undoToken,
          commandId: logEntry.commandId,
          actionLabel: logEntry.actionLabel ?? null,
          resourceKind: logEntry.resourceKind ?? 'customers.personCompanyLink',
          resourceId: logEntry.resourceId ?? result.linkId,
          executedAt: logEntry.createdAt instanceof Date ? logEntry.createdAt.toISOString() : new Date().toISOString(),
        }),
      )
    }
    return response
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
    const { container, auth, selectedOrganizationId, person } = await loadPersonContext(req, id)
    if (!selectedOrganizationId) {
      throw new CrudHttpError(400, { error: translate('customers.errors.organization_required', 'Organization context is required') })
    }
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

    const commandInput = personCompanyLinkDeleteSchema.parse({
      linkId,
      tenantId: auth.tenantId,
      organizationId: selectedOrganizationId,
    } satisfies PersonCompanyLinkDeleteInput)

    const commandBus = container.resolve('commandBus') as CommandBus
    const { result, logEntry } = await commandBus.execute<PersonCompanyLinkDeleteInput, { linkId: string }>(
      'customers.personCompanyLinks.delete',
      {
        input: commandInput,
        ctx: {
          container,
          auth,
          organizationScope: null,
          selectedOrganizationId,
          organizationIds: [selectedOrganizationId],
          request: req,
        },
      },
    )

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

    const response = NextResponse.json({ ok: true as const })
    if (logEntry?.undoToken && logEntry.id && logEntry.commandId) {
      response.headers.set(
        'x-om-operation',
        serializeOperationMetadata({
          id: logEntry.id,
          undoToken: logEntry.undoToken,
          commandId: logEntry.commandId,
          actionLabel: logEntry.actionLabel ?? null,
          resourceKind: logEntry.resourceKind ?? 'customers.personCompanyLink',
          resourceId: logEntry.resourceId ?? result.linkId,
          executedAt: logEntry.createdAt instanceof Date ? logEntry.createdAt.toISOString() : new Date().toISOString(),
        }),
      )
    }
    return response
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    return NextResponse.json({ error: translate('customers.errors.internal', 'Internal server error') }, { status: 500 })
  }
}
