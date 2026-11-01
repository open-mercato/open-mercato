import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError, badRequest } from '@open-mercato/shared/lib/crud/errors'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { E } from '#generated/entities.ids.generated'
import { CustomerCreditAccount } from '../../../data/entities'
import {
  customerCreditAccountCreateRequestSchema,
  customerCreditAccountUpdateSchema,
  type CustomerCreditAccountCreateRequest,
} from '../../../data/validators'
import { findCustomerInScope } from '../../../lib/customerScope'
import { clearCreateConflictRecheck, registerCreateConflictRecheck } from '../../../lib/createConflictRecheck'
import type { CustomerCreditService } from '../../../services/customerCreditService'

// Release 5 Phase 3 (Step 1.7). Admin-facing surface over the credit account Step 1.6
// already built — this route never recomputes exposure/the hold-limit invariant itself,
// it reads the account (decrypted via the query engine, `list.entityId` below) and, for
// a write, re-validates the SAME invariant `customerCreditAccountUpdateSchema` already
// encodes (`holdReason` required when `isOnHold = true`, spec §5.4) against the row's
// resulting state rather than the raw partial payload — see `applyToEntity` below.
//
// Create (Step 1.11, G13/D-R5-5): accounts are provisioned by an operator only, through
// `POST` below — nothing creates one lazily. No `del` config: Release 5 has no delete
// route (§9), so `makeCrudRoute` answers DELETE with `501` and `route.ts` does not export
// it. The ledger listing is its own `[id]/ledger` route; `/adjust` is Step 1.12's.
//
// Mirrors `../crud.ts` (`CustomerGroup`) and `memberships/crud.ts` exactly for the shared
// (non-route) module convention: `route.ts` delegates to this one `makeCrudRoute`
// instance, no `[id]` dynamic segment — the id travels in the query string (list/GET) or
// body (PUT), read by the factory itself.

const rawBodySchema = z.object({}).passthrough()
type RawCustomerCreditAccountInput = z.infer<typeof rawBodySchema>

export const customerCreditAccountListQuerySchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    id: z.string().uuid().optional(),
    customerId: z.string().uuid().optional(),
    currencyCode: z.string().trim().min(1).max(4).optional(),
    isOnHold: z.string().optional(),
    ids: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

export type CustomerCreditAccountListQuery = z.infer<typeof customerCreditAccountListQuerySchema>

export const customerCreditAccountRouteMetadata = {
  GET: { requireAuth: true, requireFeatures: ['customer_groups.credit.view'] },
  POST: { requireAuth: true, requireFeatures: ['customer_groups.credit.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['customer_groups.credit.manage'] },
}

function hasOwn(input: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, key)
}

// `updated_by_user_id` is an audit column, taken from the session, never the body — same
// rule as `assigned_by_user_id` in `memberships/crud.ts#actorUserIdFromContext`, kept as
// its own small module-local copy rather than an import across sibling CRUD files for
// two otherwise-unrelated resources.
const uuidSchema = z.string().uuid()
function actorUserIdFromContext(ctx: CrudCtx): string | null {
  const auth = ctx.auth
  if (!auth || auth.isApiKey) return null
  return uuidSchema.safeParse(auth.sub).success ? auth.sub : null
}

type Translate = (key: string, fallback?: string) => string

export const CREDIT_ACCOUNT_EXISTS_CODE = 'credit_account_exists'

function creditAccountExistsError(translate: Translate): CrudHttpError {
  return new CrudHttpError(409, {
    error: translate(
      'customer_groups.errors.credit_account_exists',
      'A credit account already exists for this customer and currency.',
    ),
    code: CREDIT_ACCOUNT_EXISTS_CODE,
  })
}

// The organization `makeCrudRoute` writes onto the new row (`orm.orgField`): the
// caller's selected organization, falling back to their home organization.
function createTargetOrganizationId(ctx: CrudCtx): string | null {
  return ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
}

// §5.4: the account's organization is the customer's organization. The factory always
// writes the caller's target organization, so the customer must live in exactly that
// organization — otherwise `checkCredit`, scoped by the cart's (= the customer's)
// organization, could never find the account. A customer outside it reads as "does not
// exist", the same 400 the membership routes answer, so nothing leaks across orgs.
async function assertCreditAccountCustomerInTargetOrganization(
  em: EntityManager,
  ctx: CrudCtx,
  customerId: string,
  translate: Translate,
): Promise<void> {
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = createTargetOrganizationId(ctx)
  const customer = tenantId && organizationId
    ? await findCustomerInScope(em, customerId, { tenantId, organizationIds: [organizationId] })
    : null
  if (customer) return
  throw badRequest(
    translate('customer_groups.errors.creditAccountCustomerNotFound', 'The selected customer does not exist in this organization.'),
  )
}

// The partial unique index (`tenant_id, organization_id, customer_id, currency_code`
// where `deleted_at is null`, Step 1.5) is the real guard; this pre-check turns the
// sequential duplicate into a translated `409 credit_account_exists`, and the
// `withCreateConflictRecheck` wrapper in `route.ts` re-runs it when a concurrent insert
// lost the race and the factory answered 500.
async function assertCreditAccountUnique(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  customerId: string,
  currencyCode: string,
  translate: Translate,
): Promise<void> {
  const existing = await em.count(CustomerCreditAccount, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    customerId,
    currencyCode,
    deletedAt: null,
  })
  if (existing > 0) throw creditAccountExistsError(translate)
}

