/**
 * D18 catalog AI-authoring tools (Phase 1 WS-C, Step 3.12).
 *
 * Five structured-output helpers the `catalog.merchandising_assistant`
 * agent (Step 4.9) whitelists verbatim. These tools never write to the
 * database and never open a fresh model call from inside their handlers.
 * Instead, each handler assembles the tenant-scoped context the model will
 * need (product bundle, attribute schema, media references) and returns
 * an `{ proposal, context, outputSchemaDescriptor }` contract:
 *
 * - `context`                — tenant-validated input for the model's
 *                              structured-output step.
 * - `outputSchemaDescriptor` — a `{ schemaName, jsonSchema }` descriptor
 *                              the agent runtime passes into
 *                              `runAiAgentObject` (Step 3.5) so the SAME
 *                              agent turn that invoked the tool fills the
 *                              `proposal` via structured output.
 * - `proposal`               — a zod-typed placeholder with the fields the
 *                              model is expected to populate. Handlers
 *                              return empty defaults; the model fills them.
 *
 * This preserves the "no database writes + no extra model round trip from
 * a tool" contract from the brief. Any downstream mutation (e.g.
 * `catalog.update_product` in Step 5.14) re-validates the proposal
 * authoritatively on the server before writing.
 *
 * Five tools:
 * - `catalog.draft_description_from_attributes`
 * - `catalog.extract_attributes_from_description`
 * - `catalog.draft_description_from_media`
 * - `catalog.suggest_title_variants`
 * - `catalog.suggest_price_adjustment`
 *
 * Every tool sets `isMutation: false` explicitly (spec §7 line 536 calls
 * this out specifically for `suggest_price_adjustment`; the whole authoring
 * pack mirrors the flag for consistency).
 *
 * Tenant scoping: all lookups route through the shared `_shared.ts`
 * helpers (`buildProductBundle`, `resolveAttributeSchema`,
 * `listPriceKindsCore`) and the shared attachment + product-price readers.
 * Never touches raw `em.find` / `em.findOne`.
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Attachment } from '@open-mercato/core/modules/attachments/data/entities'
import { E } from '#generated/entities.ids.generated'
import { assertTenantScope, type CatalogAiToolDefinition, type CatalogToolContext } from './types'
import {
  buildProductBundle,
  buildScope,
  listPriceKindsCore,
  resolveAttributeSchema,
  resolveEm,
  type AttributeSchemaResult,
  type ProductBundle,
  type ProductBundleResult,
} from './_shared'
import type { CatalogPricingService } from '../services/catalogPricingService'
import type { PriceRow, PricingContext } from '../lib/pricing'

/* -------------------------------------------------------------------------- */
/*  Shared helpers                                                             */
/* -------------------------------------------------------------------------- */

function toJsonSchema<T>(schema: z.ZodType<T>, schemaName: string): Record<string, unknown> {
  const json = z.toJSONSchema(schema) as Record<string, unknown>
  return { ...json, title: schemaName }
}

type ProductContextHit = {
  found: true
  productId: string
  bundle: ProductBundle
}

type ProductContextMiss = {
  found: false
  productId: string
}

async function loadProductContext(
  ctx: CatalogToolContext,
  tenantId: string,
  productId: string,
): Promise<ProductContextHit | ProductContextMiss> {
  const em = resolveEm(ctx)
  const result: ProductBundleResult = await buildProductBundle(em, ctx, tenantId, productId)
  if (!result.found) {
    return { found: false as const, productId }
  }
  return { found: true as const, productId, bundle: result }
}

function resolvePricingService(ctx: CatalogToolContext): CatalogPricingService | null {
  try {
    return ctx.container.resolve<CatalogPricingService>('catalogPricingService')
  } catch {
    return null
  }
}

/* -------------------------------------------------------------------------- */
/*  catalog.draft_description_from_attributes                                  */
/* -------------------------------------------------------------------------- */

