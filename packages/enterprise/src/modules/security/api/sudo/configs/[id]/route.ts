import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { sudoConfigUpdateSchema } from '../../../../data/validators'
import { requireSudo } from '../../../../lib/sudo-middleware'
import { buildSecurityOpenApi, securityErrorSchema } from '../../../openapi'
import { mapSudoError, resolveSudoContext } from '../../_shared'

const paramsSchema = z.object({
  id: z.string().uuid(),
})

const okResponseSchema = z.object({
  ok: z.literal(true),
})

export const metadata = {
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

export async function PUT(req: Request, ctx?: RouteContext) {
  const context = await resolveSudoContext(req)
  if (context instanceof NextResponse) return context

  const parsedParams = await readParams(ctx)
  if (!parsedParams.success) {
    return NextResponse.json({ error: 'Invalid route parameters', issues: parsedParams.error.issues }, { status: 400 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  const parsedBody = sudoConfigUpdateSchema.safeParse(body)
  if (!parsedBody.success) {
    return NextResponse.json({ error: 'Invalid payload', issues: parsedBody.error.issues }, { status: 400 })
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
    return mapSudoError(error)
  }
}

export async function DELETE(req: Request, ctx?: RouteContext) {
  const context = await resolveSudoContext(req)
  if (context instanceof NextResponse) return context

  const parsedParams = await readParams(ctx)
  if (!parsedParams.success) {
    return NextResponse.json({ error: 'Invalid route parameters', issues: parsedParams.error.issues }, { status: 400 })
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
    return mapSudoError(error)
  }
}

export const openApi = buildSecurityOpenApi({
  summary: 'Sudo config item routes',
  methods: {
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
