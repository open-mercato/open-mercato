import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { FilterQuery } from '@mikro-orm/postgresql'
import { findAndCountWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { CheckoutLink } from '../../data/entities'
import { serializeLinkRecord } from '../../commands/links'
import {
  attachOperationMetadataHeader,
  buildCommandRuntimeContext,
  handleCheckoutRouteError,
  requireAdminContext,
} from '../helpers'
import { checkoutTag } from '../openapi'

export const metadata = {
  path: '/checkout/links',
  GET: { requireAuth: true, requireFeatures: ['checkout.view'] },
  POST: { requireAuth: true, requireFeatures: ['checkout.create'] },
}

export async function GET(req: Request) {
  try {
    const { auth, em } = await requireAdminContext(req)
    const url = new URL(req.url)
    const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'))
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize') ?? '25')))
    const search = (url.searchParams.get('search') ?? '').trim()
    const where: FilterQuery<CheckoutLink> = {
      organizationId: auth.orgId,
      tenantId: auth.tenantId,
      deletedAt: null,
    }
    const templateId = url.searchParams.get('templateId')
    const isLocked = url.searchParams.get('isLocked')
    const status = url.searchParams.get('status')
    const pricingMode = url.searchParams.get('pricingMode')
    if (search) {
      where.$or = [
        { name: { $ilike: `%${escapeLikePattern(search)}%` } },
        { title: { $ilike: `%${escapeLikePattern(search)}%` } },
        { slug: { $ilike: `%${escapeLikePattern(search)}%` } },
      ]
    }
    if (templateId) where.templateId = templateId
    if (status === 'draft' || status === 'active' || status === 'inactive') where.status = status
    if (isLocked === 'true' || isLocked === 'false') where.isLocked = isLocked === 'true'
    if (pricingMode === 'fixed' || pricingMode === 'custom_amount' || pricingMode === 'price_list') where.pricingMode = pricingMode
    const [items, total] = await findAndCountWithDecryption(
      em,
      CheckoutLink,
      where,
      {
        orderBy: { createdAt: 'desc', id: 'desc' },
        offset: (page - 1) * pageSize,
        limit: pageSize,
      },
      { organizationId: auth.orgId, tenantId: auth.tenantId },
    )
    return NextResponse.json({
      items: items.map((item) => serializeLinkRecord(item)),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    })
  } catch (error) {
    return handleCheckoutRouteError(error)
  }
}

export async function POST(req: Request) {
  try {
    const { auth, container, commandBus } = await requireAdminContext(req)
    const body = await req.json().catch(() => ({}))
    const { result, logEntry } = await commandBus.execute<Record<string, unknown>, { id: string; slug: string }>('checkout.link.create', {
      input: body,
      ctx: buildCommandRuntimeContext(req, container, auth),
    })
    return attachOperationMetadataHeader(
      NextResponse.json(result, { status: 201 }),
      logEntry,
      { resourceKind: 'checkout.link', resourceId: result.id },
    )
  } catch (error) {
    return handleCheckoutRouteError(error)
  }
}

const linkResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  title: z.string().nullable(),
  subtitle: z.string().nullable(),
  description: z.string().nullable(),
  logoAttachmentId: z.string().nullable(),
  logoUrl: z.string().nullable(),
  logoPreviewUrl: z.string().nullable(),
  primaryColor: z.string().nullable(),
  secondaryColor: z.string().nullable(),
  backgroundColor: z.string().nullable(),
  themeMode: z.enum(['light', 'dark', 'auto']),
  pricingMode: z.enum(['fixed', 'custom_amount', 'price_list']),
  fixedPriceAmount: z.number().nullable(),
  fixedPriceAmountExact: z.string().nullable(),
  fixedPriceCurrencyCode: z.string().nullable(),
  fixedPriceIncludesTax: z.boolean(),
  fixedPriceOriginalAmount: z.number().nullable(),
  fixedPriceOriginalAmountExact: z.string().nullable(),
  customAmountMin: z.number().nullable(),
  customAmountMinExact: z.string().nullable(),
  customAmountMax: z.number().nullable(),
  customAmountMaxExact: z.string().nullable(),
  customAmountCurrencyCode: z.string().nullable(),
  priceListItems: z.array(z.object({
    id: z.string(),
    description: z.string(),
    amount: z.number(),
    amountExact: z.string().nullable().optional(),
    currencyCode: z.string(),
  })),
  gatewayProviderKey: z.string().nullable(),
  gatewaySettings: z.record(z.string(), z.unknown()),
  customFieldsetCode: z.string().nullable(),
  collectCustomerDetails: z.boolean(),
  customerFieldsSchema: z.array(z.record(z.string(), z.unknown())),
  legalDocuments: z.record(z.string(), z.unknown()),
  displayCustomFieldsOnPage: z.boolean(),
  successTitle: z.string().nullable(),
  successMessage: z.string().nullable(),
  cancelTitle: z.string().nullable(),
  cancelMessage: z.string().nullable(),
  errorTitle: z.string().nullable(),
  errorMessage: z.string().nullable(),
  successEmailSubject: z.string().nullable(),
  successEmailBody: z.string().nullable(),
  sendSuccessEmail: z.boolean(),
  errorEmailSubject: z.string().nullable(),
  errorEmailBody: z.string().nullable(),
  sendErrorEmail: z.boolean(),
  startEmailSubject: z.string().nullable(),
  startEmailBody: z.string().nullable(),
  sendStartEmail: z.boolean(),
  maxCompletions: z.number().nullable(),
  status: z.enum(['draft', 'active', 'inactive']),
  checkoutType: z.enum(['pay_link', 'simple_checkout']),
  createdAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime().nullable(),
  slug: z.string(),
  templateId: z.string().uuid().nullable(),
  completionCount: z.number(),
  activeReservationCount: z.number(),
  isLocked: z.boolean(),
})

export const openApi = {
  tags: [checkoutTag],
  methods: {
    GET: {
      summary: 'List checkout links',
      responses: [{
        status: 200,
        description: 'Paginated checkout links',
        schema: z.object({
          items: z.array(linkResponseSchema),
          total: z.number(),
          page: z.number(),
          pageSize: z.number(),
          totalPages: z.number(),
        }),
      }],
    },
    POST: {
      summary: 'Create a checkout link',
      responses: [{
        status: 201,
        description: 'Created checkout link',
        schema: z.object({ id: z.string().uuid(), slug: z.string() }),
      }],
    },
  },
}

export default { GET, POST }
