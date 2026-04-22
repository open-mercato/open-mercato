import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { sudoConfigUpdateSchema } from '../../../../data/validators'
import { requireSudo } from '../../../../lib/sudo-middleware'
import { buildSecurityOpenApi, securityErrorSchema } from '../../../openapi'
import { securityApiError } from '../../../i18n'
import { mapSudoError, resolveSudoContext, toSudoConfigResponse } from '../../_shared'

const paramsSchema = z.object({
  id: z.string().uuid(),
})

const okResponseSchema = z.object({
  ok: z.literal(true),
})

const sudoConfigItemSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid().nullable(),
  organizationId: z.string().uuid().nullable(),
  label: z.string().nullable(),
  targetIdentifier: z.string(),
  isEnabled: z.boolean(),
  isDeveloperDefault: z.boolean(),
  ttlSeconds: z.number().int(),
  challengeMethod: z.string(),
  configuredBy: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['security.sudo.view'] },
  PUT: { requireAuth: true, requireFeatures: ['security.sudo.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['security.sudo.manage'] },
}

type RouteContext = {
  params?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>
}

async function readParams(ctx?: RouteContext) {
  const raw = ctx?.params ? await ctx.params : {}
  return paramsSchema.safeParse({
    id: typeof raw?.id === 'string' ? raw.id : undefined,
  })
}

export async function GET(req: Request, ctx?: RouteContext) {
  const context = await resolveSudoContext(req)
  if (context instanceof NextResponse) return context

  const parsedParams = await readParams(ctx)
  if (!parsedParams.success) {
    return securityApiError(400, 'Invalid route parameters', { issues: parsedParams.error.issues })
  }

  try {
    const config = await context.sudoChallengeService.getConfigById(parsedParams.data.id)
    if (!config) {
      return securityApiError(404, 'Sudo config not found')
    }
    return NextResponse.json(toSudoConfigResponse(config))
  } catch (error) {
    return await mapSudoError(error)
  }
}

export async function PUT(req: Request, ctx?: RouteContext) {
  const context = await resolveSudoContext(req)
  if (context instanceof NextResponse) return context

  const parsedParams = await readParams(ctx)
  if (!parsedParams.success) {
    return securityApiError(400, 'Invalid route parameters', { issues: parsedParams.error.issues })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  const parsedBody = sudoConfigUpdateSchema.safeParse(body)
  if (!parsedBody.success) {
    return securityApiError(400, 'Invalid payload', { issues: parsedBody.error.issues })
  }

  try {
    await requireSudo(req, 'security.sudo.manage')
    const commandBus = context.container.resolve<CommandBus>('commandBus')
    const { result } = await commandBus.execute('security.sudo.config.update', {
      input: {
        id: parsedParams.data.id,
        data: parsedBody.data,
      },
      ctx: context.commandContext,
    })
    return NextResponse.json(result)
  } catch (error) {
    return await mapSudoError(error)
  }
}

export async function DELETE(req: Request, ctx?: RouteContext) {
  const context = await resolveSudoContext(req)
  if (context instanceof NextResponse) return context

  const parsedParams = await readParams(ctx)
  if (!parsedParams.success) {
    return securityApiError(400, 'Invalid route parameters', { issues: parsedParams.error.issues })
  }

  try {
    await requireSudo(req, 'security.sudo.manage')
    const commandBus = context.container.resolve<CommandBus>('commandBus')
    const { result } = await commandBus.execute('security.sudo.config.delete', {
      input: { id: parsedParams.data.id },
      ctx: context.commandContext,
    })
    return NextResponse.json(result)
  } catch (error) {
    return await mapSudoError(error)
  }
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
