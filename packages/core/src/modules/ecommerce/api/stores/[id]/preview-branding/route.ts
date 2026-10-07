import { NextResponse } from 'next/server'
import { z } from 'zod'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { ecommerceStoreBrandingSchema } from '../../../../data/validators'
import {
  buildBrandingDeclarations,
  renderBrandingRootRule,
  renderBrandingStyleBlock,
} from '../../../../lib/brandingStyles'
import { parseBrandingInput } from '../../../../lib/storeBranding'
import { ecommerceInternalErrorBody } from '../../../../lib/crudSupport'
import {
  BRANDING_MANAGE_FEATURE,
  requireScopedStore,
  resolveBrandingRouteContext,
  storeIdParamSchema,
} from '../../../../lib/storeBrandingRoute'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: [BRANDING_MANAGE_FEATURE] },
}

const logger = createLogger('ecommerce').child({ component: 'store-branding-preview-route' })

type RouteParams = { params?: { id?: string } | Promise<{ id?: string }> }

function readQueryValues(url: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const [key, value] of new URL(url).searchParams.entries()) values[key] = value
  return values
}

export async function GET(req: Request, ctx: RouteParams) {
  try {
    const context = await resolveBrandingRouteContext(req)
    const { translate } = await resolveTranslations()
    const params = await ctx.params
    const storeId = storeIdParamSchema.safeParse(params?.id)
    if (!storeId.success) {
      return NextResponse.json(
        { error: translate('ecommerce.errors.storeNotFound', 'The selected store does not exist in this organization.') },
        { status: 404 },
      )
    }
    await requireScopedStore(context, storeId.data)

    const parsed = parseBrandingInput(readQueryValues(req.url), translate)
    if (!parsed.ok) {
      const [message] = Object.values(parsed.fieldErrors)
      return NextResponse.json({ error: message, fieldErrors: parsed.fieldErrors }, { status: 400 })
    }

    return NextResponse.json(
      {
        css: renderBrandingRootRule(parsed.branding),
        styleBlock: renderBrandingStyleBlock(parsed.branding),
        declarations: buildBrandingDeclarations(parsed.branding),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    logger.error('ecommerce.stores.preview-branding.GET failed', { err })
    return NextResponse.json(await ecommerceInternalErrorBody(), { status: 500 })
  }
}

const previewResponseSchema = z.object({
  css: z.string().describe('The :root rule that the storefront emits for these values.'),
  styleBlock: z.string().describe('The same rule wrapped in the style element the storefront server-renders.'),
  declarations: z.array(z.object({ property: z.string(), value: z.string() })),
})

const errorSchema = z.object({ error: z.string() }).passthrough()

export const openApi: OpenApiRouteDoc = {
  tag: 'Ecommerce',
  summary: 'Store branding preview',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: {
    GET: {
      summary: 'Preview the stylesheet for candidate branding values',
      description:
        'Validates the candidate branding values passed as query parameters with the same rules as the save route and returns the CSS the storefront would emit. Nothing is persisted. Requires ecommerce.branding.manage.',
      tags: ['Ecommerce'],
      query: ecommerceStoreBrandingSchema,
      responses: [{ status: 200, description: 'Rendered branding stylesheet', schema: previewResponseSchema }],
      errors: [
        { status: 400, description: 'A branding value is invalid', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing ecommerce.branding.manage', schema: errorSchema },
        { status: 404, description: 'The store does not exist in the selected organization', schema: errorSchema },
      ],
    },
  },
}
