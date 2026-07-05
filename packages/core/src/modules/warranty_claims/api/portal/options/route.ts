import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { getCustomerAuthFromRequest, type CustomerAuthContext } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { loadWarrantyClaimDictionaryOptions } from '../../../lib/dictionaries'
import type { WarrantyClaimDictionaryKind } from '../../../data/constants'

type PortalOptionsContext = {
  auth: CustomerAuthContext
  tenantId: string
  organizationId: string
  container: Awaited<ReturnType<typeof createRequestContainer>>
}

type PortalOption = {
  value: string
  label: string
}

const querySchema = z.object({}).strict()

const optionSchema = z.object({
  value: z.string(),
  label: z.string(),
})

const responseSchema = z.object({
  ok: z.literal(true),
  result: z.object({
    reasons: z.array(optionSchema),
    faultCodes: z.array(optionSchema),
  }),
})

export const metadata = {
  GET: { requireAuth: false },
}

async function resolvePortalOptionsContext(req: Request): Promise<PortalOptionsContext | Response> {
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
    container,
  }
}

async function loadDictionaryOptions(
  em: EntityManager,
  context: PortalOptionsContext,
  kind: WarrantyClaimDictionaryKind,
): Promise<PortalOption[]> {
  try {
    return await loadWarrantyClaimDictionaryOptions(
      em,
      { tenantId: context.tenantId, organizationId: context.organizationId },
      kind,
    )
  } catch {
    return []
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    querySchema.parse(Object.fromEntries(url.searchParams))
    const contextOrResponse = await resolvePortalOptionsContext(req)
    if (contextOrResponse instanceof Response) return contextOrResponse
    const context = contextOrResponse
    const em = (context.container.resolve('em') as EntityManager).fork()
    const reasons = await loadDictionaryOptions(em, context, 'warranty-claim-reason')
    const faultCodes = await loadDictionaryOptions(em, context, 'warranty-claim-fault-code')
    return NextResponse.json({ ok: true, result: { reasons, faultCodes } })
  } catch (err) {
    const { translate } = await resolveTranslations()
    if (err instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: translate('warranty_claims.errors.invalidInput', 'Invalid input') }, { status: 400 })
    }
    console.error('warranty_claims.portal.options.get failed', err)
    return NextResponse.json({ ok: false, error: translate('warranty_claims.errors.load_failed', 'Failed to load warranty claim data') }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Warranty Claims Portal',
  summary: 'Customer portal warranty claim options',
  methods: {
    GET: {
      summary: 'List active customer portal warranty claim options',
      query: querySchema,
      responses: [
        {
          status: 200,
          description: 'Portal warranty claim options',
          schema: responseSchema,
        },
      ],
    },
  },
}
