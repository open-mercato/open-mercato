import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { sudoConfigSchema } from '../../../data/validators'
import { requireSudo } from '../../../lib/sudo-middleware'
import { buildSecurityOpenApi, securityErrorSchema } from '../../openapi'
import { securityApiError } from '../../i18n'
import { attachSudoConfigScopeNames, mapSudoError, resolveSudoContext } from '../_shared'

const sudoConfigItemSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid().nullable(),
  tenantName: z.string().nullable().optional(),
  organizationId: z.string().uuid().nullable(),
  organizationName: z.string().nullable().optional(),
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

const sudoConfigListSchema = z.object({
  items: z.array(sudoConfigItemSchema),
})

const createResponseSchema = z.object({
  id: z.string().uuid(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['security.sudo.view'] },
  POST: { requireAuth: true, requireFeatures: ['security.sudo.manage'] },
}

export async function GET(req: Request) {
  const context = await resolveSudoContext(req)
  if (context instanceof NextResponse) return context

  try {
    const items = await context.sudoChallengeService.listConfigs()
    const enriched = await attachSudoConfigScopeNames(context.container, items)
    return NextResponse.json({ items: enriched })
  } catch (error) {
    return mapSudoError(error)
  }
}

export async function POST(req: Request) {
  const context = await resolveSudoContext(req)
  if (context instanceof NextResponse) return context

  let body: unknown
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  const parsed = sudoConfigSchema.safeParse(body)
  if (!parsed.success) {
    return securityApiError(400, 'Invalid payload', { issues: parsed.error.issues })
  }

  try {
    await requireSudo(req, 'security.sudo.manage')
    const commandBus = context.container.resolve<CommandBus>('commandBus')
    const { result } = await commandBus.execute('security.sudo.config.create', {
      input: parsed.data,
      ctx: context.commandContext,
    })
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    return await mapSudoError(error)
  }
}

export const openApi = buildSecurityOpenApi({
  summary: 'Sudo config collection routes',
  methods: {
    GET: {
      summary: 'List sudo configs',
      responses: [
        { status: 200, description: 'Sudo configs', schema: sudoConfigListSchema },
      ],
      errors: [
        { status: 401, description: 'Unauthorized', schema: securityErrorSchema },
      ],
    },
    POST: {
      summary: 'Create sudo config',
      requestBody: {
        contentType: 'application/json',
        schema: sudoConfigSchema,
      },
      responses: [
        { status: 201, description: 'Sudo config created', schema: createResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid payload', schema: securityErrorSchema },
        { status: 401, description: 'Unauthorized', schema: securityErrorSchema },
        { status: 403, description: 'Sudo required', schema: securityErrorSchema },
      ],
    },
  },
})
