import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { E } from '#generated/entities.ids.generated'
import { Cart, CartLine } from '../../data/entities'
import { cartAdminListQuerySchema, type CartAdminListQuery } from '../../data/validators'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'

export { cartAdminListQuerySchema }

// Step 2.10 (K6, §10.2 rev 10) — the FIRST admin UI surface this module ships. Read-only:
// no `create`/`update`/`del` config at all, so `makeCrudRoute` answers every one of those
// methods with its own default `501` — the route-enumeration test
// (`__tests__/routeEnumeration.test.ts`) asserts this file exports neither a `POST` nor a
// `PATCH`/`PUT`/`DELETE` handler, closing §10.2's own "no admin route adds, updates or
// removes a line" guarantee at the HTTP layer, not just by convention.
//
// `kind` defaults to, and (via `cartAdminListQuerySchema`'s `z.literal('basket')`) can ONLY
// ever be, `'basket'` — the §7a proposal seam stays unreachable from this list exactly like
// every other `/current/*`/sweeper surface (K12's "pin the inert seam" posture) until Step
// 3.4 actually ships it. `email` is encrypted (`cart/encryption.ts`) and decrypted
// row-by-row through the query engine (`list.entityId` + `list.fields` below) — no
// free-text search on it; staff search by `customerId` instead (§10.2).

export const cartAdminListRouteMetadata = {
  GET: { requireAuth: true, requireFeatures: ['cart.carts.view'] },
}

const CART_ADMIN_LIST_FIELDS = [
  'id',
  'organization_id',
  'tenant_id',
  'kind',
  'status',
  'channel',
  'store_id',
  'customer_id',
  'customer_user_id',
  'email',
  'currency_code',
  'grand_total_gross_amount',
  'requires_approval',
  'awaiting_approval_since',
  'approval_id',
  'proposed_to_cart_id',
  'last_activity_at',
  'expires_at',
  'updated_at',
]

