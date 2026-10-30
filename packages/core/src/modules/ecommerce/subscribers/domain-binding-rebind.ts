import { readDomainMappingReplacement, rebindReplacedDomainMapping } from '../lib/domainBindingRebind'
import type { EcommerceSubscriberContext } from '../lib/subscriberSupport'

export const metadata = {
  event: 'customer_accounts.domain_mapping.replaced',
  persistent: true,
  id: 'ecommerce:domain-binding-rebind',
}

export default async function handle(payload: unknown, ctx: EcommerceSubscriberContext): Promise<void> {
  const replacement = readDomainMappingReplacement(payload, ctx)
  if (!replacement) return
  await rebindReplacedDomainMapping(ctx, replacement)
}
