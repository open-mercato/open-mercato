import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { updateEnforcementPolicySchema } from '../../../data/validators'
import { buildSecurityOpenApi, securityErrorSchema } from '../../openapi'
import { securityApiError } from '../../i18n'
import { mapEnforcementError, resolveEnforcementContext } from '../_shared'

const paramsSchema = z.object({
  id: z.string().uuid(),
})

const okResponseSchema = z.object({
  ok: z.literal(true),
})

export const metadata = {
  PUT: { requireAuth: true, requireFeatures: ['security.admin.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['security.admin.manage'] },
}

export async function PUT(req: Request, context: { params: Promise<{ id: string }> }) {
  const requestContext = await resolveEnforcementContext(req)
  if (requestContext instanceof NextResponse) return requestContext

  const params = paramsSchema.safeParse(await context.params)
  if (!params.success) {
    return securityApiError(400, 'Invalid policy id.', { issues: params.error.issues })
  }

  let rawBody: unknown
  try {
    rawBody = await req.json()
  } catch {
    rawBody = {}
  }

  const parsedBody = updateEnforcementPolicySchema.safeParse(rawBody)
  if (!parsedBody.success) {
    return securityApiError(400, 'Invalid payload', { issues: parsedBody.error.issues })
  }

  try {
    const commandBus = requestContext.container.resolve<CommandBus>('commandBus')
    const { result } = await commandBus.execute('security.enforcement.update', {
      input: {
        id: params.data.id,
        data: parsedBody.data,
      },
      ctx: requestContext.commandContext,
    })
    return NextResponse.json(result)
  } catch (error) {
    return await mapEnforcementError(error)
  }
}

export async function DELETE(req: Request, context: { params: Promise<{ id: string }> }) {
  const requestContext = await resolveEnforcementContext(req)
  if (requestContext instanceof NextResponse) return requestContext

  const params = paramsSchema.safeParse(await context.params)
  if (!params.success) {
    return securityApiError(400, 'Invalid policy id.', { issues: params.error.issues })
  }

  try {
    const commandBus = requestContext.container.resolve<CommandBus>('commandBus')
    const { result } = await commandBus.execute('security.enforcement.delete', {
      input: { id: params.data.id },
      ctx: requestContext.commandContext,
    })
    return NextResponse.json(result)
  } catch (error) {
    return await mapEnforcementError(error)
  }
}

export const openApi = buildSecurityOpenApi({
  summary: 'Enforcement policy item routes',
  methods: {
    PUT: {
      summary: 'Update enforcement policy',
      pathParams: paramsSchema,
      requestBody: {
        contentType: 'application/json',
        schema: updateEnforcementPolicySchema,
      },
      responses: [
        { status: 200, description: 'Policy updated', schema: okResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid input', schema: securityErrorSchema },
        { status: 401, description: 'Unauthorized', schema: securityErrorSchema },
        { status: 404, description: 'Policy not found', schema: securityErrorSchema },
        { status: 409, description: 'Conflict', schema: securityErrorSchema },
      ],
    },
    DELETE: {
      summary: 'Delete enforcement policy',
      pathParams: paramsSchema,
      responses: [
        { status: 200, description: 'Policy deleted', schema: okResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid policy id', schema: securityErrorSchema },
        { status: 401, description: 'Unauthorized', schema: securityErrorSchema },
        { status: 404, description: 'Policy not found', schema: securityErrorSchema },
      ],
    },
  },
})