export const cartAdminListCrud = makeCrudRoute<never, never, CartAdminListQuery>({
  metadata: cartAdminListRouteMetadata,
  orm: {
    entity: Cart,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    // §9/§3.1a: a basket cart is never soft-deleted (no `deleted_at` column at all — only
    // the 90-day purge sweeper hard-deletes). `null` disables the implicit filter the
    // factory would otherwise apply against a column this entity does not have.
    softDeleteField: null,
  },
  indexer: { entityType: E.cart.cart },
  list: {
    schema: cartAdminListQuerySchema,
    // `email` is registered in `cart/encryption.ts` (`entityId: 'cart:cart'`) — the query
    // engine decrypts every listed row automatically when `entityId` is set, same
    // convention `customer_groups`' `credit-accounts/crud.ts` already uses for its own
    // encrypted `hold_reason` column.
    entityId: E.cart.cart,
    fields: CART_ADMIN_LIST_FIELDS,
    sortFieldMap: {
      lastActivityAt: 'last_activity_at',
      grandTotalGrossAmount: 'grand_total_gross_amount',
    },
    defaultSort: { field: 'lastActivityAt', dir: 'desc' },
    tiebreakSortField: 'id',
    buildFilters: (query) => {
      // §10.2: `kind` defaults to, and only ever accepts, `'basket'` — the schema's own
      // `z.literal('basket')` already 400s anything else before this ever runs, so the
      // filter itself is unconditional rather than a branch on `query.kind`.
      const filters: Record<string, unknown> = { kind: { $eq: 'basket' } }
      if (query.status) filters.status = { $eq: query.status }
      if (query.channel) filters.channel = { $eq: query.channel }
      if (query.storeId) filters.store_id = { $eq: query.storeId }
      if (query.customerId) filters.customer_id = { $eq: query.customerId }
      const requiresApproval = parseBooleanToken(query.requiresApproval)
      if (requiresApproval !== null) filters.requires_approval = { $eq: requiresApproval }
      if (query.lastActivityFrom || query.lastActivityTo) {
        const range: Record<string, string> = {}
        if (query.lastActivityFrom) range.$gte = query.lastActivityFrom
        if (query.lastActivityTo) range.$lte = query.lastActivityTo
        filters.last_activity_at = range
      }
      return filters
    },
  },
  hooks: {
    // §10.2's row shape names `lineCount` — not a stored column (`CartLine` rows are
    // counted, never denormalized onto `Cart`) — batched in ONE query across every row of
    // this page, mirroring `lib/cartView.ts#buildAppliedPromotionViews`'s own "never N+1"
    // discipline for a cross-table admin-list enrichment.
    afterList: async (res, ctx) => {
      const payload = res as { items?: Array<Record<string, unknown>> }
      const items = Array.isArray(payload.items) ? payload.items : []
      if (!items.length) return
      const cartIds = items
        .map((item) => (typeof item.id === 'string' ? item.id : null))
        .filter((id): id is string => !!id)
      if (!cartIds.length) return
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      const lines = await em.find(CartLine, { cartId: { $in: cartIds }, deletedAt: null })
      const countByCartId = new Map<string, number>()
      for (const line of lines) {
        countByCartId.set(line.cartId, (countByCartId.get(line.cartId) ?? 0) + 1)
      }
      for (const item of items) {
        const cartId = typeof item.id === 'string' ? item.id : null
        item.lineCount = cartId ? countByCartId.get(cartId) ?? 0 : 0
      }

      // FK-id + fetch-separately (never a direct ORM relation, AGENTS.md § Architecture) —
      // batched the same way as `lineCount` above, resolving the raw `customer_id` the list
      // otherwise shows verbatim into the display name admins actually need.
      const tenantId = ctx.auth?.tenantId ?? null
      const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
      if (!tenantId) return
      const readCustomerId = (item: Record<string, unknown>): string | null =>
        typeof item.customerId === 'string' ? item.customerId : (typeof item.customer_id === 'string' ? item.customer_id : null)
      const customerIds = items.map(readCustomerId).filter((id): id is string => !!id)
      if (!customerIds.length) return
      const customers = await findWithDecryption(
        em,
        CustomerEntity,
        {
          id: { $in: customerIds },
          tenantId,
          ...(organizationId ? { organizationId } : {}),
          deletedAt: null,
        },
        { fields: ['id', 'displayName', 'organizationId'] as const },
        { tenantId, organizationId },
      )
      const nameByCustomerId = new Map(customers.map((customer) => [customer.id, customer.displayName]))
      for (const item of items) {
        const customerId = readCustomerId(item)
        item.customerName = customerId ? nameByCustomerId.get(customerId) ?? null : null
      }
    },
  },
})

export const GET = cartAdminListCrud.GET

const cartAdminListRowSchema = z.object({
  id: z.string().uuid(),
  kind: z.literal('basket'),
  status: z.string(),
  channel: z.string(),
  store_id: z.string().uuid().nullable(),
  customer_id: z.string().uuid().nullable(),
  customer_user_id: z.string().uuid().nullable(),
  email: z.string().nullable(),
  currency_code: z.string(),
  grand_total_gross_amount: z.string().nullable(),
  requires_approval: z.boolean(),
  approval_id: z.string().uuid().nullable(),
  proposed_to_cart_id: z.string().uuid().nullable(),
  last_activity_at: z.string(),
  expires_at: z.string(),
  updated_at: z.string(),
  lineCount: z.number().optional(),
  customerName: z.string().nullable().optional(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Cart',
  summary: 'Admin cart list',
  methods: {
    GET: {
      summary: 'List baskets for staff inspection',
      description:
        'Read-only admin list (§10.2). `kind` only ever returns `basket` rows while the §7a proposal seam is deferred. `email` is decrypted through the query engine; there is no free-text search on it — filter by `customerId` instead.',
      query: cartAdminListQuerySchema,
      responses: [{ status: 200, description: 'Paged list of basket carts', schema: z.object({ items: z.array(cartAdminListRowSchema), total: z.number() }) }],
      errors: [{ status: 403, description: 'Missing cart.carts.view' }],
    },
  },
}
