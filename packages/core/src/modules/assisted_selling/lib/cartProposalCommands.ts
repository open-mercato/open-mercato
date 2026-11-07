import type { EffectiveAssortmentScope } from '@open-mercato/shared/lib/catalog-visibility'

// Step 4.4. Duck-typed mirrors of `cart`'s own `cart.proposal.create`/`.reject` command
// input/result shapes (`cart/commands/proposal.ts`) — dispatched by STRING id through
// `commandBus.execute<Input, Result>(id, …)`, never through a cross-module import of
// `cart/commands/proposal.ts` itself (that file lives inside `cart`'s own module boundary;
// `lib/cartAccess.ts`'s header comment gives the same reasoning for `cartService`). Kept
// deliberately narrow — only the fields this module's own commands read or write.

export type CartProposalCreateLine = {
  productId: string
  variantId?: string | null
  quantity: string
  configuration?: Record<string, unknown> | null
}

export type CartProposalCreateCommandInput = {
  targetCartId: string
  lines: CartProposalCreateLine[]
  ttlSeconds?: number
  routeContext?: { assortmentScope?: EffectiveAssortmentScope }
}

export type CartProposalCreateRejectedLine = {
  productId: string
  variantId: string | null
  reason: string
}

export type CartProposalCreateCommandResult = {
  proposalCartId: string
  tenantId: string
  organizationId: string
  lines: unknown[]
  totals: Record<string, unknown>
  warnings?: Array<{ code: string; message: string }>
  rejectedLines: CartProposalCreateRejectedLine[]
}

export const CART_PROPOSAL_CREATE_COMMAND_ID = 'cart.proposal.create'

export type CartProposalRejectCommandInput = {
  proposalCartId: string
  tenantId: string
  organizationId: string
  rejectedBy: 'buyer' | 'author'
}

export type CartProposalRejectCommandResult = {
  proposalCartId: string
  status: string
  alreadyResolved: boolean
}

export const CART_PROPOSAL_REJECT_COMMAND_ID = 'cart.proposal.reject'
