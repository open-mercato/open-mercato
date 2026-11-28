import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveSingleOrganizationIdOrDeny } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import type { OrganizationHierarchyService } from '@open-mercato/shared/lib/auth/principal-service'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, forbidden, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { documentNumberRequestSchema, type DocumentNumberRequestInput } from '../../data/validators'
import { withScopedPayload } from '../utils'
import type { SalesDocumentNumberGenerator } from '../../services/salesDocumentNumberGenerator'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('sales')

export const metadata = {
  POST: { requireAuth: true },
}

type RequestContext = {
  ctx: CommandRuntimeContext
  translate: (key: string, fallback?: string) => string
}

async function resolveRequestContext(req: Request): Promise<RequestContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()

  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('sales.documents.errors.unauthorized', 'Unauthorized') })
  }

  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = resolveSingleOrganizationIdOrDeny(scope, auth) ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, {
      error: translate('sales.documents.errors.organization_required', 'Organization context is required'),
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

  return { ctx, translate }
}

async function ensureKindPermission(
  ctx: CommandRuntimeContext,
  { kind, organizationId, tenantId }: DocumentNumberRequestInput,
  translate: (key: string, fallback?: string) => string
) {
  const rbac = ctx.container.resolve<RbacService | null>('rbacService')
  const auth = ctx.auth
  const kindFeatureMap: Record<DocumentNumberRequestInput['kind'], string> = {
    order: 'sales.orders.manage',
    quote: 'sales.quotes.manage',
    invoice: 'sales.invoices.manage',
    credit_memo: 'sales.credit_memos.manage',
  }
  const requiredFeatures = [
    kindFeatureMap[kind],
    'sales.documents.number.edit',
  ]
  const ok = rbac && auth?.sub && await rbac.userHasAllFeatures(auth.sub, requiredFeatures, { tenantId, organizationId })
  if (!ok) {
    throw new CrudHttpError(403, {
      error: translate('sales.documents.errors.number_forbidden', 'You cannot generate document numbers.'),
    })
  }
}

export async function POST(req: Request) {
  try {
    const { ctx, translate } = await resolveRequestContext(req)
    const payload = await readJsonSafe<Record<string, unknown>>(req, {})
    const scoped = withScopedPayload(payload, ctx, translate)
    const input = documentNumberRequestSchema.parse(scoped)
    const hierarchy = ctx.container.resolve<OrganizationHierarchyService>('organizationHierarchyService')
    const organization = await hierarchy.resolveAncestorIds({
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    })
    if (organization === null) throw forbidden()
    await ensureKindPermission(ctx, input, translate)

    const generator = ctx.container.resolve('salesDocumentNumberGenerator') as SalesDocumentNumberGenerator
    const result = await generator.generate({
      kind: input.kind,
      organizationId: input.organizationId,
      tenantId: input.tenantId,
      format: input.format,
    })

    return NextResponse.json({
      number: result.number,
      format: result.format,
      sequence: result.sequence,
    })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    logger.error('sales.document-numbers.generate failed', { err })
    return NextResponse.json(
      { error: translate('sales.documents.errors.number_generate_failed', 'Failed to generate document number.') },
      { status: 400 }
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Sales',
  summary: 'Generate sales document number',
  methods: {
    POST: {
      summary: 'Generate next number',
      description: 'Generates the next sales order or quote number using configured formatting rules.',
      requestBody: {
        contentType: 'application/json',
        schema: documentNumberRequestSchema,
      },
      responses: [
        {
          status: 200,
          description: 'Generated number',
          schema: z.object({
            number: z.string(),
            format: z.string(),
            sequence: z.number(),
          }),
        },
        { status: 400, description: 'Invalid input or scope missing', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Target scope or permission denied', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
