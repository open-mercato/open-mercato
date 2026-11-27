import type { AwilixContainer } from 'awilix'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { enqueueOnCreateSuggestion } from '../lib/aiCategorization/onCreateSuggest'

const logger = createLogger('catalog')

export const metadata = {
  event: 'catalog.product.created',
  persistent: true,
  id: 'catalog:product-ai-categorize-on-create',
}

type ProductCreatedPayload = {
  id?: string | null
  tenantId?: unknown
  organizationId?: unknown
}

type TrustedSubscriberContext = {
  resolve: <T = unknown>(name: string) => T
  tenantId?: string | null
  organizationId?: string | null
}

function readScopeId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

export default async function handle(payload: ProductCreatedPayload, ctx: TrustedSubscriberContext): Promise<void> {
  const productId = payload?.id
  const tenantId = readScopeId(ctx?.tenantId)
  const organizationId = readScopeId(ctx?.organizationId)
  if (!productId || !tenantId || !organizationId) return

  const payloadTenantId = readScopeId(payload.tenantId)
  const payloadOrganizationId = readScopeId(payload.organizationId)
  const payloadScopeMismatch =
    (payloadTenantId !== null && payloadTenantId !== tenantId) ||
    (payloadOrganizationId !== null && payloadOrganizationId !== organizationId)
  if (payloadScopeMismatch) {
    logger.warn('catalog.ai_categorization.on_create rejected an event whose payload scope differs from the trusted context', {
      productId,
      trustedTenantId: tenantId,
      trustedOrganizationId: organizationId,
      payloadTenantId,
      payloadOrganizationId,
    })
    return
  }

  await enqueueOnCreateSuggestion({
    container: ctx as unknown as AwilixContainer,
    productId,
    tenantId,
    organizationId,
  })
}
