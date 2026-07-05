import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { getCustomerAuthFromRequest, type CustomerAuthContext } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { WarrantyTroubleshootingGuide } from '../../../data/entities'
import { claimTypeSchema } from '../../../data/validators'
import {
  parseGuideSteps,
  selectBestGuide,
  type TroubleshootingNode,
} from '../../../lib/troubleshooting'

const optionalReasonCodeSchema = z.preprocess((value) => {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed.length ? trimmed : undefined
}, z.string().max(120).optional())

const optionalClaimTypeSchema = z.preprocess((value) => {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed.length ? trimmed : undefined
}, claimTypeSchema.optional())

const querySchema = z
  .object({
    claimType: optionalClaimTypeSchema,
    reasonCode: optionalReasonCodeSchema,
  })
  .strict()

const troubleshootingStepsSchema = z.record(z.string(), z.unknown())

const responseSchema = z.object({
  guide: z.object({
    id: z.string().uuid(),
    title: z.string(),
    steps: troubleshootingStepsSchema,
  }).nullable(),
})

type PortalTroubleshootingContext = {
  auth: CustomerAuthContext
  tenantId: string
  organizationId: string
  em: EntityManager
}

type PortalTroubleshootingGuide = {
  id: string
  title: string
  claimType: string | null
  reasonCode: string | null
  isActive: boolean
  steps: TroubleshootingNode
}

export const metadata = {
  GET: { requireAuth: false },
}

async function resolvePortalContext(req: Request): Promise<PortalTroubleshootingContext | Response> {
  const auth = await getCustomerAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth) {
    return NextResponse.json({ ok: false, error: translate('warranty_claims.errors.unauthorized', 'Unauthorized') }, { status: 401 })
  }
  const container = await createRequestContainer()
  return {
    auth,
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    em: (container.resolve('em') as EntityManager).fork(),
  }
}

function serializeGuide(guide: WarrantyTroubleshootingGuide): PortalTroubleshootingGuide | null {
  const steps = parseGuideSteps(guide.steps)
  if (!steps) return null
  return {
    id: guide.id,
    title: guide.title,
    claimType: guide.claimType ?? null,
    reasonCode: guide.reasonCode ?? null,
    isActive: guide.isActive,
    steps,
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const query = querySchema.parse(Object.fromEntries(url.searchParams))
    const contextOrResponse = await resolvePortalContext(req)
    if (contextOrResponse instanceof Response) return contextOrResponse
    const context = contextOrResponse

    const guides = await context.em.find(
      WarrantyTroubleshootingGuide,
      {
        tenantId: context.tenantId,
        organizationId: context.organizationId,
        isActive: true,
        deletedAt: null,
      },
      {
        orderBy: { updatedAt: 'desc' },
        limit: 500,
      },
    )
    const candidates = guides
      .map(serializeGuide)
      .filter((guide): guide is PortalTroubleshootingGuide => guide !== null)
    const guide = selectBestGuide(candidates, query.claimType ?? null, query.reasonCode ?? null)

    return NextResponse.json({
      guide: guide ? { id: guide.id, title: guide.title, steps: guide.steps } : null,
    })
  } catch (err) {
    const { translate } = await resolveTranslations()
    if (err instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: translate('warranty_claims.errors.invalidInput', 'Invalid input') }, { status: 400 })
    }
    console.error('warranty_claims.portal.troubleshooting.get failed', err)
    return NextResponse.json({ ok: false, error: translate('warranty_claims.errors.load_failed', 'Failed to load warranty claim data') }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Warranty Claims Portal',
  summary: 'Customer portal warranty troubleshooting guide',
  methods: {
    GET: {
      summary: 'Load the best matching guided troubleshooting tree for portal claim intake',
      query: querySchema,
      responses: [
        {
          status: 200,
          description: 'Matching troubleshooting guide, if configured',
          schema: responseSchema,
        },
      ],
    },
  },
}
