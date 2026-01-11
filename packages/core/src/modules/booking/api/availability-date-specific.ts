import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { bookingAvailabilityDateSpecificReplaceSchema } from '../data/validators'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['booking.manage_availability'] },
}

type RequestContext = {
  ctx: CommandRuntimeContext
}

async function resolveRequestContext(req: Request): Promise<RequestContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()

  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('booking.availability.errors.unauthorized', 'Unauthorized') })
  }

  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = scope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, {
      error: translate('booking.availability.errors.organizationRequired', 'Organization context is required'),
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
    const input = parseScopedCommandInput(bookingAvailabilityDateSpecificReplaceSchema, payload, ctx, translate)
    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    await commandBus.execute('booking.availability.date-specific.replace', { input, ctx })
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    console.error('booking.availability.date-specific.replace failed', err)
    return NextResponse.json(
      { error: translate('booking.availability.errors.updateDateSpecific', 'Failed to save date-specific availability.') },
      { status: 400 },
    )
  }
}

export const openApi = {
  tag: 'Booking',
  summary: 'Replace date-specific availability',
  methods: {
    POST: {
      summary: 'Replace date-specific availability',
      description: 'Replaces date-specific availability rules for the subject in a single request.',
      requestBody: {
        contentType: 'application/json',
        schema: bookingAvailabilityDateSpecificReplaceSchema,
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