const draftDescriptionFromAttributesInput = z.object({
  productId: z.string().uuid().describe('Catalog product id (UUID).'),
  tonePreference: z
    .enum(['neutral', 'marketing', 'technical', 'short'])
    .optional()
    .describe('Preferred tone for the drafted description (default `neutral`).'),
})

const draftDescriptionFromAttributesProposal = z.object({
  description: z.string().describe('Drafted product description the model should author from the attribute bundle.'),
  rationale: z.string().describe('Why the model authored this description (which attributes drove it).'),
  attributesUsed: z.array(z.string()).describe('Attribute keys the model actually referenced.'),
})

const DRAFT_DESCRIPTION_FROM_ATTRIBUTES_SCHEMA = 'DraftDescriptionFromAttributes'

const draftDescriptionFromAttributesTool: CatalogAiToolDefinition = {
  name: 'catalog.draft_description_from_attributes',
  displayName: 'Draft description from attributes',
  description:
    'Structured-output helper for D18: returns the tenant-scoped product bundle (core fields + attributes + media metadata) alongside a JSON-Schema descriptor the surrounding agent turn uses via `runAiAgentObject` to draft a product description. The handler NEVER calls the model itself; it composes the context and the output shape.',
  inputSchema: draftDescriptionFromAttributesInput,
  requiredFeatures: ['catalog.products.view'],
  tags: ['read', 'catalog', 'authoring', 'merchandising'],
  isMutation: false,
  handler: async (rawInput, ctx) => {
    const { tenantId } = assertTenantScope(ctx)
    const input = draftDescriptionFromAttributesInput.parse(rawInput)
    const hit = await loadProductContext(ctx, tenantId, input.productId)
    if (!hit.found) {
      return { found: false as const, productId: input.productId }
    }
    const tonePreference = input.tonePreference ?? 'neutral'
    return {
      found: true as const,
      proposal: {
        description: '',
        rationale: '',
        attributesUsed: [] as string[],
      },
      context: {
        product: hit.bundle,
        tonePreference,
      },
      outputSchemaDescriptor: {
        schemaName: DRAFT_DESCRIPTION_FROM_ATTRIBUTES_SCHEMA,
        jsonSchema: toJsonSchema(draftDescriptionFromAttributesProposal, DRAFT_DESCRIPTION_FROM_ATTRIBUTES_SCHEMA),
      },
    }
  },
}

/* -------------------------------------------------------------------------- */
/*  catalog.extract_attributes_from_description                                */
/* -------------------------------------------------------------------------- */

const extractAttributesFromDescriptionInput = z.object({
  productId: z.string().uuid().describe('Catalog product id (UUID).'),
  descriptionOverride: z
    .string()
    .min(1)
    .optional()
    .describe('Optional description text to analyze instead of the product\'s stored description.'),
})

// `attributes` is modeled as a free-form `Record<string, unknown>` because
// the attribute schema is tenant-defined and heterogeneous (enum / numeric /
// boolean / string-with-unit). `z.record` emits JSON Schema
// `additionalProperties: {}` which is the intended open-object surface for
// the model; downstream validation (Step 5.14 `apply_attribute_extraction`)
// re-checks each value against the resolved schema authoritatively.
const extractAttributesFromDescriptionProposal = z.object({
  attributes: z
    .record(z.string(), z.unknown())
    .describe('Attribute key → value pairs mapped from the description. Shape matches the resolved attribute schema; server re-validates before any write.'),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe('Model confidence (0..1) in the extracted attribute set as a whole.'),
  unmapped: z
    .array(z.string())
    .describe('Description phrases that could not be mapped to any schema attribute.'),
})

const EXTRACT_ATTRIBUTES_FROM_DESCRIPTION_SCHEMA = 'ExtractAttributesFromDescription'

