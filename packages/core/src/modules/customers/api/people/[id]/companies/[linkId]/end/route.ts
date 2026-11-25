import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import {
  personCompanyEmploymentEndCommandSchema,
  personCompanyEmploymentEndSchema,
  type PersonCompanyEmploymentEndInput,
} from '@open-mercato/core/modules/customers/data/validators'
import { resolveAuthActorId } from '@open-mercato/core/modules/customers/lib/interactionRequestContext'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import { isCrudHttpError, notFound, translateCrudErrorBody } from '@open-mercato/shared/lib/crud/errors'
import {
  bridgeLegacyGuard,
  runMutationGuards,
  type MutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import { getAllMutationGuardInstances } from '@open-mercato/shared/lib/crud/mutation-guard-store'
import {
  OPTIMISTIC_LOCK_CONFLICT_CODE,
  OPTIMISTIC_LOCK_HEADER_NAME,
} from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { reportTelemetryError } from '@open-mercato/shared/lib/telemetry/runtime'
import { loadPersonContext } from '../../context'

const logger = createLogger('customers')
const paramsSchema = z.object({
  id: z.string().uuid().describe('Person ID'),
  linkId: z.string().uuid().describe('Company ID'),
})
const guardPayloadSchema = personCompanyEmploymentEndSchema.partial()

function limitEmploymentGuardPayload(guard: MutationGuard): MutationGuard {
  return {
    id: guard.id,
    targetEntity: guard.targetEntity,
    operations: guard.operations,
    priority: guard.priority,
    features: guard.features,
    async validate(input) {
      const result = await guard.validate(input)
      if (!result.ok || !result.modifiedPayload) return result
      return { ...result, modifiedPayload: guardPayloadSchema.parse(result.modifiedPayload) }
    },
    afterSuccess: guard.afterSuccess?.bind(guard),
  }
}

function reportEndEmploymentError(error: unknown, code: string, guardId?: string): void {
  logger.error('End employment request failed', { err: error, code, guardId })
  try {
    reportTelemetryError(error, { module: 'customers', code, attributes: { guardId } })
  } catch {
    logger.warn('Could not send end-employment error to telemetry', { code, guardId })
  }
}

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['customers.people.manage'] },
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  pathParams: paramsSchema,
  methods: {
    POST: {
      summary: 'End a person’s employment at a company',
      headers: z.object({ [OPTIMISTIC_LOCK_HEADER_NAME]: z.string().optional() }),
      requestBody: { schema: personCompanyEmploymentEndSchema },
      responses: [
        { status: 200, description: 'Employment ended', schema: z.object({ ok: z.literal(true) }) },
        { status: 400, description: 'Invalid departure date or identifier' },
        { status: 404, description: 'Person–company link not found' },
        {
          status: 409,
          description: 'The version of the person–company assignment has changed',
          schema: z.object({
            error: z.string(),
            code: z.literal(OPTIMISTIC_LOCK_CONFLICT_CODE),
            currentUpdatedAt: z.string(),
            expectedUpdatedAt: z.string(),
          }),
        },
      ],
    },
  },
}

export async function POST(req: Request, ctx: { params?: { id?: string; linkId?: string } }) {
  const { translate } = await resolveTranslations()
  try {
    const { id, linkId: companyEntityId } = paramsSchema.parse(ctx.params ?? {})
    const payload = personCompanyEmploymentEndSchema.parse(await readJsonSafe(req, null))
    const { container, auth, selectedOrganizationId, person } = await loadPersonContext(req, id)
    if (!selectedOrganizationId || selectedOrganizationId !== person.organizationId) {
      throw notFound(translate('customers.errors.person_company_link_not_found', 'Person-company link not found'))
    }

    const scope = { tenantId: auth.tenantId, organizationId: selectedOrganizationId }
    const userId = resolveAuthActorId(auth)
    const personGuardHeaders = new Headers(req.headers)
    personGuardHeaders.delete(OPTIMISTIC_LOCK_HEADER_NAME)
    const guardScope = {
      ...scope,
      userId,
      resourceKind: 'customers.person',
      resourceId: person.id,
      operation: 'update' as const,
      requestMethod: req.method,
      requestHeaders: personGuardHeaders,
    }

    const guards = [...getAllMutationGuardInstances()]
    const legacyGuard = bridgeLegacyGuard(container)
    if (legacyGuard) guards.push(legacyGuard)
    const rbac = container.resolve<RbacService>('rbacService')
    const guardResult = await runMutationGuards(
      guards.map(limitEmploymentGuardPayload),
      { ...guardScope, mutationPayload: { ...payload, companyEntityId } },
      { userFeatures: await rbac.getGrantedFeatures(userId, scope) },
    )
    if (!guardResult.ok) {
      return NextResponse.json(guardResult.errorBody, { status: guardResult.errorStatus })
    }

    const input = personCompanyEmploymentEndCommandSchema.parse({
      ...payload,
      ...guardResult.modifiedPayload,
      ...scope,
      personEntityId: person.id,
      companyEntityId,
    })
    const commandBus = container.resolve<CommandBus>('commandBus')
    const { result, logEntry } = await commandBus.execute<PersonCompanyEmploymentEndInput, { linkId: string }>(
      'customers.personCompanyLinks.endEmployment',
      {
        input,
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

    for (const { guard, metadata: guardMetadata } of guardResult.afterSuccessCallbacks) {
      try {
        await guard.afterSuccess?.({ ...guardScope, metadata: guardMetadata })
      } catch (error) {
        reportEndEmploymentError(error, 'customers.end_employment_guard_callback_failed', guard.id)
      }
    }

    const response = NextResponse.json({ ok: true as const })
    if (logEntry?.undoToken && logEntry.id && logEntry.commandId) {
      response.headers.set('x-om-operation', serializeOperationMetadata({
        id: logEntry.id,
        undoToken: logEntry.undoToken,
        commandId: logEntry.commandId,
        actionLabel: logEntry.actionLabel ?? null,
        resourceKind: logEntry.resourceKind ?? 'customers.personCompanyLink',
        resourceId: logEntry.resourceId ?? result.linkId,
        executedAt: logEntry.createdAt instanceof Date
          ? logEntry.createdAt.toISOString()
          : logEntry.createdAt ?? new Date().toISOString(),
      }))
    }
    return response
  } catch (error) {
    if (isCrudHttpError(error)) {
      return NextResponse.json(translateCrudErrorBody(error.body, translate), { status: error.status })
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({
        error: translate('customers.errors.validationFailed', 'Validation failed'),
        details: error.issues,
      }, { status: 400 })
    }
    const interceptorRejection = getCommandInterceptorHttpRejection(error)
    if (interceptorRejection) {
      return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
    }
    reportEndEmploymentError(error, 'customers.end_employment_failed')
    return NextResponse.json({ error: translate('customers.errors.internal', 'Internal server error') }, { status: 500 })
  }
}
