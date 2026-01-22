import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { plannerAvailabilityDateSpecificReplaceSchema } from '../data/validators'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import { PlannerAvailabilityRule } from '../data/entities'
import { parseAvailabilityRuleWindow } from '../lib/availabilitySchedule'
import { assertAvailabilityWriteAccess } from './access'

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
    const normalized = normalizeDateSpecificPayload(payload)
    const input = parseScopedCommandInput(plannerAvailabilityDateSpecificReplaceSchema, normalized, ctx, translate)
    const isUnavailability = input.kind === 'unavailability' || input.isAvailable === false
    const access = await assertAvailabilityWriteAccess(
      ctx,
      { subjectType: input.subjectType, subjectId: input.subjectId, requiresUnavailability: isUnavailability },
      translate,
    )
    if (!access.canManageAll && !access.canManageUnavailability) {
      const dateSet = resolveDateSet(input)
      if (dateSet.size) {
        const em = ctx.container.resolve('em') as EntityManager
        const rules = await findWithDecryption(
          em,
          PlannerAvailabilityRule,
          {
            tenantId: input.tenantId,
            organizationId: input.organizationId,
            subjectType: input.subjectType,
            subjectId: input.subjectId,
            kind: 'unavailability',
            deletedAt: null,
          },
          undefined,
          { tenantId: input.tenantId, organizationId: input.organizationId },
        )
        const blocked = rules.some((rule) => {
          const window = parseAvailabilityRuleWindow(rule)
          if (window.repeat !== 'once') return false
          return dateSet.has(formatDateKey(window.startAt))
        })
        if (blocked) {
          throw new CrudHttpError(403, { error: translate('planner.availability.errors.unauthorized', 'Unauthorized') })
        }
      }
    }
    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    const { logEntry } = await commandBus.execute('planner.availability.date-specific.replace', { input, ctx })
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
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    console.error('planner.availability.date-specific.replace failed', err)
    return NextResponse.json(
      { error: translate('planner.availability.errors.updateDateSpecific', 'Failed to save date-specific availability.') },
      { status: 400 },
    )
  }
}

export const openApi = {
  tag: 'Planner',
  summary: 'Replace date-specific availability',
  methods: {
    POST: {
      summary: 'Replace date-specific availability',
      description: 'Replaces date-specific availability rules for the subject in a single request.',
      requestBody: {
        contentType: 'application/json',
        schema: plannerAvailabilityDateSpecificReplaceSchema,
      },
      responses: [
        { status: 200, description: 'Date-specific availability updated', schema: z.object({ ok: z.literal(true) }) },
        { status: 400, description: 'Invalid payload', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Forbidden', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}

type DateSpecificPayload = {
  date?: string
  dates?: string[]
  kind?: string
  isAvailable?: boolean
  [key: string]: unknown
}

function normalizeDateSpecificPayload(payload: unknown): DateSpecificPayload {
  if (!payload || typeof payload !== 'object') return {}
  const data = { ...(payload as Record<string, unknown>) } as DateSpecificPayload
  if (!data.date && Array.isArray(data.dates) && data.dates.length > 0) {
    const first = data.dates.find((value) => typeof value === 'string' && value.length > 0)
    if (first) data.date = first
  }
  if (data.isAvailable === undefined && typeof data.kind === 'string') {
    data.isAvailable = data.kind !== 'unavailability'
  }
  return data
}

function resolveDateSet(input: { date?: string; dates?: string[] }): Set<string> {
  const dates = new Set<string>()
  if (typeof input.date === 'string' && input.date.length > 0) {
    dates.add(input.date)
  }
  if (Array.isArray(input.dates)) {
    input.dates.forEach((value) => {
      if (typeof value === 'string' && value.length > 0) {
        dates.add(value)
      }
    })
  }
  return dates
}

function formatDateKey(value: Date): string {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