const extractAttributesFromDescriptionTool: CatalogAiToolDefinition = {
  name: 'catalog.extract_attributes_from_description',
  displayName: 'Extract attributes from description',
  description:
    'Structured-output helper for D18: returns the product bundle, the resolved attribute schema, and the description text the model should parse. The surrounding agent turn uses `runAiAgentObject` with the emitted JSON-Schema descriptor to produce the extracted attribute map. The `attributes` output shape intentionally uses `additionalProperties: true` because tenant attribute schemas are heterogeneous; any downstream write re-validates each value against the schema authoritatively.',
  inputSchema: extractAttributesFromDescriptionInput,
  requiredFeatures: ['catalog.products.view'],
  tags: ['read', 'catalog', 'authoring', 'merchandising'],
  isMutation: false,
  handler: async (rawInput, ctx) => {
    const { tenantId } = assertTenantScope(ctx)
    const input = extractAttributesFromDescriptionInput.parse(rawInput)
    const hit = await loadProductContext(ctx, tenantId, input.productId)
    if (!hit.found) {
      return { found: false as const, productId: input.productId }
    }
    const attributeSchema: AttributeSchemaResult = await resolveAttributeSchema(
      ctx,
      tenantId,
      input.productId,
      undefined,
    )
    const description = input.descriptionOverride ?? hit.bundle.product.description ?? ''
    return {
      found: true as const,
      proposal: {
        attributes: {} as Record<string, unknown>,
        confidence: 0,
        unmapped: [] as string[],
      },
      context: {
        product: hit.bundle,
        attributeSchema,
        description,
      },
      outputSchemaDescriptor: {
        schemaName: EXTRACT_ATTRIBUTES_FROM_DESCRIPTION_SCHEMA,
        jsonSchema: toJsonSchema(
          extractAttributesFromDescriptionProposal,
          EXTRACT_ATTRIBUTES_FROM_DESCRIPTION_SCHEMA,
        ),
      },
    }
  },
}

/* -------------------------------------------------------------------------- */
/*  catalog.draft_description_from_media                                       */
/* -------------------------------------------------------------------------- */

const draftDescriptionFromMediaInput = z.object({
  productId: z.string().uuid().describe('Catalog product id (UUID).'),
  userUploadedAttachmentIds: z
    .array(z.string().uuid())
    .max(20)
    .optional()
    .describe('Additional attachment IDs the user just uploaded. Cross-tenant IDs are dropped with a warning (not surfaced).'),
})

const draftDescriptionFromMediaProposal = z.object({
  description: z.string().describe('Drafted description based on the media references.'),
  features: z.array(z.string()).describe('Salient product features the model surfaced from the media.'),
  mediaReferences: z
    .array(
      z.object({
        attachmentId: z.string(),
        note: z.string().optional(),
      }),
    )
    .describe('Attachment IDs the model actually used, with an optional note per reference.'),
})

const DRAFT_DESCRIPTION_FROM_MEDIA_SCHEMA = 'DraftDescriptionFromMedia'

type UserMediaEntry = {
  attachmentId: string
  fileName: string
  mediaType: string | null
  size: number | null
}

async function loadUserMedia(
  em: EntityManager,
  ctx: CatalogToolContext,
  tenantId: string,
  attachmentIds: string[],
): Promise<UserMediaEntry[]> {
  if (!attachmentIds.length) return []
  const unique = Array.from(new Set(attachmentIds))
  const where: Record<string, unknown> = {
    tenantId,
    id: { $in: unique },
  }
  if (ctx.organizationId) where.organizationId = ctx.organizationId
  const rows = await findWithDecryption<Attachment>(
    em,
    Attachment,
    where as any,
    { limit: unique.length } as any,
    buildScope(ctx, tenantId),
  )
  const tenantScoped = rows.filter((row) => (row.tenantId ?? null) === tenantId)
  for (const dropped of unique) {
    if (!tenantScoped.find((row) => row.id === dropped)) {
      console.warn(`[catalog.draft_description_from_media] dropping attachment not in scope: ${dropped}`)
    }
  }
  return tenantScoped.map((row) => ({
    attachmentId: row.id,
    fileName: row.fileName,
    mediaType: row.mimeType ?? null,
    size: row.fileSize ?? null,
  }))
}

