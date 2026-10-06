import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { EcommerceStoreChannelBinding } from '../../../../data/entities'
import {
  countChannelAssortment,
  DRAFT_REQUIRE_AUTHENTICATION_PARAM,
  DRAFT_SCOPE_PARAM,
  parseAssortmentCountDraft,
} from '../../../../lib/assortmentCount'
import { resolveBrandingRouteContext, storeIdParamSchema } from '../../../../lib/storeBrandingRoute'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['ecommerce.stores.view'] },
}

const logger = createLogger('ecommerce').child({ component: 'assortment-count-route' })

type RouteParams = { params?: { id?: string } | Promise<{ id?: string }> }

export async function GET(req: Request, ctx: RouteParams) {
  try {
    const context = await resolveBrandingRouteContext(req)
    const { translate } = await resolveTranslations()
    const notFound = () =>
      NextResponse.json(
        {
          error: translate(
            'ecommerce.errors.channelBindingNotFound',
            'The selected channel binding does not exist in this organization.',
          ),
        },
        { status: 404 },
      )
    const params = await ctx.params
    const bindingId = storeIdParamSchema.safeParse(params?.id)
    if (!bindingId.success) return notFound()

    const em = (context.container.resolve('em') as EntityManager).fork()
    const binding = await findOneWithDecryption(
      em,
      EcommerceStoreChannelBinding,
      { id: bindingId.data, tenantId: context.tenantId, organizationId: context.organizationId, deletedAt: null },
      undefined,
      { tenantId: context.tenantId, organizationId: context.organizationId },
    )
    if (!binding) return notFound()

    const parsed = parseAssortmentCountDraft(new URL(req.url).searchParams, translate)
    if (!parsed.ok) {
      const [message] = Object.values(parsed.fieldErrors)
      return NextResponse.json({ error: message, fieldErrors: parsed.fieldErrors }, { status: 400 })
    }
    const { draft } = parsed

    const response = await countChannelAssortment(context.container, {
      tenantId: binding.tenantId,
      organizationId: binding.organizationId,
      channelAssortmentScope: draft.scope !== undefined ? draft.scope : (binding.assortmentScope ?? null),
      requireAuthentication: draft.requireAuthentication ?? binding.requireAuthentication,
      scopeSource: draft.scope !== undefined ? 'draft' : 'saved',
    })
    return NextResponse.json(response, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    logger.error('ecommerce.store-channel-bindings.assortment-count.GET failed', { err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const countResponseSchema = z.object({
  count: z
    .number()
    .int()
    .describe('Products an anonymous buyer sees on this channel. 0 while require_authentication is on.'),
  scopeSource: z
    .enum(['saved', 'draft'])
    .describe('draft when the count used the draftScope query parameter, saved when it used the stored assortment_scope.'),
  requireAuthentication: z
    .boolean()
    .describe('The require_authentication value the count used: draftRequireAuthentication when sent, otherwise the stored value.'),
  reducedByAuthentication: z
    .boolean()
    .describe('True when require_authentication brings the count to 0 although the scope matches products for a signed-in buyer.'),
  countWithoutAuthentication: z
    .number()
    .int()
    .describe('The count the same scope would give an anonymous buyer with require_authentication off.'),
  unindexedCount: z
    .number()
    .int()
    .describe('Active products with no scope index yet. They fail closed under a restricted scope, so they are excluded from count.'),
})

const errorSchema = z.object({ error: z.string() }).passthrough()

const fieldErrorsSchema = z.object({
  error: z.string(),
  fieldErrors: z.record(z.string(), z.string()),
})

const countQuerySchema = z.object({
  [DRAFT_SCOPE_PARAM]: z
    .string()
    .optional()
    .describe(
      'JSON-encoded assortment_scope for unsaved form state, validated like the channel binding write (allOf is rejected); null means unrestricted.',
    ),
  [DRAFT_REQUIRE_AUTHENTICATION_PARAM]: z
    .string()
    .optional()
    .describe('true or false: the unsaved require_authentication switch. Defaults to the stored value.'),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Ecommerce',
  summary: 'Channel binding assortment count',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: {
    GET: {
      summary: 'Count the products a channel binding shows an anonymous buyer',
      description:
        'Backs the live product count of the Channels tab. Counts the products the storefront would list for an anonymous buyer on this channel binding, using the stored assortment_scope or, when draftScope is given, the unsaved one. The effective assortment is the channel scope intersected with the default customer group scope and counted through the same scope query as the storefront listing. A binding that requires authentication counts 0 and reports reducedByAuthentication. Requires ecommerce.stores.view.',
      tags: ['Ecommerce'],
      query: countQuerySchema,
      responses: [{ status: 200, description: 'Product count', schema: countResponseSchema }],
      errors: [
        { status: 400, description: 'draftScope is not valid JSON or not a valid assortment scope, or draftRequireAuthentication is not a boolean', schema: fieldErrorsSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing ecommerce.stores.view', schema: errorSchema },
        { status: 404, description: 'The channel binding does not exist in the selected organization', schema: errorSchema },
      ],
    },
  },
}
