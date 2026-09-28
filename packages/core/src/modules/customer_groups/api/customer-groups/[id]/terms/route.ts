import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { CrudHttpError, isCrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { CustomerGroup, CustomerGroupTerms } from '../../../../data/entities'
import {
  customerGroupTermsCreateSchema,
  customerGroupTermsUpdateSchema,
  type CustomerGroupTermsCreateInput,
  type CustomerGroupTermsUpdateInput,
} from '../../../../data/validators'

const logger = createLogger('customer_groups')

// Terms are a strict 1:1 sub-resource of a group (`customer_group_terms_group_unique`
// is a partial unique index on `group_id`, see `data/entities.ts`) with no independent
// list/pagination/search use case — there is no "list all terms rows" screen, only
// "this group's terms". The spec's own literal path (`GET/PUT
// /api/customer-groups/:id/terms`) nests terms under a specific group, unlike
// `../crud.ts` / `memberships/crud.ts`, which are genuine tenant-wide collections with
// their own list/filter semantics. A `[id]` dynamic segment (id = the GROUP's id) doing
// a plain `findOne`/upsert against `CustomerGroupTerms` is therefore the better fit here
// than a `makeCrudRoute` keyed by `groupId` (Option A from the Step 2.4 task) — the
// latter would need to invent list/create/delete semantics this resource never uses,
// and `makeCrudRoute`'s auto-registered optimistic-lock reader is keyed by the route's
// own resourceKind, not a caller-chosen `groupId` lookup, so it would not save any
// wiring over the explicit `enforceCommandOptimisticLock` call used below anyway.
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customer_groups.terms.view'] },
  PUT: { requireAuth: true, requireFeatures: ['customer_groups.terms.manage'] },
}

// Matches the indexer entityType naming convention already used for the other two
// entities in this module (`customer_groups:customer_group`,
// `customer_groups:customer_group_membership` in `../crud.ts` /
// `memberships/crud.ts`), so `OM_OPTIMISTIC_LOCK`'s allow-list mode can target this
// resource by the same family of names.
const TERMS_RESOURCE_KIND = 'customer_groups:customer_group_terms'

const paramsSchema = z.object({ id: z.string().uuid() })

type RouteContext = { params: Promise<{ id: string }> | { id: string } }

type Scope = { tenantId: string; organizationId: string | null }

type Translate = (key: string, fallback?: string) => string

async function resolveGroupId(context: RouteContext, translate: Translate): Promise<string> {
  const raw = await context.params
  const parsed = paramsSchema.safeParse(raw)
  if (!parsed.success) {
    throw notFound(translate('customer_groups.errors.group_not_found', 'Customer group not found'))
  }
  return parsed.data.id
}

async function resolveAuthScope(req: Request, translate: Translate): Promise<{ userId: string; scope: Scope }> {
  const auth = await getAuthFromRequest(req)
  if (!auth) throw new CrudHttpError(401, { error: translate('customer_groups.errors.unauthorized', 'Unauthorized') })
  const tenantId = auth.tenantId ?? null
  if (!tenantId) {
    throw new CrudHttpError(400, { error: translate('customer_groups.errors.tenant_required', 'Tenant context is required') })
  }
  return { userId: auth.sub, scope: { tenantId, organizationId: auth.orgId ?? null } }
}

async function loadGroupOrThrow(
  em: EntityManager,
  id: string,
  scope: Scope,
  translate: Translate,
): Promise<CustomerGroup> {
  const group = await em.findOne(CustomerGroup, { id, tenantId: scope.tenantId, deletedAt: null })
  if (!group) throw notFound(translate('customer_groups.errors.group_not_found', 'Customer group not found'))
  return group
}

// Mirrors `toNumericString` in `catalog/commands/shared.ts` — this module has no
// shared equivalent yet, so a small module-local copy follows the same established
// pattern rather than introducing a new cross-module dependency for one line.
function toNumericString(value: number | null | undefined): string | null {
  if (value === undefined || value === null) return null
  return value.toString()
}

function toNumberOrNull(value: string | null | undefined): number | null {
  if (value == null) return null
  const parsed = Number(value)
  return Number.isNaN(parsed) ? null : parsed
}