const draftDescriptionFromMediaTool: CatalogAiToolDefinition = {
  name: 'catalog.draft_description_from_media',
  displayName: 'Draft description from media',
  description:
    'Structured-output helper for D18. Returns the product bundle, the product\'s media metadata, and any tenant-scoped user-uploaded attachment IDs (cross-tenant IDs are dropped with a warning). The handler does NOT fetch attachment bytes — the Step 3.7 attachment bridge resolves bytes when the surrounding agent turn dispatches this tool. Requires a vision-capable provider to use raw image bytes; OCR-text fallback for non-vision providers already flows through the Step 3.7 bridge.',
  inputSchema: draftDescriptionFromMediaInput,
  requiredFeatures: ['catalog.products.view'],
  tags: ['read', 'catalog', 'authoring', 'merchandising', 'media'],
  isMutation: false,
  supportsAttachments: true,
  handler: async (rawInput, ctx) => {
    const { tenantId } = assertTenantScope(ctx)
    const input = draftDescriptionFromMediaInput.parse(rawInput)
    const hit = await loadProductContext(ctx, tenantId, input.productId)
    if (!hit.found) {
      return { found: false as const, productId: input.productId }
    }
    const em = resolveEm(ctx)
    const userMedia = await loadUserMedia(em, ctx, tenantId, input.userUploadedAttachmentIds ?? [])
    const productMedia = hit.bundle.media.map((entry) => ({
      attachmentId: entry.attachmentId,
      fileName: entry.fileName,
      mediaType: entry.mediaType,
      altText: entry.altText,
      sortOrder: entry.sortOrder,
    }))
    return {
      found: true as const,
      proposal: {
        description: '',
        features: [] as string[],
        mediaReferences: [] as Array<{ attachmentId: string; note?: string }>,
      },
      context: {
        product: hit.bundle,
        productMedia,
        userMedia,
      },
      outputSchemaDescriptor: {
        schemaName: DRAFT_DESCRIPTION_FROM_MEDIA_SCHEMA,
        jsonSchema: toJsonSchema(draftDescriptionFromMediaProposal, DRAFT_DESCRIPTION_FROM_MEDIA_SCHEMA),
      },
    }
  },
}

/* -------------------------------------------------------------------------- */
/*  catalog.suggest_title_variants                                             */
/* -------------------------------------------------------------------------- */

const suggestTitleVariantsInput = z.object({
  productId: z.string().uuid().describe('Catalog product id (UUID).'),
  targetStyle: z
    .enum(['short', 'seo', 'marketplace'])
    .describe('Voice/style for the variants (short, seo-optimized, or marketplace-friendly).'),
  maxVariants: z
    .number()
    .int()
    .min(1)
    .max(5)
    .optional()
    .describe('Max number of variants to return. Default 3, hard-capped at 5.'),
})

const suggestTitleVariantsProposal = z.object({
  variants: z
    .array(
      z.object({
        title: z.string(),
        style: z.string(),
        rationale: z.string().optional(),
      }),
    )
    .describe('Proposed title variants (respect the `maxVariants` bound).'),
})

const SUGGEST_TITLE_VARIANTS_SCHEMA = 'SuggestTitleVariants'

const suggestTitleVariantsTool: CatalogAiToolDefinition = {
  name: 'catalog.suggest_title_variants',
  displayName: 'Suggest title variants',
  description:
    'Structured-output helper for D18: returns the product bundle and the target style. The surrounding agent turn uses `runAiAgentObject` to propose `maxVariants` (default 3, capped at 5) title variants matching the style.',
  inputSchema: suggestTitleVariantsInput,
  requiredFeatures: ['catalog.products.view'],
  tags: ['read', 'catalog', 'authoring', 'merchandising'],
  isMutation: false,
  handler: async (rawInput, ctx) => {
    const { tenantId } = assertTenantScope(ctx)
    const input = suggestTitleVariantsInput.parse(rawInput)
    const hit = await loadProductContext(ctx, tenantId, input.productId)
    if (!hit.found) {
      return { found: false as const, productId: input.productId }
    }
    const maxVariants = Math.min(input.maxVariants ?? 3, 5)
    return {
      found: true as const,
      proposal: {
        variants: [] as Array<{ title: string; style: string; rationale?: string }>,
      },
      context: {
        product: hit.bundle,
        targetStyle: input.targetStyle,
        maxVariants,
      },
      outputSchemaDescriptor: {
        schemaName: SUGGEST_TITLE_VARIANTS_SCHEMA,
        jsonSchema: toJsonSchema(suggestTitleVariantsProposal, SUGGEST_TITLE_VARIANTS_SCHEMA),
      },
    }
  },
}

