import { NextResponse } from 'next/server'
import { z } from 'zod'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import {
  loadPersonCompanyLinks,
  summarizePersonCompanies,
} from '@open-mercato/core/modules/customers/lib/personCompanies'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { resolveAuthActorId } from '@open-mercato/core/modules/customers/lib/interactionRequestContext'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  CustomerEntity,
  CustomerPersonCompanyLink,
} from '@open-mercato/core/modules/customers/data/entities'
import {
  personCompanyLinkCreateSchema,
  type PersonCompanyLinkCreateInput,
} from '@open-mercato/core/modules/customers/data/validators'
import { loadPersonContext } from './context'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { EntityManager } from '@mikro-orm/postgresql'

const paramsSchema = z.object({
  id: z.string().uuid(),
})

const createSchema = z.object({
  companyId: z.string().uuid(),
  isPrimary: z.boolean().optional(),
})

const listResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.string().uuid(),
      companyId: z.string().uuid(),
      displayName: z.string(),
      isPrimary: z.boolean(),
    }),
  ),
})

const createResponseSchema = z.object({
  ok: z.literal(true),
  result: z.object({
    id: z.string().uuid(),
    companyId: z.string().uuid(),
    displayName: z.string(),
    isPrimary: z.boolean(),
  }),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.people.view'] },
  POST: { requireAuth: true, requireFeatures: ['customers.people.manage'] },
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  methods: {
    GET: {
      summary: 'List linked companies for a person',
      responses: [{ status: 200, description: 'Linked company rows', schema: listResponseSchema }],
    },
    POST: {
      summary: 'Link a company to a person',
      requestBody: { schema: createSchema },
      responses: [{ status: 200, description: 'Linked company row', schema: createResponseSchema }],
    },
  },
}

export async function GET(req: Request, ctx: { params?: { id?: string } }) {
  const { translate } = await resolveTranslations()
  try {
    const { id } = paramsSchema.parse({ id: ctx.params?.id })
    const { em, person, profile } = await loadPersonContext(req, id)
    const links = await loadPersonCompanyLinks(em, person)
    const items = summarizePersonCompanies(profile, links).map((entry) => ({
      id: entry.linkId ?? entry.companyId,
      companyId: entry.companyId,
      displayName: entry.displayName,
      isPrimary: entry.isPrimary,
    }))
    return NextResponse.json({ items })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    return NextResponse.json({ error: translate('customers.errors.internal', 'Internal server error') }, { status: 500 })
  }
}

export async function POST(req: Request, ctx: { params?: { id?: string } }) {
  const { translate } = await resolveTranslations()
  try {
    const { id } = paramsSchema.parse({ id: ctx.params?.id })
    const payload = createSchema.parse(await readJsonSafe(req, {}))
    const { container, auth, selectedOrganizationId, em, person } = await loadPersonContext(req, id)
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

    const commandInput = personCompanyLinkCreateSchema.parse({
      personEntityId: person.id,
      companyEntityId: payload.companyId,
      isPrimary: payload.isPrimary,
      tenantId: auth.tenantId,
      organizationId: selectedOrganizationId,
    } satisfies PersonCompanyLinkCreateInput)

    const commandBus = container.resolve('commandBus') as CommandBus
    const { result, logEntry } = await commandBus.execute<PersonCompanyLinkCreateInput, { linkId: string; created: boolean; undeleted: boolean }>(
      'customers.personCompanyLinks.create',
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
    let displayName = company?.displayName ?? ''
    if (!displayName && !company) {
      const fallbackCompany = await findOneWithDecryption(
        freshEm,
        CustomerEntity,
        { id: payload.companyId, tenantId: auth.tenantId, organizationId: selectedOrganizationId, deletedAt: null },
        undefined,
        { tenantId: auth.tenantId, organizationId: selectedOrganizationId },
      )
      displayName = fallbackCompany?.displayName ?? ''
    }

    const response = NextResponse.json({
      ok: true as const,
      result: {
        id: result.linkId,
        companyId: company?.id ?? payload.companyId,
        displayName,
        isPrimary: linkRecord ? Boolean(linkRecord.isPrimary) : Boolean(payload.isPrimary),
      },
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