function serializeTerms(terms: CustomerGroupTerms) {
  return {
    id: terms.id,
    groupId: terms.groupId,
    organizationId: terms.organizationId ?? null,
    tenantId: terms.tenantId,
    priceKindId: terms.priceKindId ?? null,
    paymentTermsDays: terms.paymentTermsDays ?? null,
    allowPurchaseOnAccount: terms.allowPurchaseOnAccount,
    defaultCreditLimit: toNumberOrNull(terms.defaultCreditLimit),
    creditCurrencyCode: terms.creditCurrencyCode ?? null,
    approvalRequiredAbove: toNumberOrNull(terms.approvalRequiredAbove),
    minOrderValue: toNumberOrNull(terms.minOrderValue),
    metadata: terms.metadata ?? null,
    createdAt: terms.createdAt.toISOString(),
    updatedAt: terms.updatedAt.toISOString(),
  }
}

export async function GET(req: Request, context: RouteContext) {
  const { translate } = await resolveTranslations()
  try {
    const groupId = await resolveGroupId(context, translate)
    const { scope } = await resolveAuthScope(req, translate)
    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager).fork()

    await loadGroupOrThrow(em, groupId, scope, translate)

    // No terms row yet is a normal, expected state (spec: "No terms set — inheriting
    // from parent / tenant defaults") — answered as 200 with `terms: null` rather than
    // 404, since the sub-resource's *absence* is itself meaningful data for the caller
    // to render, not an error.
    const terms = await em.findOne(CustomerGroupTerms, { groupId, tenantId: scope.tenantId, deletedAt: null })
    return NextResponse.json({ terms: terms ? serializeTerms(terms) : null })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    logger.error('customer_groups.terms.get failed', { err })
    return NextResponse.json(
      { error: translate('customer_groups.errors.load_failed', 'Failed to load commercial terms') },
      { status: 500 },
    )
  }
}

const termsBodySchema = z.object({}).passthrough()

type CustomerGroupTermsEntityData = {
  organizationId: string | null
  tenantId: string
  groupId: string
  priceKindId: string | null
  paymentTermsDays: number | null
  allowPurchaseOnAccount: boolean
  defaultCreditLimit: string | null
  creditCurrencyCode: string | null
  approvalRequiredAbove: string | null
  minOrderValue: string | null
  metadata: Record<string, unknown> | null
}

function toEntityData(input: CustomerGroupTermsCreateInput): CustomerGroupTermsEntityData {
  return {
    organizationId: input.organizationId ?? null,
    tenantId: input.tenantId,
    groupId: input.groupId,
    priceKindId: input.priceKindId ?? null,
    paymentTermsDays: input.paymentTermsDays ?? null,
    allowPurchaseOnAccount: input.allowPurchaseOnAccount ?? false,
    defaultCreditLimit: toNumericString(input.defaultCreditLimit),
    creditCurrencyCode: input.creditCurrencyCode ?? null,
    approvalRequiredAbove: toNumericString(input.approvalRequiredAbove),
    minOrderValue: toNumericString(input.minOrderValue),
    metadata: input.metadata ?? null,
  }
}

function hasOwn(input: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, key)
}

// Scope fields (tenantId/organizationId/groupId) are deliberately excluded — same rule
// as `applyCustomerGroupUpdate` in `../../crud.ts`: a terms row's group/tenant is fixed
// at creation and MUST NOT change on update.
function applyTermsUpdate(entity: CustomerGroupTerms, input: CustomerGroupTermsUpdateInput): void {
  if (hasOwn(input, 'priceKindId')) entity.priceKindId = input.priceKindId ?? null
  if (hasOwn(input, 'paymentTermsDays')) entity.paymentTermsDays = input.paymentTermsDays ?? null
  if (hasOwn(input, 'allowPurchaseOnAccount') && input.allowPurchaseOnAccount !== undefined) {
    entity.allowPurchaseOnAccount = input.allowPurchaseOnAccount
  }
  if (hasOwn(input, 'defaultCreditLimit')) entity.defaultCreditLimit = toNumericString(input.defaultCreditLimit)
  if (hasOwn(input, 'creditCurrencyCode')) entity.creditCurrencyCode = input.creditCurrencyCode ?? null
  if (hasOwn(input, 'approvalRequiredAbove')) entity.approvalRequiredAbove = toNumericString(input.approvalRequiredAbove)
  if (hasOwn(input, 'minOrderValue')) entity.minOrderValue = toNumericString(input.minOrderValue)
  if (hasOwn(input, 'metadata')) entity.metadata = input.metadata ?? null
}

