import type { AwilixContainer } from 'awilix'
import { enqueueOnCreateSuggestion } from '../lib/aiCategorization/onCreateSuggest'

export const metadata = {
  event: 'catalog.product.created',
  persistent: true,
  id: 'catalog:product-ai-categorize-on-create',
}

type ProductCreatedPayload = {
  id?: string | null
  tenantId?: string | null
  organizationId?: string | null
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(payload: ProductCreatedPayload, ctx: ResolverContext): Promise<void> {
  const productId = payload?.id
  const tenantId = payload?.tenantId
  const organizationId = payload?.organizationId
  if (!productId || !tenantId || !organizationId) return
  await enqueueOnCreateSuggestion({
    container: ctx as unknown as AwilixContainer,
    productId,
    tenantId,
    organizationId,
  })
}