/* -------------------------------------------------------------------------- */
/*  catalog.suggest_price_adjustment                                           */
/* -------------------------------------------------------------------------- */

const suggestPriceAdjustmentInput = z.object({
  productId: z.string().uuid().describe('Catalog product id (UUID).'),
  intent: z
    .string()
    .trim()
    .min(1)
    .describe('Human-readable intent (e.g. "raise price by 10%", "match competitor at 29.99").'),
  priceKindId: z
    .string()
    .uuid()
    .optional()
    .describe('Optional price-kind id to target. When omitted, the model picks the most relevant kind from `context.availablePriceKinds`.'),
})

const suggestPriceAdjustmentProposal = z.object({
  currentPrice: z
    .union([
      z.object({
        amount: z.number(),
        currency: z.string(),
        priceKindId: z.string(),
      }),
      z.null(),
    ])
    .describe('Current price on the targeted kind (null if none is defined).'),
  proposedPrice: z.object({
    amount: z.number(),
    currency: z.string(),
    priceKindId: z.string(),
  }),
  rationale: z.string(),
  constraints: z.object({
    respectedPriceKindScope: z.boolean(),
    respectedCurrency: z.boolean(),
  }),
})

const SUGGEST_PRICE_ADJUSTMENT_SCHEMA = 'SuggestPriceAdjustment'

type ResolvedCurrentPrice = {
  amount: number
  currency: string
  priceKindId: string
} | null

function currentPriceFromBundle(
  bundle: ProductBundle,
  priceKindId?: string,
): ResolvedCurrentPrice {
  const priceRows = bundle.prices.all as Array<Record<string, unknown>>
  if (!priceRows.length) return null
  const candidates = priceKindId
    ? priceRows.filter((row) => row.priceKindId === priceKindId)
    : priceRows
  const pick = candidates[0] ?? null
  if (!pick) return null
  const rawAmount = (pick.unitPriceGross ?? pick.unitPriceNet) as string | null | undefined
  const amount = rawAmount === null || rawAmount === undefined ? null : Number(rawAmount)
  if (amount === null || !Number.isFinite(amount)) return null
  const currency = (pick.currencyCode as string | null) ?? null
  const resolvedKind = (pick.priceKindId as string | null) ?? null
  if (!currency || !resolvedKind) return null
  return { amount, currency, priceKindId: resolvedKind }
}

async function currentPriceFromService(
  ctx: CatalogToolContext,
  bundle: ProductBundle,
  priceKindId?: string,
): Promise<ResolvedCurrentPrice | 'resolver_unavailable'> {
  const pricingService = resolvePricingService(ctx)
  if (!pricingService) return 'resolver_unavailable'
  const priceRows = bundle.prices.all as Array<Record<string, unknown>>
  if (!priceRows.length) return null
  const candidates = priceKindId
    ? priceRows.filter((row) => row.priceKindId === priceKindId)
    : priceRows
  if (!candidates.length) return null
  try {
    const pricingContext: PricingContext = { quantity: 1, date: new Date() }
    const resolved = await pricingService.resolvePrice(
      candidates as unknown as PriceRow[],
      pricingContext,
    )
    if (!resolved) return null
    const rawAmount = ((resolved as any).unitPriceGross ?? (resolved as any).unitPriceNet) as
      | string
      | number
      | null
      | undefined
    const amount = rawAmount === null || rawAmount === undefined ? null : Number(rawAmount)
    if (amount === null || !Number.isFinite(amount)) return null
    const currency = ((resolved as any).currencyCode as string | null) ?? null
    const resolvedKind = ((resolved as any).priceKindId
      ?? ((resolved as any).priceKind && typeof (resolved as any).priceKind === 'object'
        ? (resolved as any).priceKind.id
        : (resolved as any).priceKind)) as string | null | undefined
    if (!currency || !resolvedKind) return null
    return { amount, currency, priceKindId: resolvedKind }
  } catch {
    // The pricing service may throw for reasons beyond our control (config,
    // resolver chain error). We fall back to the bundle view rather than
    // bubbling the error out of a read-only tool.
    return 'resolver_unavailable'
  }
}