export async function PUT(req: Request, context: RouteContext) {
  const { translate } = await resolveTranslations()
  try {
    const groupId = await resolveGroupId(context, translate)
    const { userId, scope } = await resolveAuthScope(req, translate)
    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager).fork()

    await loadGroupOrThrow(em, groupId, scope, translate)

    const rawBody = (await readJsonSafe<Record<string, unknown>>(req, {})) ?? {}
    const rawInput = termsBodySchema.parse(rawBody)

    const existing = await em.findOne(CustomerGroupTerms, { groupId, tenantId: scope.tenantId, deletedAt: null })

    const guarded = await runRouteMutationGuards({
      container,
      req,
      auth: { userId, tenantId: scope.tenantId, organizationId: scope.organizationId },
      input: {
        resourceKind: TERMS_RESOURCE_KIND,
        resourceId: existing?.id ?? groupId,
        operation: existing ? 'update' : 'create',
        mutationPayload: rawInput,
      },
    })
    if (!guarded.ok) return guarded.response

    const payload = guarded.modifiedPayload ?? rawInput

    let terms: CustomerGroupTerms
    if (existing) {
      // The terms row has its own `updated_at`, independent of the parent group's —
      // guard THIS row against a concurrent edit of the same terms, not the group.
      // No lock check on creation below: there is nothing to conflict with yet.
      enforceCommandOptimisticLock({
        resourceKind: TERMS_RESOURCE_KIND,
        resourceId: existing.id,
        current: existing.updatedAt,
        request: req,
      })
      const parsed = customerGroupTermsUpdateSchema.parse({
        ...payload,
        id: existing.id,
        groupId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })
      applyTermsUpdate(existing, parsed)
      terms = existing
    } else {
      const parsed = customerGroupTermsCreateSchema.parse({
        ...payload,
        groupId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })
      terms = em.create(CustomerGroupTerms, toEntityData(parsed))
      em.persist(terms)
    }

    await em.flush()
    await guarded.runAfterSuccess()

    return NextResponse.json({ terms: serializeTerms(terms) })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: translate('customer_groups.errors.invalid_input', 'Invalid input') },
        { status: 400 },
      )
    }
    logger.error('customer_groups.terms.put failed', { err })
    return NextResponse.json(
      { error: translate('customer_groups.errors.save_failed', 'Failed to save commercial terms') },
      { status: 400 },
    )
  }
}

const termsItemSchema = z.object({
  id: z.string().uuid(),
  groupId: z.string().uuid(),
  organizationId: z.string().uuid().nullable(),
  tenantId: z.string().uuid(),
  priceKindId: z.string().uuid().nullable(),
  paymentTermsDays: z.number().int().nullable(),
  allowPurchaseOnAccount: z.boolean(),
  defaultCreditLimit: z.number().nullable(),
  creditCurrencyCode: z.string().nullable(),
  approvalRequiredAbove: z.number().nullable(),
  minOrderValue: z.number().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const termsGetResponseSchema = z.object({ terms: termsItemSchema.nullable() })
const termsPutResponseSchema = z.object({ terms: termsItemSchema })
const termsErrorSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'CustomerGroups',
  summary: 'Commercial terms for a customer group',
  methods: {
    GET: {
      summary: 'Get a customer group’s commercial terms',
      description: 'Returns the group’s own terms row, or `{ terms: null }` when the group has none and inherits from its parent/tenant defaults.',
      responses: [{ status: 200, description: 'Terms (or null)', schema: termsGetResponseSchema }],
      errors: [
        { status: 400, description: 'Tenant context is required', schema: termsErrorSchema },
        { status: 401, description: 'Unauthorized', schema: termsErrorSchema },
        { status: 404, description: 'Customer group not found', schema: termsErrorSchema },
      ],
    },
    PUT: {
      summary: 'Create or update a customer group’s commercial terms',
      description: 'Upserts the group’s terms row (creates it on first save). Supports optimistic locking via the extension header once a row exists.',
      requestBody: { contentType: 'application/json', schema: customerGroupTermsCreateSchema.partial() },
      responses: [{ status: 200, description: 'Terms created or updated', schema: termsPutResponseSchema }],
      errors: [
        { status: 400, description: 'Validation failed', schema: termsErrorSchema },
        { status: 401, description: 'Unauthorized', schema: termsErrorSchema },
        { status: 404, description: 'Customer group not found', schema: termsErrorSchema },
        { status: 409, description: 'Optimistic lock conflict', schema: termsErrorSchema },
      ],
    },
  },
}
