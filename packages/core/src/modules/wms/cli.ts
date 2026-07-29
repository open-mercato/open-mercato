import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { repairBalanceDrift, verifyBalances } from './lib/inventoryReconciliation'

function parseArgs(rest: string[]) {
  const args: Record<string, string | boolean> = {}
  for (let index = 0; index < rest.length; index += 1) {
    const part = rest[index]
    if (!part) continue
    if (part.startsWith('--')) {
      const [rawKey, rawValue] = part.slice(2).split('=')
      if (rawValue !== undefined) {
        args[rawKey] = rawValue
      } else if (rest[index + 1] && !rest[index + 1]!.startsWith('--')) {
        args[rawKey] = rest[index + 1]!
        index += 1
      } else {
        args[rawKey] = true
      }
    }
  }
  return args
}

const verifyBalancesCommand: ModuleCli = {
  command: 'verify-balances',
  async run(rest) {
    const args = parseArgs(rest)
    const tenantId = String(args.tenantId ?? args.tenant ?? '')
    const organizationId = String(args.organizationId ?? args.org ?? args.orgId ?? '')
    const warehouseId = typeof args.warehouse === 'string' ? args.warehouse : typeof args.warehouseId === 'string' ? args.warehouseId : undefined
    const catalogVariantId =
      typeof args.catalogVariantId === 'string'
        ? args.catalogVariantId
        : typeof args.variantId === 'string'
          ? args.variantId
          : undefined
    const repair = args.repair === true || args.repair === 'true'

    if (!tenantId || !organizationId) {
      console.error(
        'Usage: mercato wms verify-balances --tenant <tenantId> --org <organizationId> [--warehouse <warehouseId>] [--catalogVariantId <variantId>] [--repair]',
      )
      return
    }

    const container = await createRequestContainer()
    try {
      const em = container.resolve<EntityManager>('em')
      const scope = { tenantId, organizationId }
      const driftRows = await verifyBalances(em, scope, {
        warehouseId,
        catalogVariantId,
      })

      if (driftRows.length === 0) {
        console.log('✅ No balance drift detected.')
        return
      }

      console.log(`⚠️  Detected ${driftRows.length} balance drift row(s):`)
      for (const row of driftRows) {
        console.log(
          JSON.stringify({
            balanceId: row.balanceId,
            bucket: row.bucket,
            storedOnHand: row.storedOnHand,
            expectedOnHand: row.expectedOnHand,
            storedReserved: row.storedReserved,
            expectedReserved: row.expectedReserved,
            storedAllocated: row.storedAllocated,
            expectedAllocated: row.expectedAllocated,
          }),
        )
      }

      if (!repair) {
        console.log('Run again with --repair to apply expected values to stored balances.')
        return
      }

      const repaired = await em.transactional(async (trx) => repairBalanceDrift(trx, scope, driftRows))
      console.log(`🔧 Repaired ${repaired} balance row(s).`)
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

const cliCommands: ModuleCli[] = [verifyBalancesCommand]

export default cliCommands
