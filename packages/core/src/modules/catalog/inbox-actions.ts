import type { InboxActionDefinition, InboxActionExecutionContext } from '@open-mercato/shared/modules/inbox-actions'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createProductPayloadSchema } from '../inbox_ops/data/validators'
import type { CreateProductPayload } from '../inbox_ops/data/validators'
import {
  asHelperContext,
  ExecutionError,
  executeCommand,
  resolveProductDiscrepanciesInProposal,
} from '../inbox_ops/lib/executionHelpers'
import { CatalogPriceKind } from './data/entities'

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

  // Create default variant so the product works with quotes/orders (issue #891)
  // No separate permission check — the user already passed catalog.products.manage
  // in the execution engine, and variant/price creation is an integral part of
  // product setup, not a separate user action.
  let variantId: string | null = null
  try {
    const variantResult = await executeCommand<Record<string, unknown>, { variantId?: string }>(
      hCtx,
      'catalog.variants.create',
      {
        productId: result.productId,
        organizationId: hCtx.organizationId,
        tenantId: hCtx.tenantId,
        name: 'Default',
        isDefault: true,
        isActive: true,
        sku: payload.sku || undefined,
      },
    )
    variantId = variantResult.variantId ?? null
  } catch (variantErr) {
    console.warn('[catalog:inbox-action] Failed to create default variant (non-fatal):', variantErr instanceof Error ? variantErr.message : variantErr)
  }

  if (variantId && payload.unitPrice && payload.currencyCode) {
    try {
      const priceKind = await findOneWithDecryption(
        hCtx.em,
        CatalogPriceKind,
        {
          code: 'regular',
          tenantId: hCtx.tenantId,
          deletedAt: null,
        },
        undefined,
        { tenantId: hCtx.tenantId, organizationId: hCtx.organizationId },
      )
      if (priceKind) {
        await executeCommand(hCtx, 'catalog.prices.create', {
          variantId,
          productId: result.productId,
          organizationId: hCtx.organizationId,
          tenantId: hCtx.tenantId,
          priceKindId: priceKind.id,
          currencyCode: payload.currencyCode,
          unitPriceNet: Number(payload.unitPrice),
        })
      }
    } catch (priceErr) {
      console.warn('[catalog:inbox-action] Failed to set price on default variant (non-fatal):', priceErr)
    }
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
