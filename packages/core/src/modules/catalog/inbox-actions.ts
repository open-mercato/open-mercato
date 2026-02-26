import type { InboxActionDefinition, InboxActionExecutionContext } from '@open-mercato/shared/modules/inbox-actions'
import { createProductPayloadSchema } from '../inbox_ops/data/validators'
import type { CreateProductPayload } from '../inbox_ops/data/validators'
import {
  asHelperContext,
  ExecutionError,
  executeCommand,
  resolveProductDiscrepanciesInProposal,
} from '../inbox_ops/lib/executionHelpers'

async function executeCreateProductAction(
  action: { id: string; proposalId: string; payload: unknown },
  ctx: InboxActionExecutionContext,
): Promise<{ createdEntityId?: string | null; createdEntityType?: string | null }> {
  const hCtx = asHelperContext(ctx)
  const payload = action.payload as CreateProductPayload

  const createInput: Record<string, unknown> = {
    organizationId: hCtx.organizationId,
    tenantId: hCtx.tenantId,
    title: payload.title,
    productType: 'simple',
    isActive: true,
  }

  if (payload.sku) createInput.sku = payload.sku
  if (payload.description) createInput.description = payload.description
  if (payload.currencyCode) createInput.primaryCurrencyCode = payload.currencyCode

  const result = await executeCommand<Record<string, unknown>, { productId?: string }>(
    hCtx,
    'catalog.products.create',
    createInput,
  )

  if (!result.productId) {
    throw new ExecutionError('Product creation did not return a product ID', 500)
  }

  await resolveProductDiscrepanciesInProposal(hCtx.em, action.proposalId, payload.title, result.productId, {
    tenantId: hCtx.tenantId,
    organizationId: hCtx.organizationId,
  })

  return { createdEntityId: result.productId, createdEntityType: 'catalog_product' }
}

export const inboxActions: InboxActionDefinition[] = [
  {
    type: 'create_product',
    requiredFeature: 'catalog.products.manage',
    payloadSchema: createProductPayloadSchema,
    label: 'Create Product',
    promptSchema: `create_product payload:
{ title: string, sku?: string, unitPrice?: string, currencyCode?: string (3-letter ISO), kind?: "product"|"service", description?: string }`,
    execute: executeCreateProductAction,
  },
]

export default inboxActions