export function toCustomerCreditAccountEntityData(
  input: CustomerCreditAccountCreateRequest,
  actorUserId: string | null,
): Record<string, unknown> {
  const isOnHold = input.isOnHold ?? false
  return {
    customerId: input.customerId,
    currencyCode: input.currencyCode,
    creditLimit: input.creditLimit.toFixed(2),
    isOnHold,
    holdReason: isOnHold ? input.holdReason ?? null : null,
    updatedByUserId: actorUserId,
  }
}

export function serializeCreatedCreditAccount(entity: CustomerCreditAccount) {
  return {
    id: entity.id,
    organizationId: entity.organizationId,
    customerId: entity.customerId,
    currencyCode: entity.currencyCode,
    creditLimit: entity.creditLimit,
    isOnHold: entity.isOnHold,
    updatedAt: entity.updatedAt instanceof Date ? entity.updatedAt.toISOString() : null,
  }
}

const customerCreditAccountListFields = [
  'id',
  'organization_id',
  'tenant_id',
  'customer_id',
  'currency_code',
  'credit_limit',
  'is_on_hold',
  'hold_reason',
  'updated_by_user_id',
  'created_at',
  'updated_at',
]

export const customerCreditAccountCrud = makeCrudRoute<
  CustomerCreditAccountCreateRequest,
  RawCustomerCreditAccountInput,
  CustomerCreditAccountListQuery
