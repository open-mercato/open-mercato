import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { adoptOrphanedCustomerGroups, scanOrphanedCustomerGroupReferences } from './lib/reconcile'

type ParsedArgs = Record<string, string | boolean>

// Mirrors `attachments/cli.ts`'s `parseArgs` — the established `--flag value` /
// `--flag=value` / bare `--flag` parser for this repo's `ModuleCli` commands.
function parseArgs(rest: string[]): ParsedArgs {
  const args: ParsedArgs = {}
  for (let i = 0; i < rest.length; i += 1) {
    const part = rest[i]
    if (!part || !part.startsWith('--')) continue
    const [rawKey, rawValue] = part.replace(/^--/, '').split('=')
    const key = rawKey.trim()
    if (!key) continue
    if (rawValue !== undefined) {
      args[key] = rawValue
      continue
    }
    const next = rest[i + 1]
    if (next && !next.startsWith('--')) {
      args[key] = next
      i += 1
    } else {
      args[key] = true
    }
  }
  return args
}

// Usage: mercato customer_groups reconcile [--tenant <tenantId>] [--adopt]
//
// Scans `catalog_product_variant_prices.customer_group_id` and
// `sales_tax_rates.customer_group_id` for values with no matching
// `customer_groups` row (see `lib/reconcile.ts` for the exact query and the
// `--adopt` placeholder-creation semantics).
const reconcile: ModuleCli = {
  command: 'reconcile',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = typeof args.tenant === 'string' ? args.tenant : undefined
    const adopt = Boolean(args.adopt)

    const container = await createRequestContainer()
    const em = container.resolve<EntityManager>('em')

    const orphans = await scanOrphanedCustomerGroupReferences(em, { tenantId })
    if (!orphans.length) {
      console.log('No orphaned customer-group references found.')
      return
    }

    for (const orphan of orphans) {
      console.log(
        `Orphan group ${orphan.groupId} (tenant=${orphan.tenantId ?? 'unknown'}): ` +
          `${orphan.catalogPriceCount} catalog price row(s), ${orphan.salesTaxRateCount} sales tax rate row(s)`,
      )
      if (orphan.sampleCatalogPriceIds.length) {
        console.log(`  sample catalog_product_variant_prices ids: ${orphan.sampleCatalogPriceIds.join(', ')}`)
      }
      if (orphan.sampleSalesTaxRateIds.length) {
        console.log(`  sample sales_tax_rates ids: ${orphan.sampleSalesTaxRateIds.join(', ')}`)
      }
    }

    if (!adopt) {
      console.log(
        `\nFound ${orphans.length} orphaned customer group reference(s). Re-run with --adopt to create placeholder groups.`,
      )
      return
    }

    const adopted = await adoptOrphanedCustomerGroups(em, orphans)
    for (const group of adopted) {
      console.log(`Adopted ${group.groupId} as placeholder group "${group.code}" (tenant=${group.tenantId})`)
    }
    const skipped = orphans.length - adopted.length
    if (skipped > 0) {
      console.warn(`⚠ ${skipped} orphan(s) skipped — no resolvable tenant id from their referencing rows.`)
    }
    console.log(`\nFound ${orphans.length} orphaned customer group reference(s); adopted ${adopted.length}.`)
  },
}

export default [reconcile]
