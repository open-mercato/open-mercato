import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { withScopedPayload } from '@open-mercato/shared/lib/api/scoped'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { buildClaimReplyDraft, isWarrantyAiNotConfiguredError, isWarrantyAiUnavailableError } from '../../../lib/aiAssist'

const draftReplySchema = z
  .object({
    claimId: z.string().uuid(),
    tone: z.enum(['formal', 'friendly', 'concise']).optional(),
    organizationId: z.string().uuid().optional(),
    tenantId: z.string().uuid().optional(),
  })
  .strict()

type DraftReplyInput = z.infer<typeof draftReplySchema>

type DraftReplyRouteContext = {
  ctx: CommandRuntimeContext
  tenantId: string
  organizationId: string
  container: AwilixContainer
  em: EntityManager
  translate: (key: string, fallback?: string) => string
}

const successResponseSchema = z.object({
  ok: z.literal(true),
  draft: z.string(),
})

const notConfiguredResponseSchema = z.object({
  ok: z.literal(false),
  notConfigured: z.literal(true),
  error: z.string(),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['warranty_claims.claim.manage'] },
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

async function resolveDraftReplyContext(req: Request): Promise<DraftReplyRouteContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('warranty_claims.errors.unauthorized', 'Unauthorized') })
  }
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = scope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, { error: translate('warranty_claims.errors.organization_required', 'Organization context is required') })
  }

  const ctx: CommandRuntimeContext = {
    container,
    auth,
    organizationScope: scope,
    selectedOrganizationId: organizationId,
    organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
    request: req,
  }

  return {
    ctx,
    tenantId: auth.tenantId,
    organizationId,
    container,
    em: container.resolve<EntityManager>('em').fork(),
    translate,
  }
}

export async function POST(req: Request) {
  try {
    const context = await resolveDraftReplyContext(req)
    const payload = toRecord(await readJsonSafe(req, {}))
    const input: DraftReplyInput = draftReplySchema.parse(withScopedPayload(payload, context.ctx, context.translate))
    const { draft } = await buildClaimReplyDraft({
      em: context.em,
      container: context.container,
      scope: { tenantId: context.tenantId, organizationId: context.organizationId },
      claimId: input.claimId,
      tone: input.tone,
    })
    return NextResponse.json({ ok: true, draft })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    const { translate } = await resolveTranslations()
    if (isWarrantyAiUnavailableError(err)) {
      const { translate } = await resolveTranslations()
      return NextResponse.json(
        { ok: false, aiUnavailable: true, error: translate('warranty_claims.errors.aiUnavailable', 'AI drafting is temporarily unavailable') },
        { status: 502 },
      )
    }
    if (isWarrantyAiNotConfiguredError(err)) {
      return NextResponse.json({
        ok: false,
        notConfigured: true,
        error: translate('warranty_claims.errors.aiNotConfigured', 'AI drafting is not configured for this workspace'),
      }, { status: 422 })
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: translate('warranty_claims.errors.invalidInput', 'Invalid input') }, { status: 400 })
    }
    console.error('warranty_claims.ai.draft-reply.post failed', err)
    return NextResponse.json({ error: translate('warranty_claims.errors.save_failed', 'Failed to save warranty claim') }, { status: 400 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Warranty Claims',
  summary: 'Draft warranty claim customer reply',
  methods: {
    POST: {
      summary: 'Generate an AI-assisted customer reply draft for operator review',
      requestBody: { contentType: 'application/json', schema: draftReplySchema },
      responses: [
        {
          status: 200,
          description: 'Customer reply draft generated',
          schema: successResponseSchema,
        },
        {
          status: 422,
          description: 'AI drafting is not configured',
          schema: notConfiguredResponseSchema,
        },
      ],
    },
  },
}
