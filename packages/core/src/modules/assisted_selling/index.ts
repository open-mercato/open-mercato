import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

// Step 4.4: `cart` becomes a HARD `requires` — the module's own reason to exist is wrapping
// `cart.proposal.create`/`.reject` (dispatched through `commandBus`) and reading baskets/
// proposal-cart lines through `cartService` (`cart/di.ts`), so a thread cannot open and a
// proposal cannot be authored without it, unlike Step 4.3's settings-only scaffold (no
// cross-module read at all). `ecommerce.storeContextService.resolveForBuyer` stays a SOFT
// dependency (`tryResolve`), per its own §6.3 step 2 "fail closed... 503" contract and root
// AGENTS.md's Cross-Module Coupling guidance for an optional peer.
export const metadata: ModuleInfo = {
  name: 'assisted_selling',
  title: 'Assisted Selling',
  version: '0.1.0',
  description: 'Staff- and AI-authored priced proposals on a buyer\'s basket, accepted as a cart merge.',
  author: 'Open Mercato Team',
  license: 'MIT',
  ejectable: true,
  requires: ['cart'],
}

export { features } from './acl'
