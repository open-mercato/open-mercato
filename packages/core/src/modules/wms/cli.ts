import { parseModuleCliOptions } from '@open-mercato/shared/lib/cli/parseModuleCliOptions'
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { repairBalanceDrift, verifyBalances } from './lib/inventoryReconciliation'

function parseArgs(rest: string[]) {
  return parseModuleCliOptions(rest)
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
