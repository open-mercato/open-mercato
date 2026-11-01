import { z } from 'zod'
import {
  customerCreditAccountCrud,
  customerCreditAccountListQuerySchema,
  customerCreditAccountRouteMetadata,
} from './crud'
import { withCreateConflictRecheck } from '../../../lib/createConflictRecheck'
import { createCustomerGroupsCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from '../../openapi'

// GET (list, or detail via `?id=`) + POST (operator provisioning, G13/D-R5-5) + PUT
// (update, id in body) — no `[id]` dynamic segment, same shared-`makeCrudRoute`-instance
// convention as `../route.ts` / `../memberships/route.ts`. No DELETE export: Release 5
// has no delete route for credit accounts (§9).
export const metadata = customerCreditAccountRouteMetadata

export const GET = customerCreditAccountCrud.GET
export const POST = withCreateConflictRecheck(customerCreditAccountCrud.POST)
export const PUT = customerCreditAccountCrud.PUT

export const customerCreditAccountListItemSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  customer_id: z.string().uuid(),
  currency_code: z.string(),
  credit_limit: z.string(),
  is_on_hold: z.boolean(),
  hold_reason: z.string().nullable().optional(),
  updated_by_user_id: z.string().uuid().nullable().optional(),
  created_at: z.string().nullable().optional(),
  // Optimistic locking (default ON — root AGENTS.md § Always): the list/detail response
  // returns `updated_at` so `buildOptimisticLockHeader` can derive the lock header from
  // it, exactly like every other entity in this module.
  updated_at: z.string().nullable().optional(),
  // Computed, display-only (§6.5) — never persisted columns. See `./crud.ts`'s
  // `hooks.afterList` for how these are populated via `customerCreditService.checkCredit`.
  exposure: z.string().nullable().optional(),
  available: z.string().nullable().optional(),
})

const customerCreditAccountUpdateRequestSchema = z.object({
  id: z.string().uuid(),
  creditLimit: z.number().min(0).optional(),
  isOnHold: z.boolean().optional(),
  holdReason: z.string().nullable().optional(),
})

const customerCreditAccountCreateRequestDocSchema = z.object({
  customerId: z.string().uuid(),
  currencyCode: z.string().length(3),
  creditLimit: z.union([z.number().min(0), z.string()]),
  isOnHold: z.boolean().optional(),
  holdReason: z.string().nullable().optional(),
})

const customerCreditAccountCreateResponseSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  customerId: z.string().uuid(),
  currencyCode: z.string(),
  creditLimit: z.string(),
  isOnHold: z.boolean(),
  updatedAt: z.string().nullable(),
})

export const openApi = createCustomerGroupsCrudOpenApi({
  resourceName: 'CustomerCreditAccount',
  pluralName: 'CustomerCreditAccounts',
  querySchema: customerCreditAccountListQuerySchema,
  listResponseSchema: createPagedListResponseSchema(customerCreditAccountListItemSchema),
  create: {
    schema: customerCreditAccountCreateRequestDocSchema,
    responseSchema: customerCreditAccountCreateResponseSchema,
    description:
      'Provisions a credit account for a customer in one currency (operator only, D-R5-5). The customer must belong to the caller\'s selected organization; tenant, organization and the acting user are set by the server. creditLimit is required — a group\'s default credit limit only pre-fills the form. Answers 409 with code credit_account_exists when a live account already exists for the customer and currency, and 400 when isOnHold is true without a holdReason.',
  },
  update: {
    schema: customerCreditAccountUpdateRequestSchema,
    responseSchema: defaultOkResponseSchema,
    description:
      'Edits a customer credit account\'s limit and/or hold state. A hold reason is required when isOnHold is set to true. Supports optimistic locking via the extension header.',
  },
})