>({
  metadata: customerCreditAccountRouteMetadata,
  orm: {
    entity: CustomerCreditAccount,
    idField: 'id',
    // Unlike `CustomerGroup` (tenant-scoped only), the account is organization-scoped
    // (spec §5.4 header, G2) — the factory's default org filter/requirement handles
    // tenant+organization isolation generically, so no manual scope helper is needed
    // here (contrast `../crud.ts`'s `scopeFromContext`, required only because that
    // entity opts OUT of org scoping).
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.customer_groups.customer_credit_account },
  list: {
    schema: customerCreditAccountListQuerySchema,
    // `hold_reason` is registered in `../../../encryption.ts` — the query engine
    // decrypts every listed row automatically when `entityId` is set (G22).
    entityId: E.customer_groups.customer_credit_account,
    fields: customerCreditAccountListFields,
    sortFieldMap: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      creditLimit: 'credit_limit',
      currencyCode: 'currency_code',
    },
    buildFilters: (query) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = { $eq: query.id }
      if (query.customerId) filters.customer_id = { $eq: query.customerId }
      if (query.currencyCode) filters.currency_code = { $eq: query.currencyCode }
      const isOnHold = parseBooleanToken(query.isOnHold)
      if (isOnHold !== null) filters.is_on_hold = { $eq: isOnHold }
      return filters
    },
    // Exposure/available are never stored columns (§5.5: exposure is `SUM(amount)` over
    // the ledger, recomputed under the account's row lock on every write) — reusing the
    // service's money math here keeps this admin view consistent with Step 1.6 without
    // duplicating it (root AGENTS.md: reuse the service, don't fork its logic).
    // `transformItem` cannot do this (it is synchronous); `afterList` runs once per
    // request and can await the service per row. Uses `getAccountExposure` (the row's own
    // known `id`), never `checkCredit` (buyer/purchase-permission gated) — this is a
    // display read for an account that already exists, not a purchase-authorization
    // decision, so it must show the account's real exposure even when the group's
    // CURRENT terms disallow on-account purchasing (e.g. a historical account whose
    // group's terms later changed) rather than reporting `exposure: null`.
  },
  create: {
    schema: customerCreditAccountCreateRequestSchema,
    mapToEntity: (input, ctx) =>
      toCustomerCreditAccountEntityData(input, actorUserIdFromContext(ctx)),
    response: (entity) => serializeCreatedCreditAccount(entity as CustomerCreditAccount),
  },
  update: {
    schema: rawBodySchema,
    getId: (input) => (typeof input.id === 'string' ? input.id : ''),
    applyToEntity: async (entity, input, ctx) => {
      const account = entity as CustomerCreditAccount
      const raw = input as RawCustomerCreditAccountInput
      const { translate } = await resolveTranslations()

      // Scope and identity fields (organizationId/tenantId/customerId/currencyCode) are
      // never taken from the body — same rule as `applyCustomerGroupUpdate` in
      // `../crud.ts`: an account's identity is fixed at creation.
      const nextIsOnHold = hasOwn(raw, 'isOnHold') ? Boolean(raw.isOnHold) : account.isOnHold
      const nextHoldReason = hasOwn(raw, 'holdReason')
        ? (typeof raw.holdReason === 'string' && raw.holdReason.trim().length ? raw.holdReason.trim() : null)
        : account.holdReason ?? null
      const nextCreditLimit = hasOwn(raw, 'creditLimit') ? raw.creditLimit : account.creditLimit

      // Validate the MERGED resulting state, not the raw partial payload: a PUT that
      // only changes `creditLimit` must still be checked against the account's current
      // `isOnHold`/`holdReason`, and a PUT that only changes `holdReason` must not
      // bypass the "required when on hold" rule by simply omitting `isOnHold`.
      const parsed = customerCreditAccountUpdateSchema.safeParse({
        id: account.id,
        isOnHold: nextIsOnHold,
        holdReason: nextHoldReason,
        creditLimit: nextCreditLimit,
      })
      if (!parsed.success) {
        const holdReasonIssue = parsed.error.issues.some((issue) => issue.path.includes('holdReason'))
        throw badRequest(
          holdReasonIssue
            ? translate(
              'customer_groups.errors.creditHoldReasonRequired',
              'A hold reason is required when placing an account on hold.',
            )
            : translate('customer_groups.errors.invalid_input', 'Invalid input'),
        )
      }

      if (hasOwn(raw, 'creditLimit') && parsed.data.creditLimit !== undefined) {
        account.creditLimit = parsed.data.creditLimit.toFixed(2)
      }
      if (hasOwn(raw, 'isOnHold')) account.isOnHold = parsed.data.isOnHold ?? false
      if (hasOwn(raw, 'holdReason')) account.holdReason = parsed.data.holdReason ?? null
      account.updatedByUserId = actorUserIdFromContext(ctx)

      await (ctx.container.resolve('em') as EntityManager).flush()
    },
    response: () => ({ ok: true }),
  },
  hooks: {
    beforeCreate: async (parsed, ctx) => {
      const tenantId = ctx.auth?.tenantId ?? null
      const organizationId = createTargetOrganizationId(ctx)
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      const { translate } = await resolveTranslations()
      await assertCreditAccountCustomerInTargetOrganization(em, ctx, parsed.customerId, translate)
      if (!tenantId || !organizationId) return
      const scope = { tenantId, organizationId }
      await assertCreditAccountUnique(em, scope, parsed.customerId, parsed.currencyCode, translate)
      registerCreateConflictRecheck(ctx.request, () =>
        assertCreditAccountUnique(
          (ctx.container.resolve('em') as EntityManager).fork(),
          scope,
          parsed.customerId,
          parsed.currencyCode,
          translate,
        ),
      )
    },
    afterCreate: async (_entity, ctx) => {
      clearCreateConflictRecheck(ctx.request)
    },
    afterList: async (res, ctx) => {
      const payload = res as { items?: unknown[] }
      const items = Array.isArray(payload.items) ? payload.items : []
      if (!items.length) return
      const tenantId = ctx.auth?.tenantId ?? null
      if (!tenantId) return
      const creditService = ctx.container.resolve('customerCreditService') as CustomerCreditService
      for (const item of items) {
        const row = item as Record<string, unknown>
        const creditAccountId = typeof row.id === 'string' ? row.id : null
        const organizationId = typeof row.organization_id === 'string' ? row.organization_id : null
        if (!creditAccountId || !organizationId) continue
        const { exposure, available } = await creditService.getAccountExposure({
          creditAccountId,
          scope: { tenantId, organizationId },
        })
        row.exposure = exposure
        row.available = available
      }
    },
  },
})
