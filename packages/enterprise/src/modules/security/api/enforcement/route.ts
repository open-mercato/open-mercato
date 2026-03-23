import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { enforcementPolicySchema } from '../../data/validators'
import { EnforcementScope } from '../../data/entities'
import { buildSecurityOpenApi, securityErrorSchema } from '../openapi'
import { securityApiError } from '../i18n'
import { attachPolicyScopeNames, mapEnforcementError, resolveEnforcementContext } from './_shared'

const enforcementPolicyResponseSchema = z.object({
  id: z.string().uuid(),
  scope: z.nativeEnum(EnforcementScope),
  tenantId: z.string().uuid().nullable(),
  tenantName: z.string().nullable(),
  organizationId: z.string().uuid().nullable(),
  organizationName: z.string().nullable(),
  isEnforced: z.boolean(),
  allowedMethods: z.array(z.string()).nullable(),
  enforcementDeadline: z.string().nullable(),
  enforcedBy: z.string().uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const enforcementPolicyListResponseSchema = z.object({
  items: z.array(enforcementPolicyResponseSchema),
})

const createEnforcementPolicyResponseSchema = z.object({
  id: z.string().uuid(),
})

const listQuerySchema = z.object({
  scope: z.nativeEnum(EnforcementScope).optional(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['security.admin.manage'] },
  POST: { requireAuth: true, requireFeatures: ['security.admin.manage'] },
}

export async function GET(req: Request) {
  const context = await resolveEnforcementContext(req)
  if (context instanceof NextResponse) return context

  try {
    const url = new URL(req.url)
    const parsedQuery = listQuerySchema.safeParse({
      scope: url.searchParams.get('scope') ?? undefined,
    })
    if (!parsedQuery.success) {
      return securityApiError(400, 'Invalid query parameters', { issues: parsedQuery.error.issues })
    }

    const policies = await context.enforcementService.listPolicies(parsedQuery.data)
    return NextResponse.json({
      items: await attachPolicyScopeNames(context.container, policies),
    })
  } catch (error) {
    return await mapEnforcementError(error)
  }
}

export async function POST(req: Request) {
  const context = await resolveEnforcementContext(req)
  if (context instanceof NextResponse) return context

  let rawBody: unknown
  try {
    rawBody = await req.json()
  } catch {
    rawBody = {}
  }

  const parsedBody = enforcementPolicySchema.safeParse(rawBody)
  if (!parsedBody.success) {
    return securityApiError(400, 'Invalid payload', { issues: parsedBody.error.issues })
  }

  try {
    const commandBus = context.container.resolve<CommandBus>('commandBus')
    const { result } = await commandBus.execute('security.enforcement.create', {
      input: parsedBody.data,
      ctx: context.commandContext,
    })
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    return await mapEnforcementError(error)
  }
}

export const openApi = buildSecurityOpenApi({
  summary: 'Enforcement policy routes',
  methods: {
    GET: {
      summary: 'List enforcement policies',
      query: listQuerySchema,
      responses: [
        { status: 200, description: 'Enforcement policies', schema: enforcementPolicyListResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid query parameters', schema: securityErrorSchema },
        { status: 401, description: 'Unauthorized', schema: securityErrorSchema },
      ],
    },
    POST: {
      summary: 'Create enforcement policy',
      requestBody: {
        contentType: 'application/json',
        schema: enforcementPolicySchema,
      },
      responses: [
        { status: 201, description: 'Policy created', schema: createEnforcementPolicyResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid payload', schema: securityErrorSchema },
        { status: 401, description: 'Unauthorized', schema: securityErrorSchema },
        { status: 409, description: 'Conflict', schema: securityErrorSchema },
      ],
    },
  },
})
