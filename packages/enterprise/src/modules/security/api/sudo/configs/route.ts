import { NextResponse } from 'next/server'
import { z } from 'zod'
import { sudoConfigSchema } from '../../../data/validators'
import { buildSecurityOpenApi, securityErrorSchema } from '../../openapi'
import { securityApiError } from '../../i18n'
import {
  attachSudoConfigScopeNames,
  executeSudoConfigMutation,
  mapSudoError,
  parseSudoConfigBody,
  resolveSudoContext,
  sudoConfigItemSchema,
} from '../_shared'

const sudoConfigListSchema = z.object({
  items: z.array(sudoConfigItemSchema.extend({
    tenantName: z.string().nullable().optional(),
    organizationName: z.string().nullable().optional(),
  })),
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
    const { container, scope, sudoChallengeService } = context
    const configs = await sudoChallengeService.listConfigs(scope)
    return NextResponse.json({ items: await attachSudoConfigScopeNames(container, configs) })
  } catch (error) {
    return mapSudoError(error)
  }
}

export async function POST(req: Request) {
  const context = await resolveSudoContext(req)
  if (context instanceof NextResponse) return context

  const parsed = await parseSudoConfigBody(req, sudoConfigSchema)
  if (!parsed.success) {
    return securityApiError(400, 'Invalid payload', { issues: parsed.error.issues })
  }

  return executeSudoConfigMutation(req, context, 'security.sudo.config.create', parsed.data, 201)
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
