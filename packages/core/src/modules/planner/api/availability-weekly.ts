import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { plannerAvailabilityWeeklyReplaceSchema } from '../data/validators'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import { assertAvailabilityWriteAccess, resolveAvailabilityActorId } from './access'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('planner').child({ component: 'availability' })

export const metadata = {
  POST: { requireAuth: true },
}

type RequestContext = {
  ctx: CommandRuntimeContext
}

async function resolveRequestContext(req: Request): Promise<RequestContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()

  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('planner.availability.errors.unauthorized', 'Unauthorized') })
  }

  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = scope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, {
      error: translate('planner.availability.errors.organizationRequired', 'Organization context is required'),
    })
  }

  const ctx: CommandRuntimeContext = {
    container,
    auth,
    organizationScope: scope,
    selectedOrganizationId: organizationId,
    organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
    request: req,
  }

  return { ctx }
}

export async function POST(req: Request) {
  try {
    const { ctx } = await resolveRequestContext(req)
    const { translate } = await resolveTranslations()
    const payload = await req.json().catch(() => ({}))
    const input = parseScopedCommandInput(plannerAvailabilityWeeklyReplaceSchema, payload, ctx, translate)
    await assertAvailabilityWriteAccess(ctx, { subjectType: input.subjectType, subjectId: input.subjectId }, translate)
    const guardInput = {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      userId: resolveAvailabilityActorId(ctx.auth),
      resourceKind: 'planner.availability',
      resourceId: input.subjectId,
      operation: 'custom' as const,
      requestMethod: req.method,
      requestHeaders: req.headers,
    }
    const guardResult = await validateCrudMutationGuard(ctx.container, { ...guardInput, mutationPayload: input })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }
    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    const { logEntry } = await commandBus.execute('planner.availability.weekly.replace', { input, ctx })
    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(ctx.container, { ...guardInput, metadata: guardResult.metadata ?? null })
    }
    const response = NextResponse.json({ ok: true })
    if (logEntry?.undoToken && logEntry?.id && logEntry?.commandId) {
      response.headers.set(
        'x-om-operation',
        serializeOperationMetadata({
          id: logEntry.id,
          undoToken: logEntry.undoToken,
          commandId: logEntry.commandId,
          actionLabel: logEntry.actionLabel ?? null,
          resourceKind: logEntry.resourceKind ?? 'planner.availability',
          resourceId: logEntry.resourceId ?? null,
          executedAt: logEntry.createdAt instanceof Date ? logEntry.createdAt.toISOString() : undefined,
        })
      )
    }
    return response
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    logger.error('Weekly availability replace failed', { err })
    return NextResponse.json(
      { error: translate('planner.availability.errors.updateWeekly', 'Failed to save weekly availability.') },
      { status: 400 },
    )
  }
}

export const openApi = {
  tag: 'Planner',
  summary: 'Replace weekly availability',
  methods: {
    POST: {
      summary: 'Replace weekly availability',
      description: 'Replaces weekly availability rules for the subject in a single request.',
      requestBody: {
        contentType: 'application/json',
        schema: plannerAvailabilityWeeklyReplaceSchema,
      },
      responses: [
        { status: 200, description: 'Weekly availability updated', schema: z.object({ ok: z.literal(true) }) },
        { status: 400, description: 'Invalid payload', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Forbidden', schema: z.object({ error: z.string() }) },
        {
          status: 409,
          description: 'Optimistic lock conflict',
          schema: z.object({
            error: z.string(),
            code: z.literal('optimistic_lock_conflict'),
            currentUpdatedAt: z.string(),
            expectedUpdatedAt: z.string(),
          }),
        },
      ],
    },
  },
}
