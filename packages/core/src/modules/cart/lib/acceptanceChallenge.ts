import type { EntityManager } from '@mikro-orm/postgresql'

import type { Cart } from '../data/entities'
import type { ResolvedCartRouteContext } from './routeContext'
import { signAcceptanceToken } from './acceptanceToken'
import { buildProposalAcceptancePreview } from './proposalPreview'
import type { ProposalAcceptancePreview } from './proposalPreview'

export type AcceptanceChallengeScope = { tenantId: string; organizationId: string }

/**
 * §7a.4's "either preview version moves" challenge, shared between `commands/proposal.ts`
 * (the pre-lock verification `cart.proposal.accept` runs against the caller's token) and
 * `commands/merge.ts` (the SAME check re-run under the per-cart advisory locks, M8 fix —
 * see `executeProposalAcceptance`'s own header comment). Kept in `lib/` rather than
 * exported from either command file so neither command has to import from the other's
 * module (`proposal.ts` already imports `mergeCartCommand` from `merge.ts`; the reverse
 * import would be a cycle).
 */
export async function buildFreshAcceptanceChallenge(
  em: EntityManager,
  container: { resolve: <T = unknown>(name: string) => T },
  scope: AcceptanceChallengeScope,
  target: Cart,
  proposal: Cart,
  assortmentScope: ResolvedCartRouteContext['assortmentScope'] | undefined,
): Promise<{ acceptancePreview: ProposalAcceptancePreview; acceptanceToken: string }> {
  const acceptancePreview = await buildProposalAcceptancePreview({ em, container, scope, target, proposal, assortmentScope })
  const acceptanceToken = signAcceptanceToken({
    proposalCartId: proposal.id,
    targetCartId: target.id,
    proposalUpdatedAt: proposal.updatedAt.toISOString(),
    targetUpdatedAt: target.updatedAt.toISOString(),
  })
  return { acceptancePreview, acceptanceToken }
}
