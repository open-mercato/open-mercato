/**
 * `catalog.show_stats` — example dynamic UI-part tool.
 *
 * Demonstrates the generic UI-part contract: any tool can return a JSON
 * envelope `{ uiPart: { componentId, payload } }` (or a `uiParts: [...]`
 * array) and the chat client surfaces it inline. The catalog stats card
 * is the canonical dynamic example; module authors copy this file +
 * `components/CatalogStatsCard.tsx` to ship their own cards.
 *
 * Read-only — no `prepareMutation` gate, no DB writes.
 */

import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { CatalogProduct, CatalogProductCategory, CatalogProductTag } from '../data/entities'
import { assertTenantScope, type CatalogAiToolDefinition, type CatalogToolContext } from './types'

function resolveEm(ctx: CatalogToolContext): EntityManager {
  return ctx.container.resolve<EntityManager>('em')
}

const showStatsInput = z
  .object({
    note: z
      .string()
      .max(160)
      .optional()
      .describe(
        'Optional one-line note to render below the stats grid (e.g. "as of today" or a quick observation).',
      ),
  })
  .passthrough()

const showStatsTool: CatalogAiToolDefinition = {
  name: 'catalog.show_stats',
  displayName: 'Show catalog stats',
  description:
    'Displays a compact "Catalog overview" card in the chat with live counts: total products, active products, categories, and tags for the current tenant. Use this when the operator asks for a high-level snapshot of the catalog (e.g. "give me catalog stats", "how many products do we have", "show overview"). Returns a `uiPart` envelope so the registered `catalog.stats-card` component renders inline — no fenced code block needed.',
  inputSchema: showStatsInput,
  requiredFeatures: ['catalog.products.view'],
  tags: ['read', 'catalog', 'stats', 'ui'],
  isMutation: false,
  handler: async (rawInput, ctx) => {
    const { tenantId } = assertTenantScope(ctx)
    const input = showStatsInput.parse(rawInput)
    const em = resolveEm(ctx)

    // CatalogProductTag has no soft-delete column, so the `deletedAt: null`
    // filter (used for products + categories which DO have it) would throw
    // `Trying to query by not existing property CatalogProductTag.deletedAt`.
    // Build per-entity scopes that only include the fields that actually exist.
    const tenantScope: Record<string, unknown> = { tenantId }
    if (ctx.organizationId) tenantScope.organizationId = ctx.organizationId
    const softDeleteScope: Record<string, unknown> = { ...tenantScope, deletedAt: null }

    const [products, activeProducts, categories, tags] = await Promise.all([
      em.count(CatalogProduct, softDeleteScope as never),
      em.count(CatalogProduct, { ...softDeleteScope, isActive: true } as never),
      em.count(CatalogProductCategory, softDeleteScope as never),
      em.count(CatalogProductTag, tenantScope as never),
    ])

    return {
      uiPart: {
        componentId: 'catalog.stats-card',
        payload: {
          products,
          activeProducts,
          categories,
          tags,
          generatedAt: new Date().toISOString(),
          note: input.note,
        },
      },
      // Plain-text mirror so the model can summarize what it just rendered
      // without parsing the UI part envelope itself.
      summary: `Catalog snapshot: ${products} products (${activeProducts} active), ${categories} categories, ${tags} tags.`,
    }
  },
}

export const statsAiTools: CatalogAiToolDefinition[] = [showStatsTool]

export default statsAiTools
