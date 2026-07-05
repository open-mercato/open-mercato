import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { WarrantyClaimLine, WarrantyVendorPolicy } from '../../data/entities'
import { requireScopedClaim, type WarrantyClaimScope } from '../../commands/shared'
import { findVendorRecoveryMatches } from '../../lib/vendorPolicyRecovery'

const querySchema = z.object({
  claimId: z.string().uuid(),
}).strict()

const suggestionSchema = z.object({
  lineId: z.string().uuid(),
  vendorName: z.string(),
  policyId: z.string().uuid(),
  recoveryRatePct: z.string().nullable(),
  causalFault: z.string().nullable(),
  estimatedRecovery: z.string().nullable(),
})

const responseSchema = z.object({
  ok: z.literal(true),
  result: z.object({
    claimId: z.string().uuid(),
    suggestions: z.array(suggestionSchema),
  }),
})

type SuggestionsRouteContext = {
  tenantId: string
  organizationId: string
  scope: WarrantyClaimScope
  em: EntityManager
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['warranty_claims.claim.manage'] },
}

function toNullableString(value: number | string | null | undefined): string | null {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function toSuggestionVendorName(lineVendorName: string | null | undefined, policyVendorName: string): string {
  const normalized = lineVendorName?.trim()
  return normalized || policyVendorName
}

async function resolveSuggestionsContext(req: Request): Promise<SuggestionsRouteContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('warranty_claims.errors.unauthorized', 'Unauthorized') })
  }
  const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = organizationScope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, { error: translate('warranty_claims.errors.organization_required', 'Organization context is required') })
  }
  const em = container.resolve('em') as EntityManager
  return {
    tenantId: auth.tenantId,
    organizationId,
    scope: { tenantId: auth.tenantId, organizationId },
    em,
  }
}

export async function GET(req: Request) {
  try {
    const context = await resolveSuggestionsContext(req)
    const url = new URL(req.url)
    const query = querySchema.parse(Object.fromEntries(url.searchParams))
    const claim = await requireScopedClaim(context.em, query.claimId, context.scope)
    if (claim.claimType !== 'warranty' || (claim.status !== 'resolved' && claim.status !== 'closed')) {
      return NextResponse.json({ ok: true, result: { claimId: claim.id, suggestions: [] } })
    }

    const lines = await findWithDecryption(
      context.em,
      WarrantyClaimLine,
      {
        claim: claim.id,
        tenantId: context.tenantId,
        organizationId: context.organizationId,
        lineStatus: 'resolved',
        vendorClaimLineId: null,
        deletedAt: null,
      },
      { orderBy: { lineNo: 'ASC' } },
      context.scope,
    )
    const policies = await findWithDecryption(
      context.em,
      WarrantyVendorPolicy,
      {
        tenantId: context.tenantId,
        organizationId: context.organizationId,
        isActive: true,
        deletedAt: null,
      },
      { orderBy: { vendorName: 'ASC', updatedAt: 'DESC' } },
      context.scope,
    )
    const matches = findVendorRecoveryMatches({
      claim,
      lines,
      policies,
      requireWarrantyResolved: true,
    })
    const suggestions = matches.map((match) => ({
      lineId: match.line.id,
      vendorName: toSuggestionVendorName(match.line.vendorName, match.policy.vendorName),
      policyId: match.policy.id,
      recoveryRatePct: toNullableString(match.policy.recoveryRatePct),
      causalFault: match.causalFault,
      estimatedRecovery: match.estimatedRecovery,
    }))
    return NextResponse.json({ ok: true, result: { claimId: claim.id, suggestions } })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    const { translate } = await resolveTranslations()
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: translate('warranty_claims.errors.invalidInput', 'Invalid input') }, { status: 400 })
    }
    console.error('[internal] warranty_claims.vendor-recovery-suggestions.get failed', err)
    return NextResponse.json({ error: translate('warranty_claims.errors.load_failed', 'Failed to load warranty claim data') }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Warranty Claims',
  summary: 'List supplier recovery suggestions',
  methods: {
    GET: {
      summary: 'List resolved warranty claim lines eligible for supplier recovery',
      query: querySchema,
      responses: [
        {
          status: 200,
          description: 'Supplier recovery suggestions',
          schema: responseSchema,
        },
      ],
    },
  },
}
