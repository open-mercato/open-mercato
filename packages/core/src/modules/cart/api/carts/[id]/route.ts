import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { FilterQuery } from '@mikro-orm/core'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { Cart, CartMergeLog } from '../../../data/entities'
import { buildCartResponseEnvelope } from '../../../lib/cartView'
import { organizationIdsFromCartScope, tryResolveCustomerPurchaseApprovalService } from '../../../lib/adminCartScope'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'

// Step 2.10 (K6, §10.2 rev 10) — `GET /api/cart/carts/:id`. Read-only: no `PATCH`/`PUT`/
// `DELETE` export at all (the route-enumeration test asserts this). Reuses
// `buildCartResponseEnvelope` (§10.1) for the lines/totals/warnings portion shared with
// every `/current/*` response, then layers the admin-only fields §10.2 names on top
// (`kind`/`channel`/`storeId`/`customerId`/`customerUserId`, decrypted `email`/`note`, the
// LIVE approval via `customerPurchaseApprovalService.getApproval`, and the cart's
// `CartMergeLog` entries) — none of which the buyer-facing envelope carries.

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['cart.carts.view'] },
}

const paramsSchema = z.object({ id: z.string().uuid() })

type RouteContext = { params: Promise<{ id: string }> | { id: string } }

const logger = createLogger('cart').child({ component: 'admin-cart-detail' })

export async function GET(req: Request, context: RouteContext) {
  const { translate } = await resolveTranslations()
  const cartNotFound = () =>
    new CrudHttpError(404, { error: translate('cart.admin.errors.cartNotFound', 'Cart not found.') })
  try {
    const params = paramsSchema.safeParse(await context.params)
    if (!params.success) throw cartNotFound()

    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    if (!auth) {
      throw new CrudHttpError(401, { error: translate('cart.admin.errors.unauthorized', 'Unauthorized') })
    }
    const tenantId = auth.tenantId ?? null
    if (!tenantId) {
      throw new CrudHttpError(400, { error: translate('cart.admin.errors.tenantRequired', 'Tenant context is required.') })
    }

    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req }).catch(() => null)
    const organizationIds = organizationIdsFromCartScope(scope, scope?.selectedId ?? auth.orgId ?? null)
    if (Array.isArray(organizationIds) && organizationIds.length === 0) throw cartNotFound()

    const em = (container.resolve('em') as EntityManager).fork()
    // §10.2's own `kind = 'basket'` posture (K12/X5): the admin detail stays unreachable
    // for a proposal cart too, matching the list route, until Step 3.4 ships the seam.
    const where: Record<string, unknown> = {
      id: params.data.id,
      tenantId,
      kind: 'basket' as const,
    }
    if (organizationIds) where.organizationId = { $in: organizationIds }
    const cart = await findOneWithDecryption(em, Cart, where as FilterQuery<Cart>, {}, { tenantId })
    if (!cart) throw cartNotFound()
    const cartScope = { tenantId: cart.tenantId, organizationId: cart.organizationId }

    const envelope = await buildCartResponseEnvelope({
      container,
      cartId: cart.id,
      tenantId: cart.tenantId,
      organizationId: cart.organizationId,
    })

    const approvalService = tryResolveCustomerPurchaseApprovalService(container)
    const approval = cart.approvalId && approvalService
      ? await approvalService.getApproval({ scope: cartScope, approvalId: cart.approvalId })
      : null

    const mergeLogs = (await findWithDecryption(
      em,
      CartMergeLog,
      { tenantId: cart.tenantId, organizationId: cart.organizationId, $or: [{ sourceCartId: cart.id }, { targetCartId: cart.id }] },
      {},
      cartScope,
    )) as CartMergeLog[]
    const mergeLogEntries = mergeLogs.map((log) => ({
      id: log.id,
      strategy: log.strategy,
      createdAt: log.createdAt,
      mergedByActorType: log.mergedByActorType,
      proposalCartId: log.proposalCartId ?? null,
    }))

    // FK-id + fetch-separately (never a direct ORM relation, AGENTS.md § Architecture) —
    // the admin detail otherwise shows the raw `customer_id` verbatim. `displayName` is
    // encrypted (customers:customer_entity), so this MUST go through findOneWithDecryption
    // and stay scoped to the cart's own organization, not just its tenant.
    const customer = cart.customerId
      ? await findOneWithDecryption(
          em,
          CustomerEntity,
          { id: cart.customerId, tenantId: cart.tenantId, organizationId: cart.organizationId, deletedAt: null },
          { fields: ['id', 'displayName', 'organizationId'] as const },
          { tenantId: cart.tenantId, organizationId: cart.organizationId },
        )
      : null

    return NextResponse.json({
      cart: {
        ...envelope.cart,
        id: cart.id,
        kind: cart.kind,
        channel: cart.channel,
        storeId: cart.storeId ?? null,
        customerId: cart.customerId ?? null,
        customerName: customer?.displayName ?? null,
        customerUserId: cart.customerUserId ?? null,
        email: cart.email ?? null,
        note: cart.note ?? null,
        proposedToCartId: cart.proposedToCartId ?? null,
      },
      approval,
      mergeLogEntries,
      warnings: envelope.warnings,
    })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    logger.error('admin cart detail failed', { err })
    getTelemetryRuntime()?.reportError(err, { module: 'cart', code: 'cart.admin_detail_failed' })
    return NextResponse.json(
      { error: translate('cart.admin.errors.detailFailed', 'Failed to load the cart.') },
      { status: 500 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Cart',
  summary: 'Admin cart detail',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: {
    GET: {
      summary: 'Read one basket cart with lines, warnings, live approval and merge log',
      description:
        'Read-only admin detail (§10.2). `approval` is read live through customer_groups’ approval service when registered, `null` otherwise. `email`/`note` are decrypted.',
      responses: [{ status: 200, description: 'The cart with admin-only fields' }],
      errors: [
        { status: 401, description: 'Unauthorized' },
        { status: 404, description: 'Unknown cart, a different organization, or a proposal cart' },
      ],
    },
  },
}
