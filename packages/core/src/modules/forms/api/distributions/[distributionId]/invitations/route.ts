import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { FormDistribution, FormInvitation } from '../../../../data/entities'
import {
  invitationCreateCommandSchema,
  type FormInvitationCreateCommandInput,
} from '../../../../data/validators'
import {
  attachOperationMetadata,
  buildFormsRouteContext,
  handleRouteError,
  jsonError,
  withMutationGuard,
  withScopedPayload,
} from '../../../helpers'
import { FORM_INVITATION_RESOURCE_KIND } from '../../../../commands/invitation'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['forms.distribute'] },
  POST: { requireAuth: true, requireFeatures: ['forms.distribute'] },
}

const invitationItemSchema = z.object({
  id: z.string().uuid(),
  recipientEmail: z.string().nullable(),
  recipientName: z.string().nullable(),
  recipientRef: z.string().nullable(),
  role: z.string().nullable(),
  status: z.enum(['pending', 'sent', 'opened', 'started', 'submitted', 'expired', 'revoked']),
  locale: z.string().nullable(),
  sentAt: z.string().nullable(),
  openedAt: z.string().nullable(),
  startedAt: z.string().nullable(),
  submittedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  sendCount: z.number().int(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
})

const listResponseSchema = z.object({
  items: z.array(invitationItemSchema),
  total: z.number().int(),
})

const createdInvitationSchema = z.object({
  id: z.string().uuid(),
  rawToken: z.string().nullable(),
})

const createResponseSchema = z.object({
  invitations: z.array(createdInvitationSchema),
})

const errorSchema = z.object({ error: z.string() })

const requestBodySchema = invitationCreateCommandSchema.omit({
  tenantId: true,
  organizationId: true,
  distributionId: true,
})

function extractDistributionId(req: Request): string {
  const url = new URL(req.url)
  const segments = url.pathname.split('/').filter(Boolean)
  const idx = segments.findIndex((segment) => segment === 'distributions')
  return idx >= 0 ? segments[idx + 1] ?? '' : ''
}

async function ensureDistribution(
  em: EntityManager,
  distributionId: string,
  tenantId: string,
  organizationId: string,
): Promise<FormDistribution> {
  const distribution = await em.findOne(FormDistribution, {
    id: distributionId,
    tenantId,
    organizationId,
    deletedAt: null,
  })
  if (!distribution) {
    throw new CrudHttpError(404, { error: 'forms.errors.distribution_not_found' })
  }
  return distribution
}

export async function GET(req: Request) {
  try {
    const { ctx, organizationId, tenantId } = await buildFormsRouteContext(req)
    if (!organizationId || !tenantId) {
      return jsonError(400, 'forms.errors.organization_required')
    }
    const distributionId = extractDistributionId(req)
    if (!distributionId) return jsonError(400, 'forms.errors.invalid_id')

    const em = ctx.container.resolve('em') as EntityManager
    await ensureDistribution(em, distributionId, tenantId, organizationId)

    const invitations = await findWithDecryption(
      em,
      FormInvitation,
      { distributionId, tenantId, organizationId, deletedAt: null },
      { orderBy: { createdAt: 'desc' } },
      { tenantId, organizationId },
    )

    const items = invitations.map((invitation) => ({
      id: invitation.id,
      recipientEmail: invitation.recipientEmail ?? null,
      recipientName: invitation.recipientName ?? null,
      recipientRef: invitation.recipientRef ?? null,
      role: invitation.role ?? null,
      status: invitation.status,
      locale: invitation.locale ?? null,
      sentAt: invitation.sentAt ? invitation.sentAt.toISOString() : null,
      openedAt: invitation.openedAt ? invitation.openedAt.toISOString() : null,
      startedAt: invitation.startedAt ? invitation.startedAt.toISOString() : null,
      submittedAt: invitation.submittedAt ? invitation.submittedAt.toISOString() : null,
      expiresAt: invitation.expiresAt ? invitation.expiresAt.toISOString() : null,
      sendCount: invitation.sendCount,
      lastError: invitation.lastError ?? null,
      createdAt: invitation.createdAt.toISOString(),
    }))

    return NextResponse.json({ items, total: items.length })
  } catch (error) {
    return handleRouteError('invitations.GET', error)
  }
}

export async function POST(req: Request) {
  try {
    const { ctx, organizationId, tenantId, translate } = await buildFormsRouteContext(req)
    if (!organizationId || !tenantId) {
      return jsonError(400, 'forms.errors.organization_required')
    }
    const distributionId = extractDistributionId(req)
    if (!distributionId) return jsonError(400, 'forms.errors.invalid_id')

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const parsedBody = requestBodySchema.parse(body)
    const scoped = withScopedPayload({ ...parsedBody, distributionId }, ctx, translate)
    const input = invitationCreateCommandSchema.parse(scoped) satisfies FormInvitationCreateCommandInput

    return await withMutationGuard({
      ctx,
      tenantId,
      organizationId,
      resourceKind: FORM_INVITATION_RESOURCE_KIND,
      resourceId: distributionId,
      operation: 'create',
      request: req,
      payload: { distributionId, recipientCount: input.recipients.length },
      run: async () => {
        const commandBus = ctx.container.resolve('commandBus') as CommandBus
        const { result, logEntry } = await commandBus.execute<
          FormInvitationCreateCommandInput,
          { invitations: Array<{ id: string; rawToken: string | null }> }
        >('forms.invitation.create', { input, ctx })
        const response = NextResponse.json(
          { invitations: result?.invitations ?? [] },
          { status: 201 },
        )
        return attachOperationMetadata(response, logEntry, FORM_INVITATION_RESOURCE_KIND, distributionId)
      },
    })
  } catch (error) {
    return handleRouteError('invitations.POST', error)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Forms',
  summary: 'Manage distribution invitations',
  pathParams: z.object({ distributionId: z.string().uuid() }),
  methods: {
    GET: {
      summary: 'List invitations',
      description: 'Returns invitations for a distribution with recipient PII decrypted. Token hashes are never returned.',
      responses: [{ status: 200, description: 'Invitation list', schema: listResponseSchema }],
      errors: [{ status: 404, description: 'Distribution not found', schema: errorSchema }],
    },
    POST: {
      summary: 'Bulk-create invitations',
      description:
        'Creates one invitation per recipient. For personal distributions, the response returns each invitation rawToken exactly once so the admin can build the personal link.',
      requestBody: { contentType: 'application/json', schema: requestBodySchema },
      responses: [{ status: 201, description: 'Invitations created', schema: createResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid payload', schema: errorSchema },
        { status: 404, description: 'Distribution not found', schema: errorSchema },
      ],
    },
  },
}
