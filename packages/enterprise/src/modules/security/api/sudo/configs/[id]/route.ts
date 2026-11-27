import { NextResponse } from 'next/server'
import { z } from 'zod'
import { sudoConfigUpdateSchema } from '../../../../data/validators'
import { buildSecurityOpenApi, securityErrorSchema } from '../../../openapi'
import { securityApiError } from '../../../i18n'
import {
  executeSudoConfigMutation,
  mapSudoError,
  parseSudoConfigBody,
  resolveSudoContext,
  sudoConfigItemSchema,
  toSudoConfigResponse,
} from '../../_shared'

const paramsSchema = z.object({
  id: z.string().uuid(),
})

const okResponseSchema = z.object({
  ok: z.literal(true),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['security.sudo.view'] },
  PUT: { requireAuth: true, requireFeatures: ['security.sudo.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['security.sudo.manage'] },
}

type RouteContext = {
  params?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>
}

async function resolveConfigItemRequest(req: Request, ctx?: RouteContext) {
  const context = await resolveSudoContext(req)
  if (context instanceof NextResponse) return context

  const raw = ctx?.params ? await ctx.params : {}
  const parsed = paramsSchema.safeParse({ id: typeof raw?.id === 'string' ? raw.id : undefined })
  if (!parsed.success) {
    return securityApiError(400, 'Invalid route parameters', { issues: parsed.error.issues })
  }
  return { context, id: parsed.data.id }
}

export async function GET(req: Request, ctx?: RouteContext) {
  const target = await resolveConfigItemRequest(req, ctx)
  if (target instanceof NextResponse) return target

  const { id, context: { sudoChallengeService, scope } } = target
  try {
    const config = await sudoChallengeService.getConfigById(id, scope)
    if (!config) {
      return securityApiError(404, 'Sudo config not found')
    }
    return NextResponse.json(toSudoConfigResponse(config))
  } catch (error) {
    return mapSudoError(error)
  }
}

export async function PUT(req: Request, ctx?: RouteContext) {
  const target = await resolveConfigItemRequest(req, ctx)
  if (target instanceof NextResponse) return target

  const parsedBody = await parseSudoConfigBody(req, sudoConfigUpdateSchema)
  if (!parsedBody.success) {
    return securityApiError(400, 'Invalid payload', { issues: parsedBody.error.issues })
  }

  const { context, id } = target
  return executeSudoConfigMutation(req, context, 'security.sudo.config.update', { id, data: parsedBody.data })
}

export async function DELETE(req: Request, ctx?: RouteContext) {
  const target = await resolveConfigItemRequest(req, ctx)
  if (target instanceof NextResponse) return target

  const { context, id } = target
  return executeSudoConfigMutation(req, context, 'security.sudo.config.delete', { id })
}

export const openApi = buildSecurityOpenApi({
  summary: 'Sudo config item routes',
  methods: {
    GET: {
      summary: 'Get sudo config',
      responses: [
        { status: 200, description: 'Sudo config', schema: sudoConfigItemSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid route parameters', schema: securityErrorSchema },
        { status: 401, description: 'Unauthorized', schema: securityErrorSchema },
        { status: 404, description: 'Sudo config not found', schema: securityErrorSchema },
      ],
    },
    PUT: {
      summary: 'Update sudo config',
      requestBody: {
        contentType: 'application/json',
        schema: sudoConfigUpdateSchema,
      },
      responses: [
        { status: 200, description: 'Sudo config updated', schema: okResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid payload', schema: securityErrorSchema },
        { status: 401, description: 'Unauthorized', schema: securityErrorSchema },
        { status: 403, description: 'Sudo required', schema: securityErrorSchema },
      ],
    },
    DELETE: {
      summary: 'Delete sudo config',
      responses: [
        { status: 200, description: 'Sudo config deleted', schema: okResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid route parameters', schema: securityErrorSchema },
        { status: 401, description: 'Unauthorized', schema: securityErrorSchema },
        { status: 403, description: 'Sudo required', schema: securityErrorSchema },
      ],
    },
  },
})