const suggestPriceAdjustmentTool: CatalogAiToolDefinition = {
  name: 'catalog.suggest_price_adjustment',
  displayName: 'Suggest price adjustment',
  description:
    'Structured-output helper for D18. Returns the product bundle, the current tenant-resolved price (via `catalogPricingService.selectBestPrice` when available, otherwise a fallback projection from the bundle prices), and the list of available price kinds. The surrounding agent turn uses `runAiAgentObject` to propose a price adjustment. `isMutation: false` is explicit — this tool NEVER writes; `catalog.update_product` (Step 5.14) recalculates authoritatively on the server before any write.',
  inputSchema: suggestPriceAdjustmentInput,
  requiredFeatures: ['catalog.pricing.manage'],
  tags: ['read', 'catalog', 'authoring', 'merchandising', 'pricing'],
  isMutation: false,
  handler: async (rawInput, ctx) => {
    const { tenantId } = assertTenantScope(ctx)
    const input = suggestPriceAdjustmentInput.parse(rawInput)
    const hit = await loadProductContext(ctx, tenantId, input.productId)
    if (!hit.found) {
      return { found: false as const, productId: input.productId }
    }
    const serviceResult = await currentPriceFromService(ctx, hit.bundle, input.priceKindId)
    const currentPrice: ResolvedCurrentPrice =
      serviceResult === 'resolver_unavailable'
        ? currentPriceFromBundle(hit.bundle, input.priceKindId)
        : serviceResult
    const priceKindsResult = await listPriceKindsCore(ctx, { limit: 100 }, tenantId)
    const availablePriceKinds = priceKindsResult.items.map((row) => ({
      id: row.id,
      code: row.code,
      scope: row.organizationId ? ('organization' as const) : ('tenant' as const),
    }))
    return {
      found: true as const,
      proposal: {
        currentPrice,
        proposedPrice: {
          amount: currentPrice?.amount ?? 0,
          currency: currentPrice?.currency ?? (hit.bundle.product.primaryCurrencyCode ?? 'USD'),
          priceKindId: currentPrice?.priceKindId ?? (input.priceKindId ?? ''),
        },
        rationale: '',
        constraints: {
          respectedPriceKindScope: true,
          respectedCurrency: true,
        },
      },
      context: {
        product: hit.bundle,
        intent: input.intent,
        availablePriceKinds,
      },
      outputSchemaDescriptor: {
        schemaName: SUGGEST_PRICE_ADJUSTMENT_SCHEMA,
        jsonSchema: toJsonSchema(suggestPriceAdjustmentProposal, SUGGEST_PRICE_ADJUSTMENT_SCHEMA),
      },
    }
  },
}

/* -------------------------------------------------------------------------- */
/*  Export                                                                     */
/* -------------------------------------------------------------------------- */

export const authoringAiTools: CatalogAiToolDefinition[] = [
  draftDescriptionFromAttributesTool,
  extractAttributesFromDescriptionTool,
  draftDescriptionFromMediaTool,
  suggestTitleVariantsTool,
  suggestPriceAdjustmentTool,
]

export default authoringAiTools
